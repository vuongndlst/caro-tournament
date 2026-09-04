/**
 * Test end-to-end thể thức Thụy Sĩ trên stack Supabase thật.
 *
 * Chạy trọn một giải: tạo giải swiss, cả lớp vào, đấu hết vòng này sang vòng
 * khác, kiểm tra hệ thống tự bốc cặp vòng mới và chốt nhà vô địch.
 */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!ANON || !SERVICE) { console.error('Thiếu khoá Supabase'); process.exit(2); }

const NUM = Number(process.env.NUM_STUDENTS || 8);
const ROUNDS = Number(process.env.ROUNDS || 3);
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const PASSWORD = 'Swiss@2026xx';

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); console.log(`  \x1b[32mPASS\x1b[0m  ${name}`); }
  catch (e) { results.push(['FAIL', name]); console.log(`  \x1b[31mFAIL\x1b[0m  ${name}\n        ${e.message}`); }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

async function makeUser(email, role, nickname) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { nickname }, app_metadata: role === 'student' ? {} : { role },
  });
  if (error) throw error;
  await admin.from('profiles').update({ role, mfa_required: false, must_change_password: false })
    .eq('id', data.user.id);
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: e2 } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (e2) throw e2;
  return { id: data.user.id, nickname, client };
}

async function call(who, action, payload = {}) {
  const { data, error } = await who.client.functions.invoke('game-api', { body: { action, ...payload } });
  if (error) {
    let msg = error.message;
    try { const raw = await error.context?.text?.(); if (raw) { try { msg = JSON.parse(raw).message ?? raw; } catch { msg = raw; } } } catch { /* noop */ }
    return { success: false, message: msg };
  }
  return data;
}

// Kết thúc nhanh một trận caro: p1 xếp 5 quân hàng 0, p2 đánh xa ở hàng 9.
async function playToWin(match, byId, tournamentId) {
  const p1 = byId.get(match.p1_id), p2 = byId.get(match.p2_id);
  if (!p1 || !p2) throw new Error('thiếu người chơi cho trận');
  for (let i = 0; i < 5; i += 1) {
    const a = await call(p1, 'make_move', { tournamentId, matchId: match.id, row: 0, col: i });
    if (!a.success) throw new Error(`p1 nước ${i}: ${a.message}`);
    const { data: st } = await admin.from('matches').select('status').eq('id', match.id).single();
    if (st.status !== 'active') return p1;
    const b = await call(p2, 'make_move', { tournamentId, matchId: match.id, row: 9, col: i });
    if (!b.success) throw new Error(`p2 nước ${i}: ${b.message}`);
    const { data: st2 } = await admin.from('matches').select('status').eq('id', match.id).single();
    if (st2.status !== 'active') return p1;
  }
  throw new Error('trận không kết thúc sau 5 nước');
}

const stamp = Date.now().toString().slice(-7);
console.log(`\n  Thụy Sĩ E2E — ${NUM} học sinh · ${ROUNDS} vòng\n`);

await admin.from('seasons').update({ status: 'archived' }).eq('status', 'active');
await admin.from('seasons').insert({ name: 'Mùa Thụy Sĩ', school_year: '2026-2027', semester: '1', status: 'active' });

const teacher = await makeUser(`swgv${stamp}@lsts.edu.vn`, 'teacher', 'GV Swiss');
const students = [];
for (let i = 0; i < NUM; i += 1) {
  students.push(await makeUser(`swhs${stamp}_${i}@lsts.edu.vn`, 'student', `HS ${i}`));
}
const byId = new Map(students.map(s => [s.id, s]));

let roomCode = null, tournamentId = null;

await test('Tạo được giải thể thức Thụy Sĩ với số vòng chỉ định', async () => {
  const r = await call(teacher, 'create_tournament', {
    name: 'Giải Thụy Sĩ', gameType: 'caro', format: 'swiss', totalRounds: ROUNDS,
  });
  assert(r.success, r.message);
  roomCode = r.roomCode; tournamentId = r.tournamentId;
  const { data: t } = await admin.from('tournaments').select('format,total_rounds,current_round').eq('id', tournamentId).single();
  assert(t.format === 'swiss', `format = ${t.format}`);
  assert(t.total_rounds === ROUNDS, `total_rounds = ${t.total_rounds}`);
  assert(t.current_round === 0, 'chưa bắt đầu thì current_round phải là 0');
});

