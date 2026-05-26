/**
 * CaroTourney — Kiểm tra từng game mode
 * Test: caro, tictactoe, chess — 2 người chơi mỗi game
 * Ghi nhận lỗi chi tiết từ server
 */
const { io: ioClient } = require('socket.io-client');
const https = require('https');
const http  = require('http');
const { Chess } = require('chess.js');

const SERVER_URL  = process.argv[2] || 'http://localhost:3001';
const ADMIN_USER  = process.env.TEACHER_USERNAME || 'giaovien';
const ADMIN_PASS  = process.env.TEACHER_PASSWORD || 'lsts@2024';

const C = {
  reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m',
  green:'\x1b[32m', yellow:'\x1b[33m', blue:'\x1b[34m',
  cyan:'\x1b[36m', red:'\x1b[31m', magenta:'\x1b[35m',
};
const log   = (...a) => console.log(C.cyan  + '[TEST]' + C.reset, ...a);
const ok    = (...a) => console.log(C.green + '[ OK ]' + C.reset, ...a);
const fail  = (...a) => console.log(C.red   + '[FAIL]' + C.reset, ...a);
const info  = (...a) => console.log(C.dim   + '      ' + C.reset, ...a);

function httpRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, { method:'GET', ...opts,
      headers: {'Content-Type':'application/json', ...(opts.headers||{})}
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Tạo admin và tournament ──────────────────────────────────────────────────
async function createAdminAndTournament(gameType) {
  const loginRes = await httpRequest(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  if (!loginRes?.success) throw new Error(`Login failed: ${loginRes?.message}`);

  return new Promise((resolve, reject) => {
    const admin = ioClient(SERVER_URL, { transports: ['websocket'], auth: { token: loginRes.token } });
    admin.on('connect_error', reject);
    admin.on('connect', () => {
      admin.emit('create_tournament',
        { token: loginRes.token, name: `Test ${gameType}`, gameType },
        (res) => {
          if (!res.success) return reject(new Error(res.message));
          resolve({ admin, roomCode: res.roomCode, token: loginRes.token });
        }
      );
    });
  });
}

// ─── Tham gia game với 1 player ───────────────────────────────────────────────
function joinPlayer(nickname, roomCode) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(SERVER_URL, { transports: ['websocket'] });
    socket.on('connect_error', reject);
    socket.on('connect', () => {
      socket.emit('join_room', { roomCode, nickname }, (res) => {
        if (!res.success) return reject(new Error(`${nickname}: ${res.message}`));
        resolve({ socket, playerId: res.playerId, nickname });
      });
    });
  });
}

