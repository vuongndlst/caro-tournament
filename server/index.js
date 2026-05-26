const express = require('express');
const http    = require('http');
const path    = require('path');
const crypto  = require('crypto');
const { Server } = require('socket.io');
const cors   = require('cors');

const IS_PROD = process.env.NODE_ENV === 'production';

// ─── Teacher credentials (override via env vars) ──────────────────────────────
const TEACHER_USERNAME = process.env.TEACHER_USERNAME || 'giaovien';
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'lsts@2024';
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

const TURN_TIMEOUT_MS = 30_000;

// ─── In-memory state ──────────────────────────────────────────────────────────
const tournaments = {};
const socketMeta  = {};
const matchTimers = {}; // matchId → { timerId, startedAt }

// Admin auth sessions (token → { username, expiresAt })
const adminSessions = new Map();

// Finished tournament history (last 20)
const tournamentHistory = [];
const MAX_HISTORY = 20;

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function createAdminToken(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 h
  adminSessions.set(token, { username, expiresAt });
  return token;
}

function verifyAdminToken(token) {
  if (!token) return null;
  const session = adminSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) { adminSessions.delete(token); return null; }
  return session;
}

// ─── Rank helpers ─────────────────────────────────────────────────────────────
function getRankInfo(score) {
  if (score >= 150) return { name: 'Cao Thủ',   index: 5, emoji: '🔮', color: 'purple' };
  if (score >= 100) return { name: 'Kim Cương',  index: 4, emoji: '💎', color: 'cyan'   };
  if (score >= 50)  return { name: 'Vàng',       index: 3, emoji: '🏆', color: 'yellow' };
  if (score >= 25)  return { name: 'Bạc',        index: 2, emoji: '🥈', color: 'slate'  };
  if (score >= 10)  return { name: 'Đồng',       index: 1, emoji: '🥉', color: 'orange' };
  return                   { name: 'Gỗ',         index: 0, emoji: '🪵', color: 'amber'  };
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

// Returns { symbol, cells } or null. Enforces Vietnamese blocked-5 rule.
function checkWinner(board, row, col, size) {
  const player = board[row][col];
  if (!player) return null;

  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of directions) {
    let count = 1, blocked = 0;
    const cells = [[row, col]];

    let r = row + dr, c = col + dc;
    while (r >= 0 && r < size && c >= 0 && c < size && board[r][c] === player) {
      cells.push([r, c]); count++; r += dr; c += dc;
    }
    if (r >= 0 && r < size && c >= 0 && c < size && board[r][c] && board[r][c] !== player) blocked++;

    r = row - dr; c = col - dc;
    while (r >= 0 && r < size && c >= 0 && c < size && board[r][c] === player) {
      cells.push([r, c]); count++; r -= dr; c -= dc;
    }
    if (r >= 0 && r < size && c >= 0 && c < size && board[r][c] && board[r][c] !== player) blocked++;

    if (count >= 5 && !(count === 5 && blocked === 2)) return { symbol: player, cells };
  }
  return null;
}

function isBoardFull(board) {
  return board.every(row => row.every(cell => cell !== null));
}

function getTournamentPublicState(tournament) {
  const players = Array.from(tournament.players.values());
  const matches = Array.from(tournament.matches.values()).map(m => ({
    id: m.id,
    p1Nickname: tournament.players.get(m.p1)?.nickname,
    p2Nickname: tournament.players.get(m.p2)?.nickname,
    p1Id: m.p1,
    p2Id: m.p2,
    status: m.status,
    winner: m.winner,
  }));

  const leaderboard = players
    .map(p => ({
      id: p.id,
      nickname: p.nickname,
      score: p.score,
      wins: p.wins,
      draws: p.draws,
      losses: p.losses,
      status: p.status,
      streak: p.streak || 0,
      rank: getRankInfo(p.score),
    }))
    .sort((a, b) => b.score - a.score || b.wins - a.wins);

  const onlinePlayers = players
    .filter(p => p.status !== 'offline')
    .map(p => ({ id: p.id, nickname: p.nickname, status: p.status }));

  return {
    roomCode:   tournament.roomCode,
    name:       tournament.name,
    status:     tournament.status,
    players:    onlinePlayers,
    matches,
    leaderboard,
  };
}

function broadcastTournamentState(roomCode) {
  const t = tournaments[roomCode];
  if (t) io.to(roomCode).emit('room_state_update', getTournamentPublicState(t));
}

