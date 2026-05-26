/**
 * CaroTourney — Tournament Simulation
 * Spawns 1 admin + 20 student sockets, plays out a full tournament,
 * reports leaderboard and any errors found.
 *
 * Usage:  node simulate.js [serverUrl]
 * Example: node simulate.js http://localhost:3001
 */

const { io: ioClient } = require('socket.io-client');
const https = require('https');
const http  = require('http');

// Override server URL from CLI arg
const SERVER_URL_ARG = process.argv[2];
if (SERVER_URL_ARG) {
  // Will be referenced below — overrides the constant
}

function httpRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, { method: 'GET', ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }
    }, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

const SERVER_URL = process.argv[2] || 'http://localhost:3001';
const ADMIN_USER = process.env.TEACHER_USERNAME || 'giaovien';
const ADMIN_PASS = process.env.TEACHER_PASSWORD || 'lsts@2024';
const NUM_PLAYERS = 20;
const MOVE_DELAY_MS = 80;   // ms between each automated move
const ROUND_LIMIT = 6;      // max rounds to simulate per player

// ── Student names ─────────────────────────────────────────────────────────────
const NAMES = [
  'An Khoa','Bảo Trân','Cao Việt','Duy Minh','Gia Hân',
  'Hồng Nhung','Ích Tuấn','Kim Liên','Lê Nam','Minh Châu',
  'Ngọc Ánh','Phúc Khang','Quỳnh Như','Rạng Đông','Sơn Tùng',
  'Thanh Hà','Uyên Phương','Văn Đức','Xuân Mai','Yến Nhi',
];

// ── Colour helpers ────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  red:    '\x1b[31m',
  white:  '\x1b[37m',
  magenta:'\x1b[35m',
};
const log   = (...a) => console.log(C.cyan + '[SIM]' + C.reset, ...a);
const warn  = (...a) => console.log(C.yellow + '[WARN]' + C.reset, ...a);
const err   = (...a) => console.log(C.red + '[ERR]' + C.reset, ...a);
const ok    = (...a) => console.log(C.green + '[OK]' + C.reset, ...a);

// ── Global stats ──────────────────────────────────────────────────────────────
const stats = {
  errors: [],
  matchesPlayed: 0,
  movesTotal: 0,
  timeouts: 0,
};

// ── Smart move helper — plays near existing stones so games end quickly ────────
function pickSmartMove(board, size) {
  const center = Math.floor(size / 2);
  const empty  = [];
  const nearStones = new Set();

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] === null) {
        empty.push([r, c]);
      } else {
        // Mark cells within distance 2 of each existing stone
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size && board[nr][nc] === null)
              nearStones.add(`${nr},${nc}`);
          }
        }
      }
    }
  }
  if (empty.length === 0) return null;

  // Prefer cells adjacent to existing stones (creates lines → faster wins)
  if (nearStones.size > 0) {
    const adj = Array.from(nearStones).map(k => k.split(',').map(Number));
    return adj[Math.floor(Math.random() * adj.length)];
  }

  // First move: play near center
  const near = empty.filter(([r,c]) => Math.abs(r-center) < 3 && Math.abs(c-center) < 3);
  const pool = near.length > 0 ? near : empty;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Player agent ──────────────────────────────────────────────────────────────
