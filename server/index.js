const express = require('express');
const http    = require('http');
const path    = require('path');
const crypto  = require('crypto');
const { Server } = require('socket.io');
const cors   = require('cors');
const { Chess } = require('chess.js');
const { createClient } = require('@supabase/supabase-js');
const { ELO_START, getRankInfo, calculateEloPair } = require('./elo');

// ─── Supabase admin client (service role — bypasses RLS) ─────────────────────
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
if (supabase) console.log('[SUPABASE] Connected — player stats will be persisted.');
else         console.log('[SUPABASE] Not configured — running in memory-only mode.');

const IS_PROD = process.env.NODE_ENV === 'production';

// ─── Teacher credentials (override via env vars) ──────────────────────────────
const TEACHER_CREDENTIALS = {
  [process.env.TEACHER_USERNAME || 'giaovien']: process.env.TEACHER_PASSWORD || 'lsts@2024',
  'phungnd': 'lsts@123',
  'canhhn': 'lsts@123',
  'vuongnd': 'lsts@123'
};
const TOKEN_SECRET     = process.env.TOKEN_SECRET     || 'lstsCaroTourney2024#Secret';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: IS_PROD
      ? (process.env.CLIENT_ORIGIN || '*')
      : ['http://localhost:5173', 'http://localhost:4173'],
    methods: ['GET', 'POST'],
  },
});

const TURN_TIMEOUT_MS       = 30_000;   // caro / tictactoe per-move timeout
const CHESS_INITIAL_TIME_MS = Number(process.env.CHESS_TIMEOUT_TEST_MS) || (5 * 60 * 1000); // per-player clock (override for testing)
const CHESS_INCREMENT_MS    = process.env.CHESS_TIMEOUT_TEST_MS ? 0 : 3_000;                 // seconds added per move (0 in test mode)
const RECONNECT_WAIT_MS     = 20_000; // window before forfeit on disconnect
const MOVE_RATE_MS      = 400;    // minimum ms between moves (anti-spam)

// ─── In-memory state ──────────────────────────────────────────────────────────
const tournaments      = {};
const socketMeta       = {};
const matchTimers      = {};
const adminSessions    = new Map();
const tournamentHistory = [];
const MAX_HISTORY = 20;

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function createAdminToken(username) {
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, { username, expiresAt: Date.now() + 86_400_000 });
  return token;
}
function verifyAdminToken(token) {
  if (!token) return null;
  const s = adminSessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expiresAt) { adminSessions.delete(token); return null; }
  return s;
}

