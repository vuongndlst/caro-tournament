const express = require('express');
const http    = require('http');
const path    = require('path');
const { Server } = require('socket.io');
const cors   = require('cors');

const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    // In production the client is served from the same origin,
    // so CORS is not strictly needed — but allow it for flexibility.
    origin: IS_PROD
      ? (process.env.CLIENT_ORIGIN || '*')
      : ['http://localhost:5173', 'http://localhost:4173'],
    methods: ['GET', 'POST'],
  },
});

const TURN_TIMEOUT_MS = 30_000;

// ─── In-memory state ─────────────────────────────────────────────────────────
const tournaments = {};
const socketMeta = {};
// matchTimers[matchId] = { timerId, startedAt }
const matchTimers = {};

// ─── Helpers ─────────────────────────────────────────────────────────────────
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

// Returns { symbol, cells: [[r,c],...] } or null
function checkWinner(board, row, col, size) {
  const player = board[row][col];
  if (!player) return null;

  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

  for (const [dr, dc] of directions) {
    let count = 1;
    let blocked = 0;
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

    if (count >= 5) {
      if (count === 5 && blocked === 2) continue; // Vietnamese rule
      return { symbol: player, cells };
    }
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
    }))
    .sort((a, b) => b.score - a.score || b.wins - a.wins);

  // Only show online players in the "who is in the room" list
  const onlinePlayers = players
    .filter(p => p.status !== 'offline')
    .map(p => ({ id: p.id, nickname: p.nickname, status: p.status }));

  return {
    roomCode: tournament.roomCode,
    status: tournament.status,
    players: onlinePlayers,
    matches,
    leaderboard, // Always includes everyone (online + offline)
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
    timerId: setTimeout(() => {
      handleTurnTimeout(match.id, roomCode);
    }, TURN_TIMEOUT_MS),
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

  const prevTurn = match.currentTurn;
  match.currentTurn = match.p1 === prevTurn ? match.p2 : match.p1;

  const payload = {
    matchId,
    row: null, col: null, symbol: null,
    currentTurn: match.currentTurn,
    board: match.board,
    timedOut: true,
    timedOutPlayerId: prevTurn,
  };
  io.to(match.p1).emit('move_made', payload);
  io.to(match.p2).emit('move_made', payload);
  io.to(`spectate_${match.id}`).emit('move_made', payload);

  startMatchTimer(match, roomCode);
}

// ─── Matchmaking ──────────────────────────────────────────────────────────────
function matchWaitingPlayers(roomCode) {
  const tournament = tournaments[roomCode];
  if (!tournament) return;

  const waiting = Array.from(tournament.players.values()).filter(
    p => p.status === 'waiting' && p.socketId !== null
  );

  // Shuffle to randomise pairings each round
  for (let i = waiting.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [waiting[i], waiting[j]] = [waiting[j], waiting[i]];
  }

  // Greedy pairing: prefer partners that are NOT the last opponent
  const used = new Set();
  const pairs = [];

  for (let i = 0; i < waiting.length; i++) {
    if (used.has(waiting[i].id)) continue;
    const p1 = waiting[i];

    // First try to find a partner who is not the last opponent
    let partner = null;
    for (let j = i + 1; j < waiting.length; j++) {
      if (used.has(waiting[j].id)) continue;
      if (waiting[j].id !== p1.lastOpponent) {
        partner = waiting[j];
        break;
      }
    }
    // Fallback: if everyone left is the last opponent, pair with them anyway
    if (!partner) {
      for (let j = i + 1; j < waiting.length; j++) {
        if (!used.has(waiting[j].id)) { partner = waiting[j]; break; }
      }
    }
    if (partner) {
      pairs.push([p1, partner]);
      used.add(p1.id);
      used.add(partner.id);
    }
  }

  for (const [p1, p2] of pairs) {
    // Record last opponent so they won't be rematched next round
    p1.lastOpponent = p2.id;
    p2.lastOpponent = p1.id;

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
    p1.status = 'playing';
    p2.status = 'playing';

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

    match._turnStartedAt = turnStartedAt;
    startMatchTimer(match, roomCode);
  }

  broadcastTournamentState(roomCode);
}