function createPlayer(nickname, roomCode, adminSocket) {
  return new Promise((resolve) => {
    const socket = ioClient(SERVER_URL, { transports: ['websocket'] });
    let currentMatch = null;
    let roundsPlayed = 0;
    let resolved = false;

    const finish = () => {
      if (!resolved) { resolved = true; socket.disconnect(); resolve(nickname); }
    };

    socket.on('connect_error', (e) => {
      err(`${nickname} connect error:`, e.message);
      stats.errors.push({ type: 'connect', player: nickname, msg: e.message });
      finish();
    });

    socket.on('connect', () => {
      socket.emit('join_room', { roomCode, nickname }, (res) => {
        if (!res.success) {
          err(`${nickname} join failed:`, res.message);
          stats.errors.push({ type: 'join', player: nickname, msg: res.message });
          finish();
        }
      });
    });

    socket.on('match_found', (data) => {
      currentMatch = data;
      roundsPlayed++;
      log(`${C.bold}${nickname}${C.reset} → trận ${roundsPlayed} vs ${data.opponentNickname} [${data.yourSymbol}]`);

      // If it's my turn, start making moves
      if (data.currentTurn === socket.id) makeNextMove();
    });

    socket.on('move_made', (data) => {
      if (!currentMatch || currentMatch.matchId !== data.matchId) return;
      currentMatch.board = data.board;
      currentMatch.currentTurn = data.currentTurn;
      stats.movesTotal++;

      if (data.timedOut) {
        stats.timeouts++;
        if (data.timedOutPlayerId === socket.id)
          warn(`${nickname} hết giờ! (timeout)`);
      }

      if (data.currentTurn === socket.id) makeNextMove();
    });

    socket.on('game_over', (data) => {
      stats.matchesPlayed++;
      const result = data.isDraw ? 'Hoà' : data.winnerId === socket.id ? C.green + 'Thắng' + C.reset : C.red + 'Thua' + C.reset;
      log(`${nickname}: ${result} (trận ${roundsPlayed})`);

      currentMatch = null;

      if (roundsPlayed >= ROUND_LIMIT) {
        ok(`${nickname} hoàn thành ${roundsPlayed} trận`);
        finish();
        return;
      }

      // Request next match after short delay
      setTimeout(() => {
        socket.emit('request_next_match', { roomCode });
      }, 200 + Math.random() * 300);
    });

    socket.on('disconnect', () => {
      if (!resolved) warn(`${nickname} bị ngắt kết nối`);
      finish();
    });

    function makeNextMove() {
      if (!currentMatch || currentMatch.currentTurn !== socket.id) return;
      const move = pickRandomMove(currentMatch.board, currentMatch.size || 15);
      if (!move) return;

      setTimeout(() => {
        if (!currentMatch || currentMatch.currentTurn !== socket.id) return;
        socket.emit('make_move', {
          matchId: currentMatch.matchId,
          row: move[0],
          col: move[1],
        }, (res) => {
          if (res && !res.success) {
            // Move was rejected — try again with a fresh pick
            if (res.message !== 'Chưa đến lượt bạn!' && res.message !== 'Trận đấu không hợp lệ') {
              warn(`${nickname} move rejected: ${res.message}`);
              stats.errors.push({ type: 'move', player: nickname, msg: res.message });
              makeNextMove(); // retry
            }
          }
        });
      }, MOVE_DELAY_MS + Math.random() * MOVE_DELAY_MS);
    }

    // Safety timeout: disconnect player after 5 minutes if still running
    setTimeout(finish, 5 * 60 * 1000);
  });
}

