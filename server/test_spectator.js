const { io } = require('socket.io-client');
const http = require('http');

const SERVER_URL = process.argv[2] || 'http://localhost:3001';

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${SERVER_URL}${path}`, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error(body)); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, { transports: ['websocket'], forceNew: true });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function emit(socket, event, payload) {
  return new Promise(resolve => socket.emit(event, payload, resolve));
}

function once(socket, event, timeoutMs = 5000) {
  return Promise.race([
    new Promise(resolve => socket.once(event, resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${event}`)), timeoutMs)),
  ]);
}

async function testMode(gameType) {
  const login = await request('/api/auth/login', {
    method: 'POST', body: { username: 'giaovien', password: 'lsts@2024' },
  });
  if (!login.success) throw new Error('Không đăng nhập được giáo viên');

  const admin = await connect();
  const created = await emit(admin, 'create_tournament', {
    token: login.token, name: `Spectator ${gameType}`, gameType,
  });
  const p1 = await connect();
  const p2 = await connect();
  await emit(p1, 'join_room', { roomCode: created.roomCode, nickname: `${gameType}-1` });
  await emit(p2, 'join_room', { roomCode: created.roomCode, nickname: `${gameType}-2` });

  const matchFound = once(p1, 'match_found');
  await emit(admin, 'start_tournament', { roomCode: created.roomCode });
  const match = await matchFound;

  const spectator = await connect();
  const watched = await emit(spectator, 'spectate_match', {
    roomCode: created.roomCode, matchId: match.matchId,
  });

  if (!watched?.success) throw new Error(watched?.message || 'Không xem được trận');
  const data = watched.match;
  if (data.gameType !== gameType) throw new Error(`Sai gameType: ${data.gameType}`);
  if (gameType === 'chess') {
    if (typeof data.board !== 'string') throw new Error('Chess spectator không nhận FEN');
    if (!Number.isFinite(data.p1TimeMs) || !Number.isFinite(data.p2TimeMs)) throw new Error('Thiếu đồng hồ chess');
    if (!Number.isFinite(data.turnStartedAt)) throw new Error('Thiếu mốc turnStartedAt');
  } else {
    const expectedSize = gameType === 'tictactoe' ? 3 : 15;
    if (!Array.isArray(data.board) || data.board.length !== expectedSize) throw new Error(`Sai board ${gameType}`);
    if (data.size !== expectedSize) throw new Error(`Sai size: ${data.size}`);
  }

  [spectator, p1, p2, admin].forEach(socket => socket.disconnect());
  console.log(`✅ Spectator ${gameType}: board/gameType/clock hợp lệ`);
}

(async () => {
  try {
    await testMode('chess');
    await testMode('tictactoe');
    console.log('✅ Tất cả kiểm thử spectator đã vượt qua');
    process.exit(0);
  } catch (error) {
    console.error(`❌ Spectator test thất bại: ${error.message}`);
    process.exit(1);
  }
})();
