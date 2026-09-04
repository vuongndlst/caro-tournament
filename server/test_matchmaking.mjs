/**
 * Test logic ghép trận của Supabase edge function, chạy bằng Node.
 *
 * Không cần Docker hay Deno: file này nạp thẳng ../supabase/functions/_shared/
 * matchmaking.ts (Node 24 tự bóc kiểu) và chạy nó trên một CSDL giả lập trong
 * bộ nhớ, mô phỏng đúng phần API Supabase mà module đó dùng.
 *
 * Usage: node --experimental-strip-types test_matchmaking.mjs
 */

import assert from 'node:assert/strict';
import {
  planPairings, pairingScore, matchWaiting,
  reclaimStaleMatching, reclaimOrphanPlaying, STALE_MATCHING_MS,
} from '../supabase/functions/_shared/matchmaking.ts';

// ── CSDL giả lập ────────────────────────────────────────────────────────────
// Chỉ hiện thực đúng những toán tử matchmaking.ts dùng: select/eq/lt/in/match/
// update/insert/select(cols). Mọi update đều tôn trọng bộ lọc, giống Postgres.
function createFakeDb(seed = {}) {
  const tables = {
    tournament_players: [...(seed.tournament_players || [])],
    matches: [...(seed.matches || [])],
  };
  const failures = { matchInsert: false };

  const matches = (row, filters) => filters.every(([col, op, val]) => {
    const cell = row[col];
    if (op === 'eq') return cell === val;
    if (op === 'lt') return cell != null && cell < val;
    if (op === 'in') return val.includes(cell);
    return true;
  });

  function query(table) {
    const filters = [];
    const api = {
      select() { api._select = true; return api; },
      eq(col, val) { filters.push([col, 'eq', val]); return api; },
      lt(col, val) { filters.push([col, 'lt', val]); return api; },
      in(col, val) { filters.push([col, 'in', val]); return api; },
      match(obj) { for (const [k, v] of Object.entries(obj)) filters.push([k, 'eq', v]); return api; },
      update(patch) {
        api._op = 'update';
        api._patch = patch;
        return api;
      },
      insert(row) { api._op = 'insert'; api._row = row; return api; },
      then(resolve, reject) { return run().then(resolve, reject); },
    };

    async function run() {
      if (api._op === 'insert') {
        if (table === 'matches' && failures.matchInsert) {
          return { data: null, error: new Error('insert matches thất bại (giả lập)') };
        }
        tables[table].push({ id: `m${tables[table].length + 1}`, status: 'active', ...api._row });
        return { data: null, error: null };
      }
      const hit = tables[table].filter(row => matches(row, filters));
      if (api._op === 'update') {
        for (const row of hit) {
          const changed = api._patch.status !== undefined && api._patch.status !== row.status;
          Object.assign(row, api._patch);
          // Trigger tournament_players_touch_status trong migration.
          if (table === 'tournament_players' && changed) row.status_changed_at = new Date(NOW()).toISOString();
        }
        return { data: hit.map(r => ({ user_id: r.user_id })), error: null };
      }
      return { data: hit.map(r => ({ ...r })), error: null };
    }

    return api;
  }

  return { from: query, _tables: tables, _failures: failures };
}

let CLOCK = Date.parse('2026-09-04T10:00:00Z');
const NOW = () => CLOCK;

const DEPS = {
  emptyBoard: size => Array.from({ length: size }, () => Array(size).fill(null)),
  initialChessFen: () => 'startpos',
  turnMs: 30_000,
  now: NOW,
};

const TOURNAMENT = { id: 't1', status: 'active', game_type: 'caro' };

function player(id, extra = {}) {
  return {
    tournament_id: 't1', user_id: id, nickname: id, elo: 1200,
    status: 'waiting', waiting_since: new Date(CLOCK).toISOString(),
    status_changed_at: new Date(CLOCK).toISOString(),
    last_opponent_id: null, opponent_history: [], ...extra,
  };
}