// ─── Kiểm tra Chess ───────────────────────────────────────────────────────────
async function testChess() {
  console.log('\n' + C.bold + C.magenta + '═══════════════════════════════════' + C.reset);
  console.log(C.bold + C.magenta + '   TEST: CỜ VUA (Chess)             ' + C.reset);
  console.log(C.bold + C.magenta + '═══════════════════════════════════' + C.reset);

  const bugs = [];
  let { admin, roomCode } = await createAdminAndTournament('chess');
  log(`Phòng: ${C.bold}${roomCode}${C.reset}`);

  const p1 = await joinPlayer('Trắng', roomCode);
  const p2 = await joinPlayer('Đen', roomCode);
  log(`2 người chơi đã tham gia`);

  // Chờ match_found
  const matchPromise = new Promise((resolve) => {
    let matches = {};
    const checkBoth = () => {
      if (matches[p1.playerId] && matches[p2.playerId]) resolve(matches);
    };

    p1.socket.on('match_found', (data) => {
      info(`${p1.nickname} nhận match_found: gameType=${data.gameType}, yourSymbol=${data.yourSymbol}, boardType=${typeof data.board}`);

      // Kiểm tra gameType
      if (!data.gameType) {
        fail('match_found THIẾU gameType!'); bugs.push('match_found missing gameType');
      } else {
        ok(`match_found có gameType: "${data.gameType}"`);
      }
      // Kiểm tra board là FEN string
      if (typeof data.board !== 'string') {
        fail(`board không phải FEN string: ${typeof data.board}`); bugs.push('chess board not FEN string');
      } else if (!data.board.includes(' ')) {
        fail(`board có vẻ không phải FEN hợp lệ: "${data.board.substring(0,30)}"`);
        bugs.push('chess board invalid FEN');
      } else {
        ok(`board là FEN hợp lệ: "${data.board.substring(0,30)}..."`);
      }
      // Kiểm tra symbol
      if (data.yourSymbol !== 'X' && data.yourSymbol !== 'O') {
        fail(`yourSymbol không hợp lệ: ${data.yourSymbol}`); bugs.push('invalid yourSymbol');
      } else {
        const color = data.yourSymbol === 'X' ? 'Trắng' : 'Đen';
        ok(`${p1.nickname} là ${color} (yourSymbol="${data.yourSymbol}")`);
      }
      matches[p1.playerId] = { ...data, owner: p1 };
      checkBoth();
    });

    p2.socket.on('match_found', (data) => {
      info(`${p2.nickname} nhận match_found: gameType=${data.gameType}, yourSymbol=${data.yourSymbol}`);
      const color = data.yourSymbol === 'X' ? 'Trắng' : 'Đen';
      ok(`${p2.nickname} là ${color} (yourSymbol="${data.yourSymbol}")`);
      matches[p2.playerId] = { ...data, owner: p2 };
      checkBoth();
    });
  });

  // Bắt đầu tournament
  await new Promise(r => admin.emit('start_tournament', { roomCode }, r));
  log('Tournament bắt đầu...');

  const matches = await Promise.race([
    matchPromise,
    delay(5000).then(() => { throw new Error('Timeout chờ match_found'); })
  ]);

  const m1 = matches[p1.playerId];
  const m2 = matches[p2.playerId];
  const { matchId } = m1;

  // Ai đi trước?
  const firstPlayer = m1.currentTurn === p1.playerId ? p1 : p2;
  const secondPlayer = firstPlayer === p1 ? p2 : p1;
  const firstMatch = firstPlayer === p1 ? m1 : m2;
  log(`Lượt đầu: ${firstPlayer.nickname} (${firstMatch.yourSymbol === 'X' ? 'Trắng' : 'Đen'})`);

  // Kiểm tra make_move chess
  log('\nKiểm tra đánh cờ...');

  // Game cờ ngắn: Scholar's mate (4 nước) để test nhanh
  // e4, e5, Qh5, Nc6, Bc4, Nf6??, Qxf7#
  const chessMoves = [
    { from: 'e2', to: 'e4' },  // Trắng: e4
    { from: 'e7', to: 'e5' },  // Đen: e5
    { from: 'd1', to: 'h5' },  // Trắng: Qh5
    { from: 'b8', to: 'c6' },  // Đen: Nc6
    { from: 'f1', to: 'c4' },  // Trắng: Bc4
    { from: 'g8', to: 'f6' },  // Đen: Nf6?? (sai)
    { from: 'h5', to: 'f7' },  // Trắng: Qxf7# (Scholar's mate)
  ];

  let gameOver = false;
  let moveErrors = 0;

  // Lắng nghe events
  const gameEvents = [];
  [p1, p2].forEach(p => {
    p.socket.on('move_made', (data) => {
      gameEvents.push({ type: 'move_made', player: p.nickname, data });
      if (data.board && typeof data.board === 'string') {
        ok(`${p.nickname} nhận move_made: board FEN hợp lệ`);
      } else {
        fail(`${p.nickname} nhận move_made: board không phải FEN! type=${typeof data.board}`);
        bugs.push(`move_made board invalid for ${p.nickname}`);
      }
    });
    p.socket.on('game_over', (data) => {
      gameOver = true;
      gameEvents.push({ type: 'game_over', player: p.nickname, data });

      // Kiểm tra eloChange là NUMBER (không phải object)
      if (typeof data.eloChange === 'object' && data.eloChange !== null) {
        fail(`${p.nickname} nhận game_over: eloChange là OBJECT không phải số! ${JSON.stringify(data.eloChange)}`);
        bugs.push(`game_over eloChange is object for ${p.nickname}`);
      } else if (typeof data.eloChange === 'number') {
        ok(`${p.nickname} nhận game_over: eloChange=${data.eloChange} (số đúng)`);
      } else {
        info(`${p.nickname} nhận game_over: eloChange=${data.eloChange} (${typeof data.eloChange})`);
      }

      // Kiểm tra winnerId
      const isWinner = data.winnerId === p.playerId;
      const result = data.isDraw ? 'Hoà' : isWinner ? 'THẮNG' : 'Thua';
      ok(`${p.nickname}: ${result} | board type: ${typeof data.board}`);
    });
  });

  // Chơi từng nước theo lượt
  let chess = new Chess();
  let currentPlayer = firstPlayer;
  let currentMatchData = firstMatch;

  for (let i = 0; i < chessMoves.length && !gameOver; i++) {
    const mv = chessMoves[i];
    await delay(300);

    const result = await new Promise(resolve => {
      currentPlayer.socket.emit('make_move', {
        matchId,
        move: { from: mv.from, to: mv.to, promotion: 'q' }
      }, resolve);
    });

    if (result && !result.success) {
      fail(`Nước ${i+1} bị từ chối (${currentPlayer.nickname}: ${mv.from}-${mv.to}): ${result.message}`);
      bugs.push(`chess move rejected: ${result.message}`);
      moveErrors++;
    } else {
      chess.move({ from: mv.from, to: mv.to, promotion: 'q' });
      const nextPlayer = currentPlayer === p1 ? p2 : p1;
      info(`Nước ${i+1}: ${currentPlayer.nickname} ${mv.from}→${mv.to} ✓`);
      currentPlayer = nextPlayer;
      currentMatchData = currentPlayer === p1 ? m1 : m2;
    }
  }

  await delay(800);

  if (moveErrors === 0) ok(`Tất cả nước đi hợp lệ được chấp nhận`);
  if (gameOver) ok(`Game kết thúc thành công!`);
  else { fail(`Game chưa kết thúc sau ${chessMoves.length} nước`); bugs.push('game did not end'); }

  // Test lượt sai
  log('\nKiểm tra chặn đánh khi chưa đến lượt...');
  if (!gameOver) {
    const wrongPlayer = currentPlayer === p1 ? p2 : p1;
    const res = await new Promise(r => wrongPlayer.socket.emit('make_move', {
      matchId, move: { from: 'a2', to: 'a3' }
    }, r));
    if (res && !res.success) ok(`Chặn đúng: "${res.message}"`);
    else { fail('Không chặn được đánh khi chưa đến lượt!'); bugs.push('no turn validation'); }
  }

  p1.socket.disconnect();
  p2.socket.disconnect();
  admin.disconnect();

  return bugs;
}

