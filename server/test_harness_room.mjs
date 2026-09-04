/**
 * Dựng sẵn một phòng giải đấu trên server local để test giao diện bằng trình duyệt.
 *
 * Tạo 1 admin + N học sinh bot. Bot đánh chậm nên trận kéo dài đủ lâu để mở
 * trình duyệt vào xem, thử nút thoát, tải lại trang, rời phòng...
 *
 * Usage: node test_harness_room.mjs [soBot] [serverUrl]
 */

import { io as ioClient } from 'socket.io-client';

const NUM_BOTS = Number(process.argv[2] || 4);
const SERVER = process.argv[3] || 'http://localhost:3001';
const ADMIN_USER = process.env.TEACHER_USERNAME || 'giaovien';
const ADMIN_PASS = process.env.TEACHER_PASSWORD || 'lsts@2024';
const MOVE_DELAY_MS = 2500;

const log = (...a) => console.log('[HARNESS]', ...a);

async function login() {
  const res = await fetch(`${SERVER}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const data = await res.json();
  if (!data.success) throw new Error('Đăng nhập admin thất bại: ' + (data.message || res.status));
  return data.token;
}

function connect(auth) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(SERVER, { transports: ['websocket'], forceNew: true, ...(auth ? { auth } : {}) });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

const emit = (socket, event, payload) =>
  new Promise(resolve => socket.emit(event, payload, resolve));

function firstEmpty(board, size) {
  // Đánh ngẫu nhiên rải khắp bàn: trận kéo dài nhiều phút, đủ thời gian để mở
  // trình duyệt vào xem mà bot chưa kịp thắng.
  const empty = [];
  for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) {
    if (!board[r]?.[c]) empty.push({ row: r, col: c });
  }
  if (!empty.length) return null;
  return empty[Math.floor(Math.random() * empty.length)];
}

const adminToken = await login();
const admin = await connect({ token: adminToken });
log('Admin đã kết nối');

const created = await emit(admin, 'create_tournament', { name: 'Test giao diện', gameType: 'caro', token: adminToken });
if (!created?.success) throw new Error('Không tạo được giải: ' + JSON.stringify(created));
const roomCode = created.roomCode;
log(`Phòng đã tạo: ${roomCode}`);

const names = ['Bot An', 'Bot Bình', 'Bot Cường', 'Bot Dung', 'Bot Én', 'Bot Phong'];
const bots = [];
for (let i = 0; i < NUM_BOTS; i += 1) {
  const socket = await connect();
  const nickname = names[i % names.length] + (i >= names.length ? ` ${i}` : '');
  const joined = await emit(socket, 'join_room', { roomCode, nickname });
  if (!joined?.success) throw new Error(`Bot ${nickname} không vào được phòng`);
  const bot = { socket, nickname, playerId: joined.playerId, match: null };

  const play = () => {
    if (!bot.match) return;
    const { matchId, board, size, currentTurn } = bot.match;
    if (currentTurn !== bot.playerId) return;
    const move = firstEmpty(board, size || 15);
    if (!move) return;
    setTimeout(() => {
      socket.emit('make_move', { matchId, row: move.row, col: move.col }, () => {});
    }, MOVE_DELAY_MS);
  };

  socket.on('match_found', data => { bot.match = { ...data }; play(); });
  socket.on('move_made', data => {
    if (!bot.match || data.matchId !== bot.match.matchId) return;
    bot.match.board = data.board;
    bot.match.currentTurn = data.currentTurn;
    play();
  });
  socket.on('turn_start', data => {
    if (!bot.match || data.matchId !== bot.match.matchId) return;
    bot.match.currentTurn = data.currentTurn;
    play();
  });
  socket.on('game_over', () => {
    bot.match = null;
    setTimeout(() => socket.emit('request_next_match', { roomCode }, () => {}), 1500);
  });

  bots.push(bot);
  log(`Bot vào phòng: ${nickname}`);
}

const started = await emit(admin, 'start_tournament', { roomCode, token: adminToken });
log('Bắt đầu giải:', started?.success ? 'OK' : JSON.stringify(started));

console.log(`\n  MÃ PHÒNG = ${roomCode}\n  ${NUM_BOTS} bot đang đánh. Ctrl+C để dừng.\n`);

process.on('SIGINT', () => {
  for (const bot of bots) bot.socket.close();
  admin.close();
  process.exit(0);
});
setInterval(() => {}, 1 << 30);