// ─── Other helpers ────────────────────────────────────────────────────────────
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function generateMatchId() {
  return `match_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
function createEmptyBoard(size = 15) {
  return Array(size).fill(null).map(() => Array(size).fill(null));
}

function checkWinner(board, row, col, size, gameType = 'caro') {
  const player = board[row][col];
  if (!player) return null;
  const winLen = gameType === 'tictactoe' ? 3 : 5;
  const directions = [[0,1],[1,0],[1,1],[1,-1]];
  for (const [dr,dc] of directions) {
    let count = 1, blocked = 0;
    const cells = [[row,col]];
    let r = row+dr, c = col+dc;
    while (r>=0&&r<size&&c>=0&&c<size&&board[r][c]===player) { cells.push([r,c]); count++; r+=dr; c+=dc; }
    if (r>=0&&r<size&&c>=0&&c<size&&board[r][c]&&board[r][c]!==player) blocked++;
    r=row-dr; c=col-dc;
    while (r>=0&&r<size&&c>=0&&c<size&&board[r][c]===player) { cells.push([r,c]); count++; r-=dr; c-=dc; }
    if (r>=0&&r<size&&c>=0&&c<size&&board[r][c]&&board[r][c]!==player) blocked++;
    // Caro: 5 in a row, but NOT if exactly 5 and both ends blocked
    // TicTacToe: 3 in a row, no blocked rule
    if (gameType === 'tictactoe') {
      if (count >= winLen) return { symbol: player, cells };
    } else {
      if (count>=5&&!(count===5&&blocked===2)) return { symbol: player, cells };
    }
  }
  return null;
}
function isBoardFull(board) { return board.every(r=>r.every(c=>c!==null)); }

function getTournamentPublicState(tournament) {
  const players    = Array.from(tournament.players.values());
  const matches    = Array.from(tournament.matches.values()).map(m => ({
    id: m.id,
    p1Nickname: tournament.players.get(m.p1)?.nickname,
    p2Nickname: tournament.players.get(m.p2)?.nickname,
    p1Id: m.p1, p2Id: m.p2, status: m.status, winner: m.winner,
  }));
  const leaderboard = players
    .map(p => ({
      id: p.id, nickname: p.nickname, elo: p.elo, score: p.score,
      wins: p.wins, draws: p.draws, losses: p.losses,
      status: p.status, streak: p.streak || 0, ratedGames: p.ratedGames || 0,
      rank: getRankInfo(p.elo, p.ratedGames || 0),
    }))
    // Tournament placement follows the classroom rule: win 3, draw 1, loss 0.
    // Persistent ELO is only a tie-breaker and is used for matchmaking.
    .sort((a,b) => b.score - a.score || b.wins - a.wins || b.elo - a.elo);
  const onlinePlayers = players
    .filter(p => p.status !== 'offline' && p.status !== 'reconnecting')
    .map(p => ({ id: p.id, nickname: p.nickname, status: p.status === 'result' ? 'waiting' : p.status }));
  return {
    roomCode: tournament.roomCode, name: tournament.name, gameType: tournament.gameType,
    status: tournament.status, players: onlinePlayers, matches, leaderboard,
  };
}
function broadcastTournamentState(roomCode) {
  const t = tournaments[roomCode];
  if (t) io.to(roomCode).emit('room_state_update', getTournamentPublicState(t));
}

// ─── Turn Timer ───────────────────────────────────────────────────────────────
function clearMatchTimer(matchId) {
  if (matchTimers[matchId]) { clearTimeout(matchTimers[matchId].timerId); delete matchTimers[matchId]; }
}
function startMatchTimer(match, roomCode) {
  clearMatchTimer(match.id);
  const startedAt = Date.now();
  match.turnClockStarted = startedAt;

  const t = tournaments[roomCode];
  const isChess = t?.gameType === 'chess';
  // For chess: use remaining clock time of the active player; for others: fixed turn timeout
  const durationMs = isChess
    ? (match.currentTurn === match.p1 ? match.p1TimeMs : match.p2TimeMs)
    : (match.turnDurationMs || TURN_TIMEOUT_MS);

  matchTimers[match.id] = {
    startedAt,
    timerId: setTimeout(() => handleTurnTimeout(match.id, roomCode), durationMs),
  };
  const payload = {
    matchId: match.id, currentTurn: match.currentTurn,
    turnStartedAt: startedAt, turnDurationMs: durationMs,
    ...(isChess && { p1TimeMs: match.p1TimeMs, p2TimeMs: match.p2TimeMs }),
  };
  io.to(match.p1).emit('turn_start', payload);
  io.to(match.p2).emit('turn_start', payload);
  io.to(`spectate_${match.id}`).emit('turn_start', payload);
}
function handleTurnTimeout(matchId, roomCode) {
  const tournament = tournaments[roomCode];
  if (!tournament) return;
  const match = tournament.matches.get(matchId);
  if (!match || match.status !== 'active') return;

  const timedOutPlayerId = match.currentTurn;
  if (tournament.gameType === 'chess') {
    // Chess: player whose clock hit 0 loses
    const winnerId = timedOutPlayerId === match.p1 ? match.p2 : match.p1;
    resolveGameOver(match, tournament, roomCode, {
      winnerId, isDraw: false,
      timedOut: true, timedOutPlayerId,
    });
    return;
  }

  // Caro & TicTacToe: Timeout switches turn
  match.currentTurn = match.p1 === timedOutPlayerId ? match.p2 : match.p1;

  const payload = {
    matchId, row: null, col: null, symbol: null,
    currentTurn: match.currentTurn, board: match.board,
    timedOut: true, timedOutPlayerId,
  };
  io.to(match.p1).emit('move_made', payload);
  io.to(match.p2).emit('move_made', payload);
  io.to(`spectate_${match.id}`).emit('move_made', payload);
  startMatchTimer(match, roomCode);
}

// ─── Matchmaking ──────────────────────────────────────────────────────────────
function pairingScore(p1, p2, now) {
  const rankDiff = Math.abs(
    getRankInfo(p1.elo, p1.ratedGames || 0).index -
    getRankInfo(p2.elo, p2.ratedGames || 0).index
  );
  const p1Wait = (now - (p1.waitingSince || now)) / 1000;
  const p2Wait = (now - (p2.waitingSince || now)) / 1000;
  const minWait = Math.min(p1Wait, p2Wait);
  // Rank penalty fades to 0 after 30s
  const rankPenalty = rankDiff * Math.max(0, 1 - minWait / 30) * 100;
  
  const hasPlayed = p1.opponentHistory.has(p2.id) || p2.opponentHistory.has(p1.id);
  const isLastOpponent = p1.lastOpponent === p2.id || p2.lastOpponent === p1.id;
  
  let historyPenalty = 0;
  if (isLastOpponent) {
    if (minWait < 20) return Infinity; // Hard block consecutive matches within 20s
    historyPenalty = Math.max(0, 1 - minWait / 60) * 10000;
  } else if (hasPlayed) {
    historyPenalty = Math.max(0, 1 - minWait / 20) * 100;
  }
  
  return rankPenalty + historyPenalty;
}

function createMatch(tournament, roomCode, p1, p2) {
  p1.opponentHistory.add(p2.id);
  p2.opponentHistory.add(p1.id);
  p1.lastOpponent = p2.id;
  p2.lastOpponent = p1.id;
  const matchId = generateMatchId();
  const isChess = tournament.gameType === 'chess';
  let board, size;
  if (isChess) {
    const chessInstance = new Chess();
    board = chessInstance.fen();
    size = 8;
  } else {
    size = tournament.gameType === 'tictactoe' ? 3 : 15;
    board = createEmptyBoard(size);
  }

  const chessInitial = tournament.chessInitialMs || CHESS_INITIAL_TIME_MS;
  const chessInc     = tournament.chessIncMs     ?? CHESS_INCREMENT_MS;
  const match = {
    id: matchId, p1: p1.id, p2: p2.id,
    board, currentTurn: p1.id,
    status: 'active', winner: null, startedAt: Date.now(), size,
    turnDurationMs: isChess ? null : TURN_TIMEOUT_MS,
    // Chess per-player clocks
    p1TimeMs:         isChess ? chessInitial : null,
    p2TimeMs:         isChess ? chessInitial : null,
    chessIncMs:       isChess ? chessInc     : null,
    turnClockStarted: null,
    lastMoveAt: {},
  };
  tournament.matches.set(matchId, match);
  p1.status = 'playing'; p1.waitingSince = null;
  p2.status = 'playing'; p2.waitingSince = null;

  const turnStartedAt = Date.now();
  const base = {
    matchId, gameType: tournament.gameType,
    currentTurn: match.currentTurn, board: match.board, size: match.size,
    turnStartedAt,
    turnDurationMs: isChess ? chessInitial : TURN_TIMEOUT_MS,
    ...(isChess && { p1TimeMs: match.p1TimeMs, p2TimeMs: match.p2TimeMs, chessIncMs: match.chessIncMs }),
  };
  io.to(p1.id).emit('match_found', { ...base, opponentNickname: p2.nickname, opponentId: p2.id, yourSymbol: 'X', opponentSymbol: 'O' });
  io.to(p2.id).emit('match_found', { ...base, opponentNickname: p1.nickname, opponentId: p1.id, yourSymbol: 'O', opponentSymbol: 'X' });
  startMatchTimer(match, roomCode);
}

function matchWaitingPlayers(roomCode) {
  const tournament = tournaments[roomCode];
  if (!tournament) return;
  const now = Date.now();
  const waiting = Array.from(tournament.players.values()).filter(p => p.status === 'waiting' && p.socketId !== null);
  if (waiting.length < 2) return;

  const candidates = [];
  for (let i = 0; i < waiting.length; i++)
    for (let j = i+1; j < waiting.length; j++)
      candidates.push({ p1: waiting[i], p2: waiting[j], score: pairingScore(waiting[i], waiting[j], now) });
  candidates.sort((a,b) => a.score - b.score);

  const used = new Set();
  for (const { p1, p2, score } of candidates) {
    if (score === Infinity) continue;
    if (!used.has(p1.id) && !used.has(p2.id)) {
      used.add(p1.id); used.add(p2.id);
      createMatch(tournament, roomCode, p1, p2);
    }
  }
  broadcastTournamentState(roomCode);
}

// ─── Game over helper ─────────────────────────────────────────────────────────
function resolveGameOver(match, tournament, roomCode, { winnerId, isDraw, opponentDisconnected = false, winningCells = null, timedOut = false, timedOutPlayerId = null }) {
  clearMatchTimer(match.id);
  match.status = 'finished';
  match.winner = winnerId || null;

  const p1 = tournament.players.get(match.p1);
  const p2 = tournament.players.get(match.p2);
  let eloChangeP1 = 0, eloChangeP2 = 0;

  if (p1 && p2) {
    const oldEloP1 = p1.elo, oldEloP2 = p2.elo;
    const p1Result = isDraw ? 0.5 : winnerId === match.p1 ? 1 : 0;
    const eloResult = calculateEloPair(
      oldEloP1, oldEloP2, p1Result,
      p1.ratedGames || 0, p2.ratedGames || 0,
    );
    eloChangeP1 = eloResult.p1Delta;
    eloChangeP2 = eloResult.p2Delta;
    if (isDraw) {
      p1.draws++; p1.score += 1; p1.streak = 0; p1.status = 'result'; p1.waitingSince = null;
      p2.draws++; p2.score += 1; p2.streak = 0; p2.status = 'result'; p2.waitingSince = null;
    } else if (winnerId) {
      const [winner, loser] = winnerId === match.p1 ? [p1, p2] : [p2, p1];
      const newStreak = (winner.streak || 0) + 1;
      winner.wins++; winner.score += 3; winner.streak = newStreak; winner.status = 'result'; winner.waitingSince = null;
      loser.losses++;            loser.streak = 0;               loser.status  = 'result'; loser.waitingSince  = null;
    }
    p1.elo = eloResult.p1Elo;
    p2.elo = eloResult.p2Elo;
    p1.ratedGames = (p1.ratedGames || 0) + 1;
    p2.ratedGames = (p2.ratedGames || 0) + 1;
  }

  const base = {
    matchId: match.id, winnerId,
    winnerSymbol: winnerId ? (match.p1===winnerId?'X':'O') : null,
    isDraw, opponentDisconnected, board: match.board, winningCells,
    ...(timedOut && { timedOut: true, timedOutPlayerId }),
  };
  io.to(match.p1).emit('game_over', { ...base, eloChange: eloChangeP1 });
  io.to(match.p2).emit('game_over', { ...base, eloChange: eloChangeP2 });
  io.to(`spectate_${match.id}`).emit('game_over', { ...base, isSpectating: true });
  broadcastTournamentState(roomCode);
  // Persist to Supabase (fire-and-forget; don't block the game)
  persistMatchResult(match, tournament, winnerId, isDraw, eloChangeP1, eloChangeP2).catch(() => {});
  // Pair any OTHER players who were already waiting before this game ended
  setTimeout(() => matchWaitingPlayers(roomCode), 100);
}

// ─── Supabase persistence ─────────────────────────────────────────────────────
async function persistMatchResult(match, tournament, winnerId, isDraw, eloChangeP1, eloChangeP2) {
  if (!supabase) return;
  const p1 = tournament.players.get(match.p1);
  const p2 = tournament.players.get(match.p2);
  if (!p1 || !p2) return;

  const winnerSbId = winnerId
    ? (winnerId === match.p1 ? p1.supabaseId : p2.supabaseId)
    : null;

  // Insert match history row (only if at least one player is authenticated)
  if (p1.supabaseId || p2.supabaseId) {
    const { error: mErr } = await supabase.from('match_history').insert({
      room_code:    tournament.roomCode,
      game_type:    tournament.gameType,
      p1_id:        p1.supabaseId || null,
      p2_id:        p2.supabaseId || null,
      winner_id:    winnerSbId,
      is_draw:      isDraw,
      elo_delta_p1: eloChangeP1,
      elo_delta_p2: eloChangeP2,
    });
    if (mErr) console.error('[SUPABASE] match_history error:', mErr.message);
  }

  // Update ELO + stats for each authenticated player
  // Player result for THIS match
  const getResult = (player, playerId) => {
    if (isDraw) return 'draw';
    return winnerId === playerId ? 'win' : 'loss';
  };
  for (const [player, playerId] of [[p1, match.p1], [p2, match.p2]]) {
    if (!player.supabaseId) continue;
    const result = getResult(player, playerId);
    const nextDbWins   = (player.dbWins   || 0) + (result === 'win'  ? 1 : 0);
    const nextDbLosses = (player.dbLosses || 0) + (result === 'loss' ? 1 : 0);
    const nextDbDraws  = (player.dbDraws  || 0) + (result === 'draw' ? 1 : 0);
    const { error } = await supabase.from('profile_game_ratings')
      .upsert({
        user_id: player.supabaseId,
        game_type: tournament.gameType,
        elo:    player.elo,
        wins:   nextDbWins,
        losses: nextDbLosses,
        draws:  nextDbDraws,
        streak: player.streak || 0,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,game_type' });
    if (error) {
      console.error('[SUPABASE] game rating update error:', error.message);
    } else {
      // Keep the in-memory all-time counters in sync for subsequent matches.
      player.dbWins = nextDbWins;
      player.dbLosses = nextDbLosses;
      player.dbDraws = nextDbDraws;
    }
  }
}

// ─── REST API ─────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (TEACHER_CREDENTIALS[username] && TEACHER_CREDENTIALS[username] === password) {
    const token = createAdminToken(username);
    console.log(`[AUTH] Login: ${username}`);
    return res.json({ success: true, token, username });
  }
  res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu!' });
});
app.get('/api/auth/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ','');
  const s = verifyAdminToken(token);
  s ? res.json({ success: true, username: s.username }) : res.status(401).json({ success: false });
});
app.get('/health', (req, res) => res.json({ status: 'ok', tournaments: Object.keys(tournaments).length }));
app.get('/api/history', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ','');
  if (!verifyAdminToken(token)) return res.status(401).json({ success: false });
  res.json({ success: true, history: tournamentHistory });
});
app.get('/leaderboard/:roomCode', (req, res) => {
  const t = tournaments[req.params.roomCode.toUpperCase()];
  if (!t) return res.status(404).json({ error: 'Room not found' });
  res.json(getTournamentPublicState(t));
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  socket.on('create_tournament', ({ name, gameType, chessInitialMs, chessIncMs, token } = {}, callback) => {
    const session = verifyAdminToken(token);
    if (!session) return callback?.({ success: false, message: 'Vui lòng đăng nhập để tạo giải đấu!' });
    let roomCode;
    do { roomCode = generateRoomCode(); } while (tournaments[roomCode]);
    const tournamentName = name?.trim() ||
      `Giải đấu ${new Date().toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'})}`;
    const gType = gameType || 'caro';
    tournaments[roomCode] = {
      adminSocketId: socket.id, roomCode, name: tournamentName,
      gameType: gType,
      // Chess time controls (null for non-chess tournaments)
      chessInitialMs: gType === 'chess' ? (chessInitialMs || CHESS_INITIAL_TIME_MS) : null,
      chessIncMs:     gType === 'chess' ? (chessIncMs     ?? CHESS_INCREMENT_MS)     : null,
      players: new Map(), matches: new Map(),
      status: 'waiting', createdAt: Date.now(), adminUsername: session.username,
    };
    socketMeta[socket.id] = { roomCode, role: 'admin', nickname: 'Admin' };
    socket.join(roomCode);
    console.log(`[TOURNAMENT] Created: ${roomCode} — "${tournamentName}"`);
    callback({ success: true, roomCode, name: tournamentName });
    broadcastTournamentState(roomCode);
  });

  socket.on('admin_rejoin', ({ roomCode, token }, callback) => {
    if (!verifyAdminToken(token)) return callback?.({ success: false, message: 'Phiên đăng nhập hết hạn!' });
    const t = tournaments[roomCode];
    if (!t) return callback?.({ success: false, message: 'Phòng không tồn tại' });
    t.adminSocketId = socket.id;
    socketMeta[socket.id] = { roomCode, role: 'admin', nickname: 'Admin' };
    socket.join(roomCode);
    callback?.({ success: true, state: getTournamentPublicState(t) });
  });

  socket.on('join_room', async ({ roomCode, nickname, supabaseToken }, callback) => {
    const code = roomCode?.toUpperCase();
    const t    = tournaments[code];
    if (!t) return callback({ success: false, message: 'Mã phòng không tồn tại!' });
    if (t.status === 'finished') return callback({ success: false, message: 'Giải đấu đã kết thúc!' });

    // ── Supabase auth: verify token and load persistent ELO ──────────────────
    let supabaseId = null, supabaseElo = ELO_START, dbWins = 0, dbLosses = 0, dbDraws = 0, dbStreak = 0;
    if (supabase && supabaseToken) {
      try {
        const { data: { user }, error } = await supabase.auth.getUser(supabaseToken);
        if (!error && user) {
          supabaseId = user.id;
          const { data: profile } = await supabase
            .from('profiles')
            .select('nickname')
            .eq('id', user.id)
            .single();
          if (profile) {
            // Use profile nickname if none provided
            if (!nickname?.trim() && profile.nickname) nickname = profile.nickname;
          }

          // Caro, Tic-tac-toe and Chess each have an independent rating.
          const { data: rating } = await supabase
            .from('profile_game_ratings')
            .select('elo, wins, losses, draws, streak')
            .match({ user_id: user.id, game_type: t.gameType })
            .maybeSingle();
          if (rating) {
            supabaseElo = rating.elo;
            dbWins      = rating.wins;
            dbLosses    = rating.losses;
            dbDraws     = rating.draws;
            dbStreak    = rating.streak;
          }
        }
      } catch (e) { /* auth failure is non-fatal — fall back to guest */ }
    }

    const trimmedNickname = nickname?.trim();
    if (!trimmedNickname) return callback({ success: false, message: 'Vui lòng nhập biệt danh!' });

    // ── Reconnection: same nickname, player is disconnected/reconnecting ──────
    const reconnecting = Array.from(t.players.values()).find(
      p => p.nickname.toLowerCase() === trimmedNickname.toLowerCase() &&
           (p.status === 'offline' || p.status === 'reconnecting')
    );
    if (reconnecting) {
      if (reconnecting.disconnectTimerId) { clearTimeout(reconnecting.disconnectTimerId); reconnecting.disconnectTimerId = null; }
      const oldId = reconnecting.id;
      reconnecting.id       = socket.id;
      reconnecting.socketId = socket.id;
      // Re-key the players Map
      t.players.delete(oldId);
      t.players.set(socket.id, reconnecting);
      // Update match references
      let activeMatch = null;
      for (const [, m] of t.matches) {
        if (m.status === 'active') {
          if (m.p1 === oldId) { m.p1 = socket.id; activeMatch = m; }
          else if (m.p2 === oldId) { m.p2 = socket.id; activeMatch = m; }
        }
      }
      reconnecting.status = activeMatch ? 'playing' : 'waiting';
      reconnecting.waitingSince = activeMatch ? null : Date.now();
      socketMeta[socket.id] = { roomCode: code, role: 'player', nickname: reconnecting.nickname };
      socket.join(code);
      callback({ success: true, playerId: socket.id, roomCode: code });

      if (activeMatch) {
        // Restore the ongoing match for the reconnected player
        const isP1     = activeMatch.p1 === socket.id;
        const opponent = t.players.get(isP1 ? activeMatch.p2 : activeMatch.p1);
        const isChessReconnect = t.gameType === 'chess';
        io.to(socket.id).emit('match_found', {
          matchId: activeMatch.id, gameType: t.gameType, currentTurn: activeMatch.currentTurn,
          board: activeMatch.board, size: activeMatch.size,
          turnStartedAt: Date.now(),
          turnDurationMs: isChessReconnect
            ? (activeMatch.currentTurn === activeMatch.p1 ? activeMatch.p1TimeMs : activeMatch.p2TimeMs)
            : (activeMatch.turnDurationMs || TURN_TIMEOUT_MS),
          opponentNickname: opponent?.nickname || '?',
          opponentId: isP1 ? activeMatch.p2 : activeMatch.p1,
          yourSymbol: isP1 ? 'X' : 'O', opponentSymbol: isP1 ? 'O' : 'X',
          reconnecting: true,
          ...(isChessReconnect && {
            p1TimeMs: activeMatch.p1TimeMs,
            p2TimeMs: activeMatch.p2TimeMs,
            chessIncMs: activeMatch.chessIncMs,
          }),
        });
        // Notify opponent
        const opponentSocket = isP1 ? activeMatch.p2 : activeMatch.p1;
        io.to(opponentSocket).emit('opponent_reconnected', { nickname: reconnecting.nickname });
      }
      broadcastTournamentState(code);
      if (t.status === 'active' && !activeMatch) matchWaitingPlayers(code);
      return; // skip normal join logic
    }

    // ── Normal join ───────────────────────────────────────────────────────────
    const dup = Array.from(t.players.values()).find(
      p => p.nickname.toLowerCase() === trimmedNickname.toLowerCase()
    );
    if (dup) return callback({ success: false, message: 'Biệt danh đã được dùng, hãy chọn tên khác!' });

    const player = {
      id: socket.id, socketId: socket.id, nickname: trimmedNickname,
      status: 'waiting',
      score: 0, wins: 0, draws: 0, losses: 0, streak: dbStreak,
      elo: supabaseElo, ratedGames: dbWins + dbLosses + dbDraws,
      // All-time DB stats (used when persisting back to Supabase)
      supabaseId, dbWins, dbLosses, dbDraws,
      opponentHistory: new Set(),
      lastOpponent: null,
      waitingSince: t.status === 'active' ? Date.now() : null,
      disconnectTimerId: null,
    };
    t.players.set(socket.id, player);
    socketMeta[socket.id] = { roomCode: code, role: 'player', nickname: trimmedNickname };
    socket.join(code);
    console.log(`[JOIN] ${trimmedNickname} → ${code}`);
    callback({ success: true, playerId: socket.id, roomCode: code });
    broadcastTournamentState(code);
    if (t.status === 'active') matchWaitingPlayers(code);
  });

  socket.on('start_tournament', ({ roomCode }, callback) => {
    const t = tournaments[roomCode];
    if (!t) return callback?.({ success: false });
    if (t.adminSocketId !== socket.id) return callback?.({ success: false, message: 'Không có quyền!' });
    if (t.players.size < 2) return callback?.({ success: false, message: 'Cần ít nhất 2 người chơi!' });
    t.status = 'active';
    const now = Date.now();
    for (const p of t.players.values()) if (p.status==='waiting') p.waitingSince = now;
    io.to(roomCode).emit('tournament_started');
    matchWaitingPlayers(roomCode);
    callback?.({ success: true });
  });

  socket.on('end_tournament', ({ roomCode }, callback) => {
    const t = tournaments[roomCode];
    if (!t) return callback?.({ success: false, message: 'Phòng không tồn tại' });
    if (t.adminSocketId !== socket.id) return callback?.({ success: false, message: 'Không có quyền!' });
    for (const [, match] of t.matches)
      if (match.status === 'active') resolveGameOver(match, t, roomCode, { winnerId: null, isDraw: true });
    t.status = 'finished'; t.finishedAt = Date.now();
    const finalState = getTournamentPublicState(t);
    tournamentHistory.unshift({
      roomCode: t.roomCode, name: t.name, createdAt: t.createdAt, finishedAt: t.finishedAt,
      playerCount: t.players.size, matchCount: t.matches.size,
      leaderboard: finalState.leaderboard.slice(0, 10),
    });
    if (tournamentHistory.length > MAX_HISTORY) tournamentHistory.pop();
    io.to(roomCode).emit('tournament_ended', { leaderboard: finalState.leaderboard });
    broadcastTournamentState(roomCode);
    console.log(`[TOURNAMENT] Ended: ${roomCode} — "${t.name}"`);
    callback?.({ success: true, leaderboard: finalState.leaderboard });
  });

  socket.on('make_move', ({ matchId, row, col, move }, callback) => {
    const meta = socketMeta[socket.id]; if (!meta) return;
    const t = tournaments[meta.roomCode]; if (!t) return;
    const match = t.matches.get(matchId);
    console.log(`[MOVE] ${meta.nickname} in ${matchId}`);
    if (!match || match.status !== 'active') return callback?.({ success: false, message: 'Trận đấu không hợp lệ' });
    if (match.currentTurn !== socket.id) return callback?.({ success: false, message: 'Chưa đến lượt bạn!' });

    // ── Rate limiting ─────────────────────────────────────────────────────────
    const lastAt = match.lastMoveAt[socket.id] || 0;
    if (Date.now() - lastAt < MOVE_RATE_MS) return callback?.({ success: false, message: 'Đánh quá nhanh!' });
    match.lastMoveAt[socket.id] = Date.now();

    clearMatchTimer(match.id);

    if (t.gameType === 'chess') {
      const chess = new Chess(match.board);
      try {
        const result = chess.move(move);
        if (!result) return callback?.({ success: false, message: 'Nước đi không hợp lệ!' });

        // ── Deduct elapsed time from mover's clock, then add increment ─────────
        const elapsed = Date.now() - (match.turnClockStarted || Date.now());
        if (socket.id === match.p1) {
          match.p1TimeMs = Math.max(0, match.p1TimeMs - elapsed) + match.chessIncMs;
        } else {
          match.p2TimeMs = Math.max(0, match.p2TimeMs - elapsed) + match.chessIncMs;
        }

        match.board = chess.fen();
        const isCheckmate = chess.isCheckmate();
        const isDraw      = chess.isDraw();
        const isCheck     = !isCheckmate && chess.inCheck(); // check but not checkmate

        if (isCheckmate || isDraw) {
          const movePayload = { matchId, move, currentTurn: match.currentTurn, board: match.board,
            p1TimeMs: match.p1TimeMs, p2TimeMs: match.p2TimeMs };
          io.to(match.p1).emit('move_made', movePayload);
          io.to(match.p2).emit('move_made', movePayload);
          io.to(`spectate_${match.id}`).emit('move_made', movePayload);
          resolveGameOver(match, t, meta.roomCode, {
            winnerId: isCheckmate ? socket.id : null, isDraw: !!isDraw,
            winningCells: null,
          });
        } else {
          match.currentTurn = match.p1 === socket.id ? match.p2 : match.p1;
          const movePayload = { matchId, move, currentTurn: match.currentTurn, board: match.board,
            p1TimeMs: match.p1TimeMs, p2TimeMs: match.p2TimeMs,
            isCheck: isCheck || false,
          };
          io.to(match.p1).emit('move_made', movePayload);
          io.to(match.p2).emit('move_made', movePayload);
          io.to(`spectate_${match.id}`).emit('move_made', movePayload);
          startMatchTimer(match, meta.roomCode);
        }
      } catch (e) {
        return callback?.({ success: false, message: 'Nước đi không hợp lệ!' });
      }
    } else {
      if (match.board[row][col] !== null) return callback?.({ success: false, message: 'Ô này đã được đánh!' });
      
      const symbol = match.p1 === socket.id ? 'X' : 'O';
      match.board[row][col] = symbol;

      const winResult = checkWinner(match.board, row, col, match.size, t.gameType);
      const draw      = !winResult && isBoardFull(match.board);

      if (winResult || draw) {
        const movePayload = { matchId, row, col, symbol, currentTurn: match.currentTurn, board: match.board };
        io.to(match.p1).emit('move_made', movePayload);
        io.to(match.p2).emit('move_made', movePayload);
        io.to(`spectate_${match.id}`).emit('move_made', movePayload);
        resolveGameOver(match, t, meta.roomCode, {
          winnerId: winResult ? socket.id : null, isDraw: !!draw,
          winningCells: winResult ? winResult.cells : null,
        });
      } else {
        match.currentTurn = match.p1 === socket.id ? match.p2 : match.p1;
        const movePayload = { matchId, row, col, symbol, currentTurn: match.currentTurn, board: match.board };
        io.to(match.p1).emit('move_made', movePayload);
        io.to(match.p2).emit('move_made', movePayload);
        io.to(`spectate_${match.id}`).emit('move_made', movePayload);
        startMatchTimer(match, meta.roomCode);
      }
    }
    callback?.({ success: true });
  });

  socket.on('request_next_match', ({ roomCode }) => {
    const t = tournaments[roomCode];
    if (!t || t.status !== 'active') return;
    const player = t.players.get(socket.id);
    // Accept both 'waiting' (already queued) and 'result' (just finished a match)
    if (!player || (player.status !== 'waiting' && player.status !== 'result')) return;
    player.status = 'waiting';
    player.waitingSince = Date.now();
    matchWaitingPlayers(roomCode);
  });

  // ─── Emoji reactions ─────────────────────────────────────────────────────
  socket.on('send_reaction', ({ matchId, emoji }) => {
    const meta = socketMeta[socket.id]; if (!meta) return;
    const t    = tournaments[meta.roomCode]; if (!t) return;
    const match = t.matches.get(matchId);
    if (!match || match.status !== 'active') return;
    const opponent = match.p1 === socket.id ? match.p2 : match.p1;
    const payload  = { emoji, fromId: socket.id, matchId };
    io.to(opponent).emit('reaction_received', payload);
    io.to(`spectate_${matchId}`).emit('reaction_received', payload);
  });

  // ─── Spectator ────────────────────────────────────────────────────────────
  socket.on('spectate_match', ({ matchId, roomCode }, callback) => {
    const t = tournaments[roomCode?.toUpperCase()];
    if (!t) return callback?.({ success: false, message: 'Phòng không tồn tại' });
    const match = t.matches.get(matchId);
    if (!match) return callback?.({ success: false, message: 'Trận không tồn tại' });
    socket.join(`spectate_${matchId}`);
    if (socketMeta[socket.id]) socketMeta[socket.id].spectating = matchId;
    callback?.({ success: true, match: {
      matchId, board: match.board, size: match.size, gameType: t.gameType, currentTurn: match.currentTurn, status: match.status,
      p1Nickname: t.players.get(match.p1)?.nickname||'?', p2Nickname: t.players.get(match.p2)?.nickname||'?',
      p1Id: match.p1, p2Id: match.p2,
      // Chess clocks (null for non-chess)
      p1TimeMs:   match.p1TimeMs  ?? null,
      p2TimeMs:   match.p2TimeMs  ?? null,
      chessIncMs: match.chessIncMs ?? null,
      turnStartedAt: match.turnClockStarted ?? null,
      turnDurationMs: t.gameType === 'chess'
        ? (match.currentTurn === match.p1 ? match.p1TimeMs : match.p2TimeMs)
        : (match.turnDurationMs || TURN_TIMEOUT_MS),
    }});
  });
  socket.on('stop_spectating', ({ matchId }) => {
    socket.leave(`spectate_${matchId}`);
    if (socketMeta[socket.id]) delete socketMeta[socket.id].spectating;
  });

  // ─── Player stats ─────────────────────────────────────────────────────────
  socket.on('get_player_stats', ({ roomCode, playerId }, callback) => {
    const t = tournaments[roomCode]; if (!t) return callback?.({ success: false });
    const p = t.players.get(playerId); if (!p) return callback?.({ success: false });
    const matchHistory = Array.from(t.matches.values())
      .filter(m => (m.p1===playerId||m.p2===playerId) && m.status==='finished')
      .map(m => {
        const isP1 = m.p1===playerId;
        const opp  = t.players.get(isP1?m.p2:m.p1);
        return {
          matchId: m.id, opponentNickname: opp?.nickname||'?', startedAt: m.startedAt,
          result: m.winner===playerId?'win':m.winner===null?'draw':'loss',
        };
      }).sort((a,b)=>b.startedAt-a.startedAt);
    callback?.({ success: true, stats: {
      id: p.id, nickname: p.nickname, elo: p.elo, score: p.score,
      wins: p.wins, draws: p.draws, losses: p.losses, streak: p.streak,
      ratedGames: p.ratedGames || 0,
      rank: getRankInfo(p.elo, p.ratedGames || 0), matchHistory, opponentCount: p.opponentHistory.size,
    }});
  });

  // ─── My match history (for students) ─────────────────────────────────────
  socket.on('get_my_history', ({ roomCode }, callback) => {
    const t = tournaments[roomCode]; if (!t) return callback?.({ success: false });
    const p = t.players.get(socket.id); if (!p) return callback?.({ success: false });
    const history = Array.from(t.matches.values())
      .filter(m => (m.p1===socket.id||m.p2===socket.id) && m.status==='finished')
      .map(m => {
        const isP1 = m.p1===socket.id;
        const opp  = t.players.get(isP1?m.p2:m.p1);
        return {
          opponentNickname: opp?.nickname||'?', startedAt: m.startedAt,
          result: m.winner===socket.id?'win':m.winner===null?'draw':'loss',
        };
      }).sort((a,b)=>b.startedAt-a.startedAt);
    callback?.({ success: true, history });
  });

  // ─── Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const meta = socketMeta[socket.id];
    if (!meta) return;
    const t = tournaments[meta.roomCode];
    if (!t) { delete socketMeta[socket.id]; return; }

    if (meta.role === 'player') {
      const player = t.players.get(socket.id);
      if (player) {
        // Check if player is in an active match
        let inActiveMatch = false;
        for (const [, match] of t.matches) {
          if (match.status === 'active' && (match.p1 === socket.id || match.p2 === socket.id)) {
            inActiveMatch = true;
            // Notify opponent that player is reconnecting
            const opponentId = match.p1 === socket.id ? match.p2 : match.p1;
            io.to(opponentId).emit('opponent_reconnecting', {
              nickname: player.nickname, waitMs: RECONNECT_WAIT_MS,
            });
            break;
          }
        }

        // Mark as reconnecting and start forfeit timer
        player.status    = 'reconnecting';
        player.socketId  = null;

        if (player.disconnectTimerId) clearTimeout(player.disconnectTimerId);
        player.disconnectTimerId = setTimeout(() => {
          if (player.status !== 'reconnecting') return; // already reconnected
          player.status = 'offline';
          // Forfeit active match
          for (const [, match] of t.matches) {
            if (match.status === 'active' && (match.p1 === player.id || match.p2 === player.id)) {
              const opponent = match.p1 === player.id ? match.p2 : match.p1;
              resolveGameOver(match, t, meta.roomCode, { winnerId: opponent, isDraw: false, opponentDisconnected: true });
              setTimeout(() => matchWaitingPlayers(meta.roomCode), 500);
              break;
            }
          }
          broadcastTournamentState(meta.roomCode);
        }, RECONNECT_WAIT_MS);
      }
    }

    delete socketMeta[socket.id];
    broadcastTournamentState(meta.roomCode);
    console.log(`[DISCONNECT] ${socket.id} (${meta.nickname}) — reconnect window open`);
  });
});

// ─── Serve React client in production ────────────────────────────────────────
if (IS_PROD) {
  const distDir = path.join(__dirname, '../client/dist');
  app.use(express.static(distDir));
  app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`LSTS Caro Tourney server running on http://localhost:${PORT}`);
  console.log(`  Multiple teacher logins are active.`);
  if (IS_PROD) console.log('  Mode: production (serving client static files)');
});