// ── Admin socket ──────────────────────────────────────────────────────────────
async function createAdmin() {
  // 1. Login via REST to get token
  const loginRes = await httpRequest(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  if (!loginRes?.success) throw new Error(`Login failed: ${loginRes?.message}`);
  const token = loginRes.token;
  ok(`Đăng nhập thành công: ${loginRes.username}`);

  // 2. Connect admin socket with token
  return new Promise((resolve, reject) => {
    const admin = ioClient(SERVER_URL, { transports: ['websocket'], auth: { token } });

    admin.on('connect_error', reject);
    admin.on('connect', () => {
      admin.emit('create_tournament', { token, name: 'Giả lập 20 người chơi' }, (res) => {
        if (!res.success) return reject(new Error(`Cannot create tournament: ${res.message}`));
        ok(`Giải đấu tạo thành công — mã phòng: ${C.bold}${C.yellow}${res.roomCode}${C.reset}`);
        resolve({ admin, roomCode: res.roomCode, token });
      });
    });
  });
}

// ── Print leaderboard ─────────────────────────────────────────────────────────
function printLeaderboard(leaderboard) {
  console.log('\n' + C.yellow + C.bold + '══════════════════════════════════════════' + C.reset);
  console.log(C.yellow + C.bold + '         BẢNG XẾP HẠNG CUỐI GIẢI ĐẤU       ' + C.reset);
  console.log(C.yellow + C.bold + '══════════════════════════════════════════' + C.reset);
  console.log(C.dim + `${'#'.padEnd(4)}${'Tên'.padEnd(20)}${'Điểm'.padEnd(8)}${'T'.padEnd(5)}${'H'.padEnd(5)}${'B'}` + C.reset);
  console.log(C.dim + '─'.repeat(50) + C.reset);

  leaderboard.forEach((p, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
    const row = `${medal} ${String(i+1).padEnd(3)}${p.nickname.padEnd(20)}${String(p.score).padEnd(8)}${String(p.wins).padEnd(5)}${String(p.draws).padEnd(5)}${p.losses}`;
    const color = i === 0 ? C.yellow : i < 3 ? C.white : C.dim;
    console.log(color + row + C.reset);
  });

  console.log(C.yellow + C.bold + '══════════════════════════════════════════\n' + C.reset);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + C.bold + C.cyan + '🎮  CaroTourney — Tournament Simulation' + C.reset);
  console.log(C.dim + `   ${NUM_PLAYERS} học sinh · ${ROUND_LIMIT} vòng tối đa · server: ${SERVER_URL}\n` + C.reset);

  let admin, roomCode, token;
  try {
    ({ admin, roomCode, token } = await createAdmin());
  } catch (e) {
    err('Không thể kết nối server:', e.message);
    process.exit(1);
  }

  // Listen for final state on admin socket
  let finalLeaderboard = [];
  admin.on('room_state_update', (state) => {
    finalLeaderboard = state.leaderboard || [];
  });

  // Give admin socket time to be set up, then spawn players
  await new Promise(r => setTimeout(r, 300));

  log(`Khởi tạo ${NUM_PLAYERS} học sinh...`);
  const playerPromises = NAMES.slice(0, NUM_PLAYERS).map(name =>
    createPlayer(name, roomCode, admin)
  );

  // Wait briefly for all players to join, then start
  await new Promise(r => setTimeout(r, 1500));
  log('Bắt đầu giải đấu...');

  admin.emit('start_tournament', { roomCode }, (res) => {
    if (res?.success) ok('Giải đấu bắt đầu!');
    else err('Lỗi bắt đầu:', res?.message);
  });

  // Wait for all players to finish their rounds
  await Promise.all(playerPromises);

  // Give server time to process final disconnects
  await new Promise(r => setTimeout(r, 800));

  // Fetch leaderboard via HTTP (most reliable — bypasses socket state)
  try {
    const state = await httpRequest(`${SERVER_URL}/leaderboard/${roomCode}`);
    if (state && state.leaderboard && state.leaderboard.length > 0) {
      finalLeaderboard = state.leaderboard;
    }
  } catch (e) {
    warn('HTTP leaderboard fetch failed:', e.message);
  }

  // Final summary
  console.log('\n' + C.bold + '── Kết quả mô phỏng ────────────────────────' + C.reset);
  ok(`Tổng trận đã chơi:  ${C.bold}${Math.round(stats.matchesPlayed / 2)}${C.reset} trận thực tế (${stats.matchesPlayed} sự kiện)`);
  ok(`Tổng nước đã đánh:  ${C.bold}${stats.movesTotal}${C.reset}`);
  ok(`Người chơi BXH:     ${C.bold}${finalLeaderboard.length}${C.reset}/20`);
  if (stats.timeouts > 0) warn(`Hết giờ (timeout):   ${stats.timeouts} lần`);
  if (stats.errors.length > 0) {
    err(`Lỗi phát hiện:      ${stats.errors.length}`);
    const types = {};
    stats.errors.forEach(e => { types[e.type] = (types[e.type]||0)+1; });
    Object.entries(types).forEach(([k,v]) => err(`  - ${k}: ${v} lần`));
    console.log(C.dim + '\nChi tiết lỗi:' + C.reset);
    stats.errors.slice(0, 10).forEach(e => console.log(C.dim + `  [${e.type}] ${e.player}: ${e.msg}` + C.reset));
  } else {
    ok('Không phát hiện lỗi nào!');
  }

  printLeaderboard(finalLeaderboard);

  admin.disconnect();
  process.exit(0);
}

main().catch(e => { err('Unhandled:', e); process.exit(1); });