// ─── Turn Timer ───────────────────────────────────────────────────────────────
function clearMatchTimer(matchId) {
  if (matchTimers[matchId]) {
    clearTimeout(matchTimers[matchId].timerId);
    delete matchTimers[matchId];
  }
}

function startMatchTimer(match, roomCode) {
  clearMatchTimer(match.id);
  const startedAt = Date.now();
  matchTimers[match.id] = {
    startedAt,
    timerId: setTimeout(() => handleTurnTimeout(match.id, roomCode), TURN_TIMEOUT_MS),
  };

  const payload = {
    matchId: match.id,
    currentTurn: match.currentTurn,
    turnStartedAt: startedAt,
    turnDurationMs: TURN_TIMEOUT_MS,
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
  match.currentTurn = match.p1 === timedOutPlayerId ? match.p2 : match.p1;

  const payload = {
    matchId,
    row: null, col: null, symbol: null,
    currentTurn: match.currentTurn,
    board: match.board,
    timedOut: true,
    timedOutPlayerId,
  };
  io.to(match.p1).emit('move_made', payload);
  io.to(match.p2).emit('move_made', payload);
  io.to(`spectate_${match.id}`).emit('move_made', payload);

  startMatchTimer(match, roomCode);
}

// ─── Matchmaking ──────────────────────────────────────────────────────────────

/**
 * Lower score = better pairing.
 * Rank penalty:    decreases to 0 after 30 s of waiting.
 * History penalty: decreases to 0 after 20 s of waiting.
 */
function pairingScore(p1, p2, now) {
  const rankDiff = Math.abs(getRankInfo(p1.score).index - getRankInfo(p2.score).index);
  const p1Wait = (now - (p1.waitingSince || now)) / 1000;
  const p2Wait = (now - (p2.waitingSince || now)) / 1000;
  const minWait = Math.min(p1Wait, p2Wait);

  // Rank penalty fades out over 30 s
  const rankPenalty = rankDiff * Math.max(0, 1 - minWait / 30) * 100;

  // Opponent-history penalty fades out over 20 s
  const hasPlayed = p1.opponentHistory.has(p2.id) || p2.opponentHistory.has(p1.id);
  const historyPenalty = hasPlayed ? Math.max(0, 1 - minWait / 20) * 50 : 0;

  return rankPenalty + historyPenalty;
}

function createMatch(tournament, roomCode, p1, p2) {
  // Record opponent history
  p1.opponentHistory.add(p2.id);
  p2.opponentHistory.add(p1.id);

  const matchId = generateMatchId();
  const match = {
    id: matchId,
    p1: p1.id,
    p2: p2.id,
    board: createEmptyBoard(15),
    currentTurn: p1.id,
    status: 'active',
    winner: null,
    startedAt: Date.now(),
    size: 15,
  };

  tournament.matches.set(matchId, match);
  p1.status = 'playing'; p1.waitingSince = null;
  p2.status = 'playing'; p2.waitingSince = null;

  const turnStartedAt = Date.now();
  const base = {
    matchId, currentTurn: match.currentTurn, board: match.board, size: match.size,
    turnStartedAt, turnDurationMs: TURN_TIMEOUT_MS,
  };
  io.to(p1.id).emit('match_found', {
    ...base, opponentNickname: p2.nickname, opponentId: p2.id,
    yourSymbol: 'X', opponentSymbol: 'O',
  });
  io.to(p2.id).emit('match_found', {
    ...base, opponentNickname: p1.nickname, opponentId: p1.id,
    yourSymbol: 'O', opponentSymbol: 'X',
  });

  startMatchTimer(match, roomCode);
}

function matchWaitingPlayers(roomCode) {
  const tournament = tournaments[roomCode];
  if (!tournament) return;
  const now = Date.now();

  const waiting = Array.from(tournament.players.values()).filter(
    p => p.status === 'waiting' && p.socketId !== null
  );
  if (waiting.length < 2) return;

  // Enumerate all candidate pairs and score them
  const candidates = [];
  for (let i = 0; i < waiting.length; i++) {
    for (let j = i + 1; j < waiting.length; j++) {
      candidates.push({
        p1: waiting[i],
        p2: waiting[j],
        score: pairingScore(waiting[i], waiting[j], now),
      });
    }
  }
  candidates.sort((a, b) => a.score - b.score);

  // Greedy matching: pick best pair first, mark both as used
  const used = new Set();
  for (const { p1, p2 } of candidates) {
    if (!used.has(p1.id) && !used.has(p2.id)) {
      used.add(p1.id);
      used.add(p2.id);
      createMatch(tournament, roomCode, p1, p2);
    }
  }

  broadcastTournamentState(roomCode);
}

// ─── Game over helper ─────────────────────────────────────────────────────────
function resolveGameOver(match, tournament, roomCode, { winnerId, isDraw, opponentDisconnected = false, winningCells = null }) {
  clearMatchTimer(match.id);
  match.status  = 'finished';
  match.winner  = winnerId || null;

  if (isDraw) {
    [match.p1, match.p2].forEach(id => {
      const p = tournament.players.get(id);
      if (p) { p.draws++; p.score += 1; p.status = 'waiting'; p.streak = 0; p.waitingSince = Date.now(); }
    });
  } else if (winnerId) {
    const loserId = match.p1 === winnerId ? match.p2 : match.p1;
    const winner  = tournament.players.get(winnerId);
    const loser   = tournament.players.get(loserId);
    if (winner) { winner.wins++; winner.score += 3; winner.status = 'waiting'; winner.streak = (winner.streak || 0) + 1; winner.waitingSince = Date.now(); }
    if (loser)  { loser.losses++; loser.status = 'waiting'; loser.streak = 0; loser.waitingSince = Date.now(); }
  }

  const payload = {
    matchId: match.id, winnerId,
    winnerSymbol: winnerId ? (match.p1 === winnerId ? 'X' : 'O') : null,
    isDraw, opponentDisconnected, board: match.board, winningCells,
  };
  io.to(match.p1).emit('game_over', payload);
  io.to(match.p2).emit('game_over', payload);
  io.to(`spectate_${match.id}`).emit('game_over', { ...payload, isSpectating: true });
  broadcastTournamentState(roomCode);
}

// ─── REST API ─────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === TEACHER_USERNAME && password === TEACHER_PASSWORD) {
    const token = createAdminToken(username);
    console.log(`[AUTH] Login: ${username}`);
    return res.json({ success: true, token, username });
  }
  res.status(401).json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu!' });
});