// ── Chạy test ───────────────────────────────────────────────────────────────
const results = [];
async function test(name, fn) {
  try { await fn(); results.push(['PASS', name]); }
  catch (err) { results.push(['FAIL', name, err.message]); }
}

await test('20 học sinh được ghép thành 10 trận, không ai bị bỏ lại', async () => {
  const players = Array.from({ length: 20 }, (_, i) => player(`u${i}`, { elo: 1100 + i * 10 }));
  const db = createFakeDb({ tournament_players: players });
  const { paired } = await matchWaiting(db, TOURNAMENT, DEPS);
  assert.equal(paired, 10);
  assert.equal(db._tables.matches.length, 10);
  const stillWaiting = db._tables.tournament_players.filter(p => p.status === 'waiting');
  assert.equal(stillWaiting.length, 0, 'không được còn ai ở hàng chờ');
  const playing = db._tables.tournament_players.filter(p => p.status === 'playing');
  assert.equal(playing.length, 20);
});

await test('số lẻ người chơi: đúng 1 người còn chờ, không ai kẹt ở matching', async () => {
  const players = Array.from({ length: 7 }, (_, i) => player(`u${i}`, { elo: 1200 + i * 40 }));
  const db = createFakeDb({ tournament_players: players });
  await matchWaiting(db, TOURNAMENT, DEPS);
  const byStatus = st => db._tables.tournament_players.filter(p => p.status === st).length;
  assert.equal(byStatus('playing'), 6);
  assert.equal(byStatus('waiting'), 1);
  assert.equal(byStatus('matching'), 0, 'không được để sót ai ở matching');
});

await test('BUG CŨ: insert trận lỗi thì người chơi phải trở về waiting, không kẹt matching', async () => {
  const db = createFakeDb({ tournament_players: [player('a'), player('b')] });
  db._failures.matchInsert = true;
  await assert.rejects(() => matchWaiting(db, TOURNAMENT, DEPS));
  const stuck = db._tables.tournament_players.filter(p => p.status === 'matching');
  assert.equal(stuck.length, 0, 'sau lỗi không được còn ai ở matching');
  assert.equal(db._tables.tournament_players.every(p => p.status === 'waiting'), true);
});

await test('BUG CŨ: người kẹt ở matching quá 30s được đưa lại hàng chờ và ghép được', async () => {
  const old = new Date(CLOCK - STALE_MATCHING_MS - 5_000).toISOString();
  const db = createFakeDb({
    tournament_players: [
      player('stuck1', { status: 'matching', status_changed_at: old }),
      player('stuck2', { status: 'matching', status_changed_at: old }),
    ],
  });
  const { paired, reclaimed } = await matchWaiting(db, TOURNAMENT, DEPS);
  assert.deepEqual(reclaimed.sort(), ['stuck1', 'stuck2']);
  assert.equal(paired, 1, 'gỡ kẹt xong phải ghép được ngay');
});

await test('người đang matching hợp lệ (mới 5s) KHÔNG bị gỡ nhầm', async () => {
  const fresh = new Date(CLOCK - 5_000).toISOString();
  const db = createFakeDb({
    tournament_players: [
      player('busy1', { status: 'matching', status_changed_at: fresh }),
      player('busy2', { status: 'matching', status_changed_at: fresh }),
    ],
  });
  const { reclaimed } = await matchWaiting(db, TOURNAMENT, DEPS);
  assert.deepEqual(reclaimed, [], 'không được đụng vào cặp đang ghép dở');
});

await test('BUG CŨ: status playing nhưng không còn trận active thì được trả về hàng chờ', async () => {
  const db = createFakeDb({
    tournament_players: [
      player('ghost', { status: 'playing', waiting_since: null }),
      player('real1', { status: 'playing', waiting_since: null }),
      player('real2', { status: 'playing', waiting_since: null }),
    ],
    matches: [{ id: 'm1', tournament_id: 't1', status: 'active', p1_id: 'real1', p2_id: 'real2' }],
  });
  const orphans = await reclaimOrphanPlaying(db, 't1', CLOCK);
  assert.deepEqual(orphans, ['ghost']);
  const ghost = db._tables.tournament_players.find(p => p.user_id === 'ghost');
  assert.equal(ghost.status, 'waiting');
  const real = db._tables.tournament_players.find(p => p.user_id === 'real1');
  assert.equal(real.status, 'playing', 'người đang đánh thật không được đụng vào');
});