// ─── Game over helper ─────────────────────────────────────────────────────────
function resolveGameOver(match, tournament, roomCode, { winnerId, isDraw, opponentDisconnected = false, winningCells = null }) {
  clearMatchTimer(match.id);
  match.status = 'finished';
  match.winner = winnerId || null;

  if (isDraw) {
    [match.p1, match.p2].forEach(id => {
      const p = tournament.players.get(id);
      if (p) { p.draws++; p.score += 1; p.status = 'waiting'; p.streak = 0; }
    });
  } else if (winnerId) {
    const loserId = match.p1 === winnerId ? match.p2 : match.p1;
    const winner = tournament.players.get(winnerId);
    const loser  = tournament.players.get(loserId);
    if (winner) { winner.wins++; winner.score += 3; winner.status = 'waiting'; winner.streak = (winner.streak || 0) + 1; }
    if (loser)  { loser.losses++; loser.status = 'waiting'; loser.streak = 0; }
  }

  const payload = {
    matchId: match.id,
    winnerId,
    winnerSymbol: winnerId ? (match.p1 === winnerId ? 'X' : 'O') : null,
    isDraw,
    opponentDisconnected,
    board: match.board,
    winningCells,
  };
  io.to(match.p1).emit('game_over', payload);
  io.to(match.p2).emit('game_over', payload);
  // Notify spectators too
  io.to(`spectate_${match.id}`).emit('game_over', { ...payload, isSpectating: true });
  broadcastTournamentState(roomCode);
}

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[CONNECT] ${socket.id}`);

  socket.on('create_tournament', (_, callback) => {
    let roomCode;
    do { roomCode = generateRoomCode(); } while (tournaments[roomCode]);

    tournaments[roomCode] = {
      adminSocketId: socket.id,
      roomCode,
      players: new Map(),
      matches: new Map(),
      status: 'waiting',
    };
    socketMeta[socket.id] = { roomCode, role: 'admin', nickname: 'Admin' };
    socket.join(roomCode);
    console.log(`[TOURNAMENT] Created: ${roomCode}`);
    callback({ success: true, roomCode });
    broadcastTournamentState(roomCode);
  });

  socket.on('admin_rejoin', ({ roomCode }, callback) => {
    const t = tournaments[roomCode];
    if (!t) return callback({ success: false, message: 'Phòng không tồn tại' });
    t.adminSocketId = socket.id;
    socketMeta[socket.id] = { roomCode, role: 'admin', nickname: 'Admin' };
    socket.join(roomCode);
    callback({ success: true, state: getTournamentPublicState(t) });
  });

  socket.on('join_room', ({ roomCode, nickname }, callback) => {
    const code = roomCode?.toUpperCase();
    const t = tournaments[code];
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
      lastOpponent: null, // Track last opponent to avoid immediate rematches
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
    io.to(roomCode).emit('tournament_started');
    matchWaitingPlayers(roomCode);
    callback?.({ success: true });
  });

  socket.on('end_tournament', ({ roomCode }, callback) => {
    const t = tournaments[roomCode];
    if (!t) return callback?.({ success: false, message: 'Phòng không tồn tại' });
    if (t.adminSocketId !== socket.id) return callback?.({ success: false, message: 'Không có quyền!' });

    // Resolve all still-active matches as draws (fair to all players)
    for (const [, match] of t.matches) {
      if (match.status === 'active') {
        resolveGameOver(match, t, roomCode, { winnerId: null, isDraw: true });
      }
    }

    t.status = 'finished';
    const finalState = getTournamentPublicState(t);
    io.to(roomCode).emit('tournament_ended', { leaderboard: finalState.leaderboard });
    broadcastTournamentState(roomCode);
    console.log(`[TOURNAMENT] Ended: ${roomCode}`);
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
    const draw = !winResult && isBoardFull(match.board);

    if (winResult || draw) {
      const movePayload = { matchId, row, col, symbol, currentTurn: match.currentTurn, board: match.board };
      io.to(match.p1).emit('move_made', movePayload);
      io.to(match.p2).emit('move_made', movePayload);
      io.to(`spectate_${match.id}`).emit('move_made', movePayload);
      resolveGameOver(match, t, meta.roomCode, {
        winnerId: winResult ? socket.id : null,
        isDraw: !!draw,
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

    callback?.({ success: true });
  });

  socket.on('request_next_match', ({ roomCode }) => {
    const t = tournaments[roomCode];
    if (!t || t.status !== 'active') return;
    const player = t.players.get(socket.id);
    if (!player || player.status !== 'waiting') return;
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
    const payload = { emoji, fromId: socket.id, matchId };
    io.to(opponent).emit('reaction_received', payload);
    io.to(`spectate_${matchId}`).emit('reaction_received', payload);
  });

  // ─── Spectator mode ───────────────────────────────────────────────────────
  socket.on('spectate_match', ({ matchId, roomCode }, callback) => {
    const code = roomCode?.toUpperCase();
    const t = tournaments[code];
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
        matchId,
        board: match.board,
        size: match.size,
        currentTurn: match.currentTurn,
        status: match.status,
        p1Nickname: p1?.nickname || '?',
        p2Nickname: p2?.nickname || '?',
        p1Id: match.p1,
        p2Id: match.p2,
      },
    });
  });

  socket.on('stop_spectating', ({ matchId }) => {
    socket.leave(`spectate_${matchId}`);
    if (socketMeta[socket.id]) delete socketMeta[socket.id].spectating;
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
            winnerId: opponent,
            isDraw: false,
            opponentDisconnected: true,
          });
          setTimeout(() => matchWaitingPlayers(meta.roomCode), 500);
          break;
        }
      }

      if (player) {
        player.status = 'offline';
        player.socketId = null;
      }
    }

    delete socketMeta[socket.id];
    broadcastTournamentState(meta.roomCode);
    console.log(`[DISCONNECT] ${socket.id} (${meta.nickname})`);
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', tournaments: Object.keys(tournaments).length }));

app.get('/leaderboard/:roomCode', (req, res) => {
  const t = tournaments[req.params.roomCode.toUpperCase()];
  if (!t) return res.status(404).json({ error: 'Room not found' });
  res.json(getTournamentPublicState(t));
});

// ─── Serve React client in production ────────────────────────────────────────
if (IS_PROD) {
  const distDir = path.join(__dirname, '../client/dist');
  app.use(express.static(distDir));
  // SPA fallback — any unknown route serves index.html
  app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`CaroTourney server running on http://localhost:${PORT}`);
  if (IS_PROD) console.log('  Mode: production (serving client static files)');
});