app.get('/api/auth/me', (req, res) => {
  const token   = req.headers.authorization?.replace('Bearer ', '');
  const session = verifyAdminToken(token);
  if (session) return res.json({ success: true, username: session.username });
  res.status(401).json({ success: false });
});

app.get('/health', (req, res) => res.json({ status: 'ok', tournaments: Object.keys(tournaments).length }));

app.get('/api/history', (req, res) => {
  const token   = req.headers.authorization?.replace('Bearer ', '');
  const session = verifyAdminToken(token);
  if (!session) return res.status(401).json({ success: false });
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

  socket.on('create_tournament', ({ name, token } = {}, callback) => {
    const session = verifyAdminToken(token);
    if (!session) return callback?.({ success: false, message: 'Vui lòng đăng nhập để tạo giải đấu!' });

    let roomCode;
    do { roomCode = generateRoomCode(); } while (tournaments[roomCode]);

    const tournamentName = name?.trim() ||
      `Giải đấu ${new Date().toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;

    tournaments[roomCode] = {
      adminSocketId: socket.id,
      roomCode,
      name: tournamentName,
      players: new Map(),
      matches: new Map(),
      status: 'waiting',
      createdAt: Date.now(),
      adminUsername: session.username,
    };
    socketMeta[socket.id] = { roomCode, role: 'admin', nickname: 'Admin' };
    socket.join(roomCode);
    console.log(`[TOURNAMENT] Created: ${roomCode} — "${tournamentName}"`);
    callback({ success: true, roomCode, name: tournamentName });
    broadcastTournamentState(roomCode);
  });

  socket.on('admin_rejoin', ({ roomCode, token }, callback) => {
    const session = verifyAdminToken(token);
    if (!session) return callback?.({ success: false, message: 'Phiên đăng nhập hết hạn, vui lòng đăng nhập lại!' });
    const t = tournaments[roomCode];
    if (!t) return callback?.({ success: false, message: 'Phòng không tồn tại' });
    t.adminSocketId = socket.id;
    socketMeta[socket.id] = { roomCode, role: 'admin', nickname: 'Admin' };
    socket.join(roomCode);
    callback?.({ success: true, state: getTournamentPublicState(t) });
  });

  socket.on('join_room', ({ roomCode, nickname }, callback) => {
    const code = roomCode?.toUpperCase();
    const t    = tournaments[code];
    if (!t) return callback({ success: false, message: 'Mã phòng không tồn tại!' });
    if (t.status === 'finished') return callback({ success: false, message: 'Giải đấu đã kết thúc!' });
    if (!nickname?.trim()) return callback({ success: false, message: 'Vui lòng nhập biệt danh!' });

    const dup = Array.from(t.players.values()).find(
      p => p.nickname.toLowerCase() === nickname.trim().toLowerCase()
    );
    if (dup) return callback({ success: false, message: 'Biệt danh đã được dùng, hãy chọn tên khác!' });

    const player = {
      id: socket.id, socketId: socket.id, nickname: nickname.trim(),
      score: 0, wins: 0, draws: 0, losses: 0, status: 'waiting', streak: 0,
      opponentHistory: new Set(), // all opponents ever faced
      waitingSince: t.status === 'active' ? Date.now() : null,
    };
    t.players.set(socket.id, player);
    socketMeta[socket.id] = { roomCode: code, role: 'player', nickname: nickname.trim() };
    socket.join(code);

    console.log(`[JOIN] ${nickname} → ${code}`);
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
    // Mark all waiting players with a waitingSince timestamp
    const now = Date.now();
    for (const p of t.players.values()) {
      if (p.status === 'waiting') p.waitingSince = now;
    }
    io.to(roomCode).emit('tournament_started');
    matchWaitingPlayers(roomCode);
    callback?.({ success: true });
  });

  socket.on('end_tournament', ({ roomCode }, callback) => {
    const t = tournaments[roomCode];
    if (!t) return callback?.({ success: false, message: 'Phòng không tồn tại' });
    if (t.adminSocketId !== socket.id) return callback?.({ success: false, message: 'Không có quyền!' });

    for (const [, match] of t.matches) {
      if (match.status === 'active') {
        resolveGameOver(match, t, roomCode, { winnerId: null, isDraw: true });
      }
    }

    t.status = 'finished';
    t.finishedAt = Date.now();
    const finalState = getTournamentPublicState(t);

    // Save to history
    tournamentHistory.unshift({
      roomCode: t.roomCode,
      name: t.name,
      createdAt: t.createdAt,
      finishedAt: t.finishedAt,
      playerCount: t.players.size,
      matchCount: t.matches.size,
      leaderboard: finalState.leaderboard.slice(0, 10), // top 10
    });
    if (tournamentHistory.length > MAX_HISTORY) tournamentHistory.pop();

    io.to(roomCode).emit('tournament_ended', { leaderboard: finalState.leaderboard });
    broadcastTournamentState(roomCode);
    console.log(`[TOURNAMENT] Ended: ${roomCode} — "${t.name}"`);
    callback?.({ success: true, leaderboard: finalState.leaderboard });
  });

  socket.on('make_move', ({ matchId, row, col }, callback) => {
    const meta = socketMeta[socket.id];
    if (!meta) return callback?.({ success: false });
    const t = tournaments[meta.roomCode];
    if (!t) return callback?.({ success: false });
    const match = t.matches.get(matchId);
    if (!match || match.status !== 'active') return callback?.({ success: false, message: 'Trận đấu không hợp lệ' });
    if (match.currentTurn !== socket.id) return callback?.({ success: false, message: 'Chưa đến lượt bạn!' });
    if (match.board[row][col] !== null) return callback?.({ success: false, message: 'Ô này đã được đánh!' });

    clearMatchTimer(match.id);
    const symbol = match.p1 === socket.id ? 'X' : 'O';
    match.board[row][col] = symbol;

    const winResult = checkWinner(match.board, row, col, match.size);
    const draw      = !winResult && isBoardFull(match.board);

    const movePayload = { matchId, row, col, symbol, currentTurn: match.currentTurn, board: match.board };
    io.to(match.p1).emit('move_made', movePayload);
    io.to(match.p2).emit('move_made', movePayload);
    io.to(`spectate_${match.id}`).emit('move_made', movePayload);

    if (winResult || draw) {
      resolveGameOver(match, t, meta.roomCode, {
        winnerId: winResult ? socket.id : null,
        isDraw: !!draw,
        winningCells: winResult ? winResult.cells : null,
      });
    } else {
      match.currentTurn = match.p1 === socket.id ? match.p2 : match.p1;
      startMatchTimer(match, meta.roomCode);
    }

    callback?.({ success: true });
  });

  socket.on('request_next_match', ({ roomCode }) => {
    const t = tournaments[roomCode];
    if (!t || t.status !== 'active') return;
    const player = t.players.get(socket.id);
    if (!player || player.status !== 'waiting') return;
    player.waitingSince = player.waitingSince || Date.now();
    matchWaitingPlayers(roomCode);
  });

  // ─── Emoji reactions ─────────────────────────────────────────────────────
  socket.on('send_reaction', ({ matchId, emoji }) => {
    const meta = socketMeta[socket.id];
    if (!meta) return;
    const t = tournaments[meta.roomCode];
    if (!t) return;
    const match = t.matches.get(matchId);
    if (!match || match.status !== 'active') return;

    const opponent = match.p1 === socket.id ? match.p2 : match.p1;
    const payload  = { emoji, fromId: socket.id, matchId };
    io.to(opponent).emit('reaction_received', payload);
    io.to(`spectate_${matchId}`).emit('reaction_received', payload);
  });

  // ─── Spectator mode ───────────────────────────────────────────────────────
  socket.on('spectate_match', ({ matchId, roomCode }, callback) => {
    const code = roomCode?.toUpperCase();
    const t    = tournaments[code];
    if (!t) return callback?.({ success: false, message: 'Phòng không tồn tại' });
    const match = t.matches.get(matchId);
    if (!match) return callback?.({ success: false, message: 'Trận không tồn tại' });

    socket.join(`spectate_${matchId}`);
    if (socketMeta[socket.id]) socketMeta[socket.id].spectating = matchId;

    const p1 = t.players.get(match.p1);
    const p2 = t.players.get(match.p2);
    callback?.({
      success: true,
      match: {
        matchId, board: match.board, size: match.size,
        currentTurn: match.currentTurn, status: match.status,
        p1Nickname: p1?.nickname || '?', p2Nickname: p2?.nickname || '?',
        p1Id: match.p1, p2Id: match.p2,
      },
    });
  });

  socket.on('stop_spectating', ({ matchId }) => {
    socket.leave(`spectate_${matchId}`);
    if (socketMeta[socket.id]) delete socketMeta[socket.id].spectating;
  });

  // ─── Player stats (admin) ─────────────────────────────────────────────────
  socket.on('get_player_stats', ({ roomCode, playerId }, callback) => {
    const t = tournaments[roomCode];
    if (!t) return callback?.({ success: false });
    const p = t.players.get(playerId);
    if (!p) return callback?.({ success: false });

    const matchHistory = Array.from(t.matches.values())
      .filter(m => (m.p1 === playerId || m.p2 === playerId) && m.status === 'finished')
      .map(m => {
        const isP1 = m.p1 === playerId;
        const opponentId = isP1 ? m.p2 : m.p1;
        const opponent   = t.players.get(opponentId);
        const result = m.winner === playerId ? 'win' : m.winner === null ? 'draw' : 'loss';
        return { matchId: m.id, opponentNickname: opponent?.nickname || '?', result, startedAt: m.startedAt };
      })
      .sort((a, b) => b.startedAt - a.startedAt);

    callback?.({
      success: true,
      stats: {
        id: p.id,
        nickname: p.nickname,
        score: p.score,
        wins: p.wins,
        draws: p.draws,
        losses: p.losses,
        streak: p.streak,
        rank: getRankInfo(p.score),
        matchHistory,
        opponentCount: p.opponentHistory.size,
      },
    });
  });

  // ─── Disconnect ───────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const meta = socketMeta[socket.id];
    if (!meta) return;
    const t = tournaments[meta.roomCode];
    if (!t) { delete socketMeta[socket.id]; return; }

    if (meta.role === 'player') {
      const player = t.players.get(socket.id);
      for (const [, match] of t.matches) {
        if (match.status === 'active' && (match.p1 === socket.id || match.p2 === socket.id)) {
          const opponent = match.p1 === socket.id ? match.p2 : match.p1;
          resolveGameOver(match, t, meta.roomCode, {
            winnerId: opponent, isDraw: false, opponentDisconnected: true,
          });
          setTimeout(() => matchWaitingPlayers(meta.roomCode), 500);
          break;
        }
      }
      if (player) { player.status = 'offline'; player.socketId = null; }
    }

    delete socketMeta[socket.id];
    broadcastTournamentState(meta.roomCode);
    console.log(`[DISCONNECT] ${socket.id} (${meta.nickname})`);
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
  console.log(`  Teacher login: ${TEACHER_USERNAME} / ${TEACHER_PASSWORD}`);
  if (IS_PROD) console.log('  Mode: production (serving client static files)');
});