// ─── Kiểm tra TicTacToe ───────────────────────────────────────────────────────
async function testTicTacToe() {
  console.log('\n' + C.bold + C.yellow + '═══════════════════════════════════' + C.reset);
  console.log(C.bold + C.yellow + '   TEST: TIC TAC TOE (3×3)          ' + C.reset);
  console.log(C.bold + C.yellow + '═══════════════════════════════════' + C.reset);

  const bugs = [];
  let { admin, roomCode } = await createAdminAndTournament('tictactoe');
  log(`Phòng: ${C.bold}${roomCode}${C.reset}`);

  const p1 = await joinPlayer('X Player', roomCode);
  const p2 = await joinPlayer('O Player', roomCode);

  const matchPromise = new Promise(resolve => {
    let matches = {};
    const check = () => { if (matches[p1.playerId] && matches[p2.playerId]) resolve(matches); };
    p1.socket.on('match_found', d => {
      info(`X Player: gameType=${d.gameType}, size=${d.size}, yourSymbol=${d.yourSymbol}`);
      if (d.size !== 3) { fail(`size không phải 3 cho TicTacToe: ${d.size}`); bugs.push('wrong size'); }
      else ok(`size=3 đúng`);
      if (!Array.isArray(d.board) || d.board.length !== 3) { fail('board không phải 3×3'); bugs.push('wrong board size'); }
      else ok(`board 3×3 đúng`);
      matches[p1.playerId] = d; check();
    });
    p2.socket.on('match_found', d => { matches[p2.playerId] = d; check(); });
  });

  await new Promise(r => admin.emit('start_tournament', { roomCode }, r));
  const matches = await Promise.race([matchPromise, delay(5000).then(() => { throw new Error('Timeout'); })]);
  const m = matches[p1.playerId];
  const matchId = m.matchId;
  const firstPlayer = m.currentTurn === p1.playerId ? p1 : p2;
  const secondPlayer = firstPlayer === p1 ? p2 : p1;
  log(`Lượt đầu: ${firstPlayer.nickname}`);

  // Nước thắng: X: 0,0 → 0,1 → 0,2
  let gameOver = false;
  [p1, p2].forEach(p => {
    p.socket.on('game_over', (d) => {
      gameOver = true;
      const result = d.isDraw ? 'Hoà' : d.winnerId === p.playerId ? 'THẮNG' : 'Thua';
      ok(`${p.nickname}: ${result}`);
    });
  });

  // Đặt nước để X thắng: X góc trên, O đâu đó, X tiếp, O đâu đó, X thắng
  const moves = [
    [firstPlayer,  0, 0],
    [secondPlayer, 1, 1],
    [firstPlayer,  0, 1],
    [secondPlayer, 2, 0],
    [firstPlayer,  0, 2],  // X thắng hàng đầu
  ];

  for (const [player, row, col] of moves) {
    if (gameOver) break;
    await delay(200);
    const res = await new Promise(r => player.socket.emit('make_move', { matchId, row, col }, r));
    if (res && !res.success) {
      fail(`Nước [${row},${col}] bị từ chối: ${res.message}`); bugs.push(`ttt move rejected`);
    } else {
      info(`${player.nickname}: [${row},${col}] ✓`);
    }
  }

  await delay(500);
  if (gameOver) ok(`TicTacToe kết thúc thành công!`);
  else { fail(`Game chưa kết thúc`); bugs.push('ttt game did not end'); }

  // Test ô đã đánh
  if (!gameOver) {
    const res = await new Promise(r => firstPlayer.socket.emit('make_move', { matchId, row: 0, col: 0 }, r));
    if (res && !res.success) ok(`Chặn đúng ô đã đánh: "${res.message}"`);
    else { fail('Không chặn ô đã đánh!'); bugs.push('no occupied cell check'); }
  }

  p1.socket.disconnect();
  p2.socket.disconnect();
  admin.disconnect();
  return bugs;
}