await test('Cả lớp vào phòng', async () => {
  for (const s of students) {
    const r = await call(s, 'join_room', { roomCode, nickname: s.nickname });
    assert(r.success, `${s.nickname}: ${r.message}`);
  }
});

await test('Bắt đầu giải: bốc cặp vòng 1 cho TẤT CẢ cùng lúc', async () => {
  const r = await call(teacher, 'start_tournament', { tournamentId });
  assert(r.success, r.message);
  const { data: t } = await admin.from('tournaments').select('current_round').eq('id', tournamentId).single();
  assert(t.current_round === 1, `current_round = ${t.current_round}`);
  const { data: ms } = await admin.from('matches').select('id,round,status').eq('tournament_id', tournamentId);
  assert(ms.length === NUM / 2, `mong ${NUM / 2} trận, có ${ms.length}`);
  assert(ms.every(m => m.round === 1), 'mọi trận phải thuộc vòng 1');
  const { data: ps } = await admin.from('tournament_players').select('status').eq('tournament_id', tournamentId);
  assert(ps.every(p => p.status === 'playing'), 'cả lớp phải vào trận cùng lúc');
});

await test('Trong thể thức Thụy Sĩ, học sinh không tự tìm trận được', async () => {
  const r = await call(students[0], 'request_next_match', { tournamentId });
  assert(r.success && r.waitingForRound === true, 'phải báo đang chờ vòng sau');
});

await test(`Đấu hết ${ROUNDS} vòng: mỗi vòng tự bốc cặp mới, không tái đấu`, async () => {
  const daGap = new Map(students.map(s => [s.id, new Set()]));
  for (let vong = 1; vong <= ROUNDS; vong += 1) {
    const { data: ms } = await admin.from('matches')
      .select('*').eq('tournament_id', tournamentId).eq('round', vong).eq('status', 'active');
    assert(ms.length === NUM / 2, `vòng ${vong}: mong ${NUM / 2} trận, có ${ms.length}`);
    for (const m of ms) {
      assert(!daGap.get(m.p1_id).has(m.p2_id), `vòng ${vong}: tái đấu`);
      daGap.get(m.p1_id).add(m.p2_id); daGap.get(m.p2_id).add(m.p1_id);
      await playToWin(m, byId, tournamentId);
    }
    const { data: t } = await admin.from('tournaments').select('current_round,status').eq('id', tournamentId).single();
    if (vong < ROUNDS) {
      assert(t.current_round === vong + 1, `xong vòng ${vong} phải sang vòng ${vong + 1}, đang ở ${t.current_round}`);
      assert(t.status === 'active', 'chưa hết vòng mà giải đã kết thúc');
    } else {
      assert(t.status === 'finished', `hết vòng cuối giải phải kết thúc, đang là ${t.status}`);
    }
  }
});

await test('Ai cũng đấu đúng số trận như nhau', async () => {
  const { data: ms } = await admin.from('matches').select('p1_id,p2_id').eq('tournament_id', tournamentId);
  const dem = new Map(students.map(s => [s.id, 0]));
  for (const m of ms) { dem.set(m.p1_id, dem.get(m.p1_id) + 1); dem.set(m.p2_id, dem.get(m.p2_id) + 1); }
  const sai = [...dem.entries()].filter(([, n]) => n !== ROUNDS);
  assert(sai.length === 0, `có em không đủ ${ROUNDS} trận: ${sai.length} em`);
});

await test('Có nhà vô địch, và là người dẫn đầu bảng xếp hạng', async () => {
  const { data: ps } = await admin.from('tournament_players')
    .select('nickname,score,elo,wins,losses').eq('tournament_id', tournamentId);
  const xh = [...ps].sort((a, b) => b.score - a.score || b.elo - a.elo);
  assert(xh[0].score > 0, 'nhà vô địch phải có điểm');
  assert(xh[0].score >= xh[1].score, 'thứ tự bảng xếp hạng sai');
  console.log(`         → Vô địch: ${xh[0].nickname} (${xh[0].score}đ, ${xh[0].elo} ELO, ${xh[0].wins}T-${xh[0].losses}B)`);
});

