/**
 * Test chess timeout: spawn server with 3s chess timer, verify timed-out player LOSES
 */
const { spawn }   = require('child_process');
const { io: ioClient } = require('socket.io-client');
const http = require('http');

const PORT = 3099;
const URL  = `http://localhost:${PORT}`;
const C = { reset:'\x1b[0m', green:'\x1b[32m', red:'\x1b[31m', cyan:'\x1b[36m', bold:'\x1b[1m' };
const ok   = (...a) => console.log(C.green + '[ OK ]' + C.reset, ...a);
const fail = (...a) => console.log(C.red   + '[FAIL]' + C.reset, ...a);
const log  = (...a) => console.log(C.cyan  + '[TEST]' + C.reset, ...a);

function httpRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', ...opts, headers: { 'Content-Type': 'application/json' } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
const delay = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('\n' + C.bold + '♟  Chess Timeout Test (3 second timer)\n' + C.reset);

  // 1. Start server with 3s chess timeout on port 3099
  log(`Starting test server on port ${PORT} with CHESS_TIMEOUT_TEST_MS=3000...`);
  const server = spawn('node', ['D:/caro-tournament/server/index.js'], {
    env: { ...process.env, PORT: String(PORT), CHESS_TIMEOUT_TEST_MS: '3000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', () => {}); // suppress

  // Wait for server to be ready
  let ready = false;
  for (let i = 0; i < 20 && !ready; i++) {
    await delay(300);
    try {
      const h = await httpRequest(`${URL}/health`);
      if (h?.status === 'ok') ready = true;
    } catch {}
  }
  if (!ready) { fail('Server did not start in time'); server.kill(); process.exit(1); }
  ok(`Server ready on port ${PORT}`);

  // 2. Login and create chess tournament
  const login = await httpRequest(`${URL}/api/auth/login`, {
    method: 'POST', body: JSON.stringify({ username: 'giaovien', password: 'lsts@2024' })
  });
  if (!login?.success) { fail('Login failed'); server.kill(); process.exit(1); }

  const admin = ioClient(URL, { transports: ['websocket'], auth: { token: login.token } });
  const roomCode = await new Promise((res, rej) => {
    admin.on('connect_error', rej);
    admin.on('connect', () => {
      admin.emit('create_tournament', { token: login.token, name: 'Timeout Test', gameType: 'chess' }, r => {
        r.success ? res(r.roomCode) : rej(new Error(r.message));
      });
    });
  });
  log(`Room: ${roomCode}`);

  // 3. Join 2 players
  const join = nickname => new Promise((res, rej) => {
    const s = ioClient(URL, { transports: ['websocket'] });
    s.on('connect_error', rej);
    s.on('connect', () => s.emit('join_room', { roomCode, nickname }, r => {
      r.success ? res({ s, id: r.playerId, name: nickname }) : rej(new Error(r.message));
    }));
  });
  const p1 = await join('Timed Out');
  const p2 = await join('Should Win');
  log(`Players joined`);

  // 4. Start tournament, wait for match_found
  let p1Match = null, p2Match = null;
  await new Promise(res => {
    p1.s.on('match_found', d => { p1Match = d; if (p2Match) res(); });
    p2.s.on('match_found', d => { p2Match = d; if (p1Match) res(); });
    admin.emit('start_tournament', { roomCode }, () => {});
  });

  const firstPlayer = p1Match.currentTurn === p1.id ? p1 : p2;
  const secondPlayer = firstPlayer === p1 ? p2 : p1;
  log(`First to move (will time out): ${firstPlayer.name}`);
  log(`Should win: ${secondPlayer.name}`);
  log(`Waiting up to 8 seconds for 3s timeout to fire...`);

  // 5. Wait for game_over WITHOUT making any moves
  const result = await new Promise(resolve => {
    const handler = (data, fromId) => {
      p1.s.off('game_over'); p2.s.off('game_over');
      resolve({ data, fromId });
    };
    p1.s.on('game_over', d => handler(d, p1.id));
    p2.s.on('game_over', d => handler(d, p2.id));
    setTimeout(() => resolve(null), 8000);
  });

  let exitCode = 0;
  if (!result) {
    fail('No game_over received after 8s — server timeout did NOT fire within 3s');
    fail('Either env var not set, or timer logic broken');
    exitCode = 1;
  } else {
    const { data } = result;
    ok(`game_over received! isDraw=${data.isDraw}, winnerId ends in: ${data.winnerId?.slice(-6)}`);
    ok(`timedOut=${data.timedOut}, timedOutPlayerId ends in: ${data.timedOutPlayerId?.slice(-6)}`);

    // The player who runs out of time is firstPlayer — they should LOSE
    if (data.timedOutPlayerId !== firstPlayer.id) {
      fail(`timedOutPlayerId (${data.timedOutPlayerId?.slice(-6)}) != firstPlayer (${firstPlayer.id.slice(-6)})`);
      exitCode = 1;
    } else {
      ok(`timedOutPlayerId correctly identifies ${firstPlayer.name} as the one who timed out`);
    }

    if (data.winnerId === firstPlayer.id) {
      fail(`BUG CONFIRMED: timed-out player (${firstPlayer.name}) marked as WINNER!`);
      exitCode = 1;
    } else if (data.winnerId === secondPlayer.id) {
      ok(`CORRECT: ${secondPlayer.name} wins, ${firstPlayer.name} (timed out) loses`);
    } else {
      fail(`Unexpected winnerId: ${data.winnerId}`);
      exitCode = 1;
    }

    // Check ELO change is a number (not object)
    if (typeof data.eloChange === 'object') {
      fail(`eloChange is object, not number: ${JSON.stringify(data.eloChange)}`);
      exitCode = 1;
    } else {
      ok(`eloChange is a number: ${data.eloChange}`);
    }
  }

  p1.s.disconnect(); p2.s.disconnect(); admin.disconnect();
  server.kill();

  console.log(exitCode === 0
    ? '\n' + C.green + C.bold + '✅ CHESS TIMEOUT: Đúng! Hết giờ = THUA' + C.reset
    : '\n' + C.red   + C.bold + '❌ CHESS TIMEOUT: CÓ LỖI!' + C.reset);
  process.exit(exitCode);
}

main().catch(e => { fail('Crash:', e.message); process.exit(1); });