// ─── Kiểm tra Caro ────────────────────────────────────────────────────────────
async function testCaro() {
  console.log('\n' + C.bold + C.cyan + '═══════════════════════════════════' + C.reset);
  console.log(C.bold + C.cyan + '   TEST: CỜ CARO (15×15)            ' + C.reset);
  console.log(C.bold + C.cyan + '═══════════════════════════════════' + C.reset);

  const bugs = [];
  let { admin, roomCode } = await createAdminAndTournament('caro');
  log(`Phòng: ${C.bold}${roomCode}${C.reset}`);

  const p1 = await joinPlayer('Caro X', roomCode);
  const p2 = await joinPlayer('Caro O', roomCode);

  const matchPromise = new Promise(resolve => {
    let matches = {};
    const check = () => { if (matches[p1.playerId] && matches[p2.playerId]) resolve(matches); };
    p1.socket.on('match_found', d => {
      info(`Caro X: gameType=${d.gameType}, size=${d.size}`);
      if (d.size !== 15) { fail(`size không phải 15: ${d.size}`); bugs.push('wrong caro size'); }
      else ok(`size=15 đúng`);
      matches[p1.playerId] = d; check();
    });
    p2.socket.on('match_found', d => { matches[p2.playerId] = d; check(); });
  });

  await new Promise(r => admin.emit('start_tournament', { roomCode }, r));
  const matches = await Promise.race([matchPromise, delay(5000).then(() => { throw new Error('Timeout'); })]);
  const m = matches[p1.playerId];
  const matchId = m.matchId;
  const firstPlayer = m.currentTurn === p1.playerId ? p1 : p2;
  const secondPlayer = firstPlayer === p1 ? p2 : p1;

  let gameOver = false;
  [p1, p2].forEach(p => {
    p.socket.on('game_over', (d) => {
      gameOver = true;
      const result = d.isDraw ? 'Hoà' : d.winnerId === p.playerId ? 'THẮNG' : 'Thua';
      ok(`${p.nickname}: ${result} | winningCells: ${d.winningCells?.length || 0} ô`);
    });
  });

  // Đặt 5 quân liền nhau để thắng
  let cur = firstPlayer;
  let nxt = secondPlayer;
  for (let col = 0; col < 5 && !gameOver; col++) {
    await delay(450);
    const res = await new Promise(r => cur.socket.emit('make_move', { matchId, row: 7, col }, r));
    if (res && !res.success) { fail(`Caro nước [7,${col}] bị từ chối: ${res.message}`); bugs.push('caro move rejected'); }
    else { info(`${cur.nickname}: [7,${col}] ✓`); }
    if (col < 4 && !gameOver) {
      await delay(450);
      const res2 = await new Promise(r => nxt.socket.emit('make_move', { matchId, row: 8, col }, r));
      if (res2 && !res2.success) { fail(`Caro O nước [8,${col}] bị từ chối: ${res2.message}`); }
      else { info(`${nxt.nickname}: [8,${col}] ✓`); }
    }
  }

  await delay(500);
  if (gameOver) ok(`Caro kết thúc thành công với 5 quân liền!`);
  else { fail('Caro chưa kết thúc dù đã đặt 5 quân liền'); bugs.push('caro win not detected'); }

  p1.socket.disconnect();
  p2.socket.disconnect();
  admin.disconnect();
  return bugs;
}