await test('không ghép lại ngay đối thủ vừa đánh khi mới chờ dưới 20s', async () => {
  const a = player('a', { last_opponent_id: 'b' });
  const b = player('b', { last_opponent_id: 'a' });
  assert.equal(pairingScore(a, b, CLOCK), Number.POSITIVE_INFINITY);
  assert.deepEqual(planPairings([a, b], CLOCK), [], 'chỉ có 2 người vừa đấu nhau thì chưa ghép');
});

await test('chờ quá 20s thì chấp nhận ghép lại đối thủ cũ', async () => {
  const long = new Date(CLOCK - 25_000).toISOString();
  const a = player('a', { last_opponent_id: 'b', waiting_since: long });
  const b = player('b', { last_opponent_id: 'a', waiting_since: long });
  assert.equal(Number.isFinite(pairingScore(a, b, CLOCK)), true);
  assert.equal(planPairings([a, b], CLOCK).length, 1);
});

await test('ưu tiên ghép người có ELO gần nhau', async () => {
  const pairs = planPairings([
    player('yeu', { elo: 1000 }), player('manh', { elo: 1800 }),
    player('yeu2', { elo: 1010 }), player('manh2', { elo: 1790 }),
  ], CLOCK);
  const ids = pairs.map(([x, y]) => [x.user_id, y.user_id].sort().join('+')).sort();
  assert.deepEqual(ids, ['manh+manh2', 'yeu+yeu2']);
});

await test('giải chưa active thì không ghép ai', async () => {
  const db = createFakeDb({ tournament_players: [player('a'), player('b')] });
  const { paired } = await matchWaiting(db, { ...TOURNAMENT, status: 'waiting' }, DEPS);
  assert.equal(paired, 0);
  assert.equal(db._tables.matches.length, 0);
});

await test('gọi matchWaiting nhiều lần liên tiếp không tạo trận trùng', async () => {
  const db = createFakeDb({ tournament_players: [player('a'), player('b')] });
  await matchWaiting(db, TOURNAMENT, DEPS);
  await matchWaiting(db, TOURNAMENT, DEPS);
  await matchWaiting(db, TOURNAMENT, DEPS);
  assert.equal(db._tables.matches.length, 1, 'chỉ được đúng 1 trận');
});

await test('cờ vua dùng bàn 8 và đồng hồ theo cấu hình giải', async () => {
  const db = createFakeDb({ tournament_players: [player('a'), player('b')] });
  await matchWaiting(db, { ...TOURNAMENT, game_type: 'chess', chess_initial_ms: 180_000, chess_increment_ms: 2000 }, DEPS);
  const [m] = db._tables.matches;
  assert.equal(m.board_size, 8);
  assert.equal(m.p1_time_ms, 180_000);
  assert.equal(m.chess_increment_ms, 2000);
});

await test('tictactoe dùng bàn 3', async () => {
  const db = createFakeDb({ tournament_players: [player('a'), player('b')] });
  await matchWaiting(db, { ...TOURNAMENT, game_type: 'tictactoe' }, DEPS);
  assert.equal(db._tables.matches[0].board_size, 3);
});

// ── Báo cáo ─────────────────────────────────────────────────────────────────
let failed = 0;
for (const [status, name, message] of results) {
  if (status === 'PASS') console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
  else { failed += 1; console.log(`  \x1b[31mFAIL\x1b[0m  ${name}\n        ${message}`); }
}
console.log(`\n  ${results.length - failed}/${results.length} test đạt`);
process.exit(failed ? 1 : 0);