await test('BUG CŨ: trận HẾT GIỜ cũng phải đẩy sang vòng mới, không treo cả lớp', async () => {
  // Một em đánh quá 30 giây là trận kết thúc trong nhánh timeout của make_move.
  // Nhánh đó từng quên gọi bốc cặp vòng mới, khiến cả lớp đứng im ở vòng đó.
  const nhom = students.slice(0, 4);
  const r = await call(teacher, 'create_tournament', {
    name: 'Giải test hết giờ', gameType: 'caro', format: 'swiss', totalRounds: 3,
  });
  assert(r.success, r.message);
  for (const s of nhom) {
    const j = await call(s, 'join_room', { roomCode: r.roomCode, nickname: s.nickname });
    assert(j.success, j.message);
  }
  assert((await call(teacher, 'start_tournament', { tournamentId: r.tournamentId })).success, 'không bắt đầu được');

  const { data: ms } = await admin.from('matches')
    .select('*').eq('tournament_id', r.tournamentId).eq('status', 'active');
  assert(ms.length === 2, `mong 2 trận, có ${ms.length}`);

  // Đẩy hạn lượt về quá khứ để mô phỏng hết giờ mà không phải chờ 30 giây thật.
  await admin.from('matches')
    .update({ turn_deadline_at: new Date(Date.now() - 5000).toISOString() })
    .eq('tournament_id', r.tournamentId).eq('status', 'active');

  for (const m of ms) {
    const nguoiDenLuot = byId.get(m.current_turn);
    const res = await call(nguoiDenLuot, 'make_move', { tournamentId: r.tournamentId, matchId: m.id, row: 5, col: 5 });
    // Trả về mã 409 nên chỉ đọc được message; miễn là trận kết thúc vì hết giờ.
    assert(/hết giờ/i.test(res.message || ''), `mong báo hết giờ, nhận: ${res.message}`);
    const { data: mm } = await admin.from('matches').select('status,result_reason').eq('id', m.id).single();
    assert(mm.status === 'finished' && mm.result_reason === 'timeout',
      `trận phải kết thúc vì hết giờ, đang là ${mm.status}/${mm.result_reason}`);
  }

  const { data: t } = await admin.from('tournaments')
    .select('current_round,status').eq('id', r.tournamentId).single();
  assert(t.current_round === 2, `hết giờ xong phải sang vòng 2, đang ở vòng ${t.current_round}`);
  const { data: v2 } = await admin.from('matches')
    .select('id').eq('tournament_id', r.tournamentId).eq('round', 2);
  assert(v2.length === 2, `vòng 2 phải có 2 trận, có ${v2.length}`);
});

await test('Thể thức auto vẫn chạy như cũ, không bị ảnh hưởng', async () => {
  const r = await call(teacher, 'create_tournament', { name: 'Giải auto', gameType: 'caro' });
  assert(r.success, r.message);
  const { data: t } = await admin.from('tournaments').select('format,total_rounds').eq('id', r.tournamentId).single();
  assert(t.format === 'auto', `format = ${t.format}`);
  assert(t.total_rounds === null, 'auto không được có số vòng');
  for (const s of students.slice(0, 4)) {
    const j = await call(s, 'join_room', { roomCode: r.roomCode, nickname: s.nickname });
    assert(j.success, j.message);
  }
  const st = await call(teacher, 'start_tournament', { tournamentId: r.tournamentId });
  assert(st.success, st.message);
  const { data: ms } = await admin.from('matches').select('id,round').eq('tournament_id', r.tournamentId);
  assert(ms.length === 2, `mong 2 trận, có ${ms.length}`);
  assert(ms.every(m => m.round === null), 'thể thức auto không được gán số vòng');
});

const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n  ${results.length - failed}/${results.length} test đạt`);
process.exit(failed ? 1 : 0);