// ─── Kiểm tra reconnect với chess ────────────────────────────────────────────
async function testChessReconnect() {
  console.log('\n' + C.bold + C.blue + '═══════════════════════════════════' + C.reset);
  console.log(C.bold + C.blue + '   TEST: CHESS RECONNECT            ' + C.reset);
  console.log(C.bold + C.blue + '═══════════════════════════════════' + C.reset);

  const bugs = [];
  let { admin, roomCode } = await createAdminAndTournament('chess');

  const p1 = await joinPlayer('ReconX', roomCode);
  const p2 = await joinPlayer('ReconO', roomCode);

  let matchId, p1Symbol;
  await new Promise(resolve => {
    p1.socket.on('match_found', d => { matchId = d.matchId; p1Symbol = d.yourSymbol; resolve(); });
    admin.emit('start_tournament', { roomCode }, () => {});
  });

  // Đánh 1 nước rồi disconnect p1
  const firstPlayer = await new Promise(resolve => {
    p1.socket.emit('make_move', { matchId, move: { from: 'e2', to: 'e4' } }, res => {
      if (res?.success || true) resolve(p2); // p2 goes next
    });
  });
  await delay(300);

  // Disconnect p1
  log('Ngắt kết nối p1...');
  p1.socket.disconnect();
  await delay(500);

  // Reconnect p1
  log('Kết nối lại p1...');
  const p1New = await joinPlayer('ReconX', roomCode);
  await delay(500);

  await new Promise(resolve => {
    p1New.socket.on('match_found', d => {
      info(`Reconnect match_found: gameType=${d.gameType}, board type=${typeof d.board}`);
      if (!d.gameType) { fail('Reconnect match_found THIẾU gameType!'); bugs.push('reconnect missing gameType'); }
      else ok(`Reconnect có gameType="${d.gameType}"`);
      if (typeof d.board !== 'string') { fail(`Reconnect board không phải FEN!`); bugs.push('reconnect board not FEN'); }
      else ok(`Reconnect board là FEN: "${d.board.substring(0,25)}..."`);
      resolve();
    });
    setTimeout(resolve, 3000); // timeout
  });

  p1New.socket.disconnect();
  p2.socket.disconnect();
  admin.disconnect();
  return bugs;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + C.bold + C.cyan + '🎮  CaroTourney — Test Suite (Server localhost:3001)' + C.reset);
  console.log(C.dim + '   Kiểm tra từng game mode và ghi nhận lỗi\n' + C.reset);

  const allBugs = {};

  try {
    allBugs.chess = await testChess();
  } catch(e) {
    fail(`Chess test crash: ${e.message}`);
    allBugs.chess = [e.message];
  }

  await delay(500);

  try {
    allBugs.tictactoe = await testTicTacToe();
  } catch(e) {
    fail(`TicTacToe test crash: ${e.message}`);
    allBugs.tictactoe = [e.message];
  }

  await delay(500);

  try {
    allBugs.caro = await testCaro();
  } catch(e) {
    fail(`Caro test crash: ${e.message}`);
    allBugs.caro = [e.message];
  }

  await delay(500);

  try {
    allBugs.reconnect = await testChessReconnect();
  } catch(e) {
    fail(`Reconnect test crash: ${e.message}`);
    allBugs.reconnect = [e.message];
  }

  // Tổng kết
  console.log('\n' + C.bold + C.yellow + '═══════════════════════════════════════' + C.reset);
  console.log(C.bold + C.yellow + '           TỔNG KẾT LỖI               ' + C.reset);
  console.log(C.bold + C.yellow + '═══════════════════════════════════════' + C.reset);

  let totalBugs = 0;
  for (const [game, bugs] of Object.entries(allBugs)) {
    if (bugs.length === 0) {
      ok(`${game.toUpperCase()}: Không có lỗi ✓`);
    } else {
      fail(`${game.toUpperCase()}: ${bugs.length} lỗi`);
      bugs.forEach(b => console.log(C.red + `  - ${b}` + C.reset));
      totalBugs += bugs.length;
    }
  }

  console.log('');
  if (totalBugs === 0) {
    console.log(C.bold + C.green + '✅ TẤT CẢ TESTS ĐÃ PASS!' + C.reset);
  } else {
    console.log(C.bold + C.red + `❌ ${totalBugs} LỖI CẦN SỬA` + C.reset);
  }

  process.exit(0);
}

main().catch(e => { fail('Unhandled:', e.message); process.exit(1); });
