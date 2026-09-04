/**
 * Test end-to-end trên stack Supabase THẬT (chạy local bằng Docker).
 *
 * Khác với test_matchmaking.mjs (CSDL giả lập), file này đi đúng đường thật:
 *   client → edge function game-api → Postgres,
 * qua Auth thật, RLS thật, trigger thật, migration thật.
 *
 * Yêu cầu: `supabase start` đã chạy. Lấy khoá bằng `supabase status -o env`.
 *
 * Usage:
 *   node test_e2e_supabase.mjs
 *   (đọc SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY từ biến môi trường)
 */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!ANON || !SERVICE) {
  console.error('Thiếu SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const NUM_STUDENTS = Number(process.env.NUM_STUDENTS || 8);
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); console.log(`  \x1b[32mPASS\x1b[0m  ${name}`); }
  catch (err) { results.push(['FAIL', name, err.message]); console.log(`  \x1b[31mFAIL\x1b[0m  ${name}\n        ${err.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// ── Tạo tài khoản ───────────────────────────────────────────────────────────
async function makeUser(email, password, role, nickname) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { nickname },
    app_metadata: role === 'student' ? {} : { role },
  });
  if (error) throw error;
  // Giáo viên/admin bị chặn bởi MFA; tắt cho môi trường test.
  await admin.from('profiles').update({
    role, mfa_required: false, must_change_password: false,
  }).eq('id', data.user.id);
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, email, nickname, client };
}

const call = async (who, action, payload = {}) => {
  const { data, error } = await who.client.functions.invoke('game-api', { body: { action, ...payload } });
  if (error) {
    let detail = error.message;
    try { detail += ' | ' + await error.context.text(); } catch { /* ignore */ }
    throw new Error(`${action}: ${detail}`);
  }
  return data;
};

const stamp = Date.now();
console.log(`\n  Stack: ${URL}\n  ${NUM_STUDENTS} học sinh\n`);

// Mùa giải phải tồn tại, nếu không create_tournament trả 409.
await admin.from('seasons').update({ status: 'archived' }).eq('status', 'active');
const { data: season, error: seasonError } = await admin.from('seasons').insert({
  name: 'Mùa test', school_year: '2026-2027', semester: '1', status: 'active',
}).select().single();
if (seasonError) throw seasonError;

const teacher = await makeUser(`gv${stamp}@lsts.edu.vn`, 'GiaoVien@2026x', 'teacher', 'Giao Vien');
const students = [];
for (let i = 0; i < NUM_STUDENTS; i += 1) {
  students.push(await makeUser(`hs${stamp}_${i}@lsts.edu.vn`, `HocSinh@2026x${i}`, 'student', `HS ${i}`));
}
console.log(`  Đã tạo 1 giáo viên + ${students.length} học sinh\n`);

let roomCode = null;
let tournamentId = null;

await test('Giáo viên tạo được giải đấu', async () => {
  const res = await call(teacher, 'create_tournament', { name: 'Giải E2E', gameType: 'caro' });
  assert(res.success, res.message);
  roomCode = res.roomCode || res.state?.roomCode;
  tournamentId = res.tournamentId || res.state?.tournamentId;
  assert(roomCode, 'không có roomCode');
});

await test('Tất cả học sinh vào phòng được', async () => {
  for (const s of students) {
    const res = await call(s, 'join_room', { roomCode, nickname: s.nickname });
    assert(res.success, `${s.nickname}: ${res.message}`);
  }
  const { count } = await admin.from('tournament_players')
    .select('*', { count: 'exact', head: true }).eq('tournament_id', tournamentId);
  assert(count === NUM_STUDENTS, `mong ${NUM_STUDENTS} người, có ${count}`);
});

await test('Bắt đầu giải: tất cả được ghép, không ai kẹt ở matching', async () => {
  const res = await call(teacher, 'start_tournament', { roomCode, tournamentId });
  assert(res.success, res.message);
  const { data: players } = await admin.from('tournament_players')
    .select('user_id,status').eq('tournament_id', tournamentId);
  const dem = st => players.filter(p => p.status === st).length;
  assert(dem('matching') === 0, `còn ${dem('matching')} người kẹt ở matching`);
  const expectedPlaying = NUM_STUDENTS - (NUM_STUDENTS % 2);
  assert(dem('playing') === expectedPlaying, `mong ${expectedPlaying} người đang đánh, có ${dem('playing')}`);
});

await test('BUG CŨ: người kẹt ở matching quá 30s được gỡ và ghép lại', async () => {
  // Ép hai học sinh vào đúng trạng thái kẹt mà production từng gặp.
  const victims = students.slice(0, 2);
  const old = new Date(Date.now() - 120_000).toISOString();
  for (const v of victims) {
    await admin.from('matches').delete()
      .eq('tournament_id', tournamentId).or(`p1_id.eq.${v.id},p2_id.eq.${v.id}`);
    await admin.from('tournament_players').update({ status: 'matching' })
      .match({ tournament_id: tournamentId, user_id: v.id });
  }
  // Trigger đặt status_changed_at = now(); lùi lại để giả lập đã kẹt lâu.
  await admin.from('tournament_players').update({ status_changed_at: old })
    .eq('tournament_id', tournamentId).in('user_id', victims.map(v => v.id));

  const res = await call(victims[0], 'request_next_match', { roomCode, tournamentId });
  assert(res.success, res.message);

  const { data: after } = await admin.from('tournament_players')
    .select('user_id,status').eq('tournament_id', tournamentId).in('user_id', victims.map(v => v.id));
  const stuck = after.filter(p => p.status === 'matching');
  assert(stuck.length === 0, `vẫn còn ${stuck.length} người kẹt ở matching`);
});

await test('BUG CŨ: status playing mồ côi được trả về hàng chờ', async () => {
  const ghost = students[NUM_STUDENTS - 1];
  await admin.from('matches').delete()
    .eq('tournament_id', tournamentId).or(`p1_id.eq.${ghost.id},p2_id.eq.${ghost.id}`);
  await admin.from('tournament_players').update({ status: 'playing', waiting_since: null })
    .match({ tournament_id: tournamentId, user_id: ghost.id });

  await call(ghost, 'join_room', { roomCode, nickname: ghost.nickname });

  const { data: row } = await admin.from('tournament_players')
    .select('status').match({ tournament_id: tournamentId, user_id: ghost.id }).single();
  // Được gỡ kẹt là đủ: hoặc về hàng chờ, hoặc đã được ghép vào trận THẬT.
  if (row.status === 'playing') {
    const { data: real } = await admin.from('matches').select('id')
      .eq('tournament_id', tournamentId).eq('status', 'active')
      .or(`p1_id.eq.${ghost.id},p2_id.eq.${ghost.id}`);
    assert(real.length > 0, 'vẫn kẹt ở playing mà không có trận nào');
  } else {
    assert(['waiting', 'result'].includes(row.status), `trạng thái lạ: ${row.status}`);
  }
});

await test('Trigger status_changed_at tự cập nhật khi đổi trạng thái', async () => {
  const s = students[0];
  const { data: before } = await admin.from('tournament_players')
    .select('status,status_changed_at').match({ tournament_id: tournamentId, user_id: s.id }).single();
  await new Promise(r => setTimeout(r, 1100));
  const newStatus = before.status === 'waiting' ? 'result' : 'waiting';
  await admin.from('tournament_players').update({ status: newStatus })
    .match({ tournament_id: tournamentId, user_id: s.id });
  const { data: after } = await admin.from('tournament_players')
    .select('status_changed_at').match({ tournament_id: tournamentId, user_id: s.id }).single();
  assert(new Date(after.status_changed_at) > new Date(before.status_changed_at),
    'status_changed_at không được cập nhật');
});

await test('join_room trả về trận đang chạy (khôi phục sau khi tải lại trang)', async () => {
  const { data: active } = await admin.from('matches')
    .select('*').eq('tournament_id', tournamentId).eq('status', 'active').limit(1);
  assert(active.length > 0, 'không có trận nào đang chạy để kiểm tra');
  const inMatch = students.find(s => s.id === active[0].p1_id);
  assert(inMatch, 'không tìm thấy học sinh của trận');
  const res = await call(inMatch, 'join_room', { roomCode, nickname: inMatch.nickname });
  assert(res.success, res.message);
  assert(res.match, 'join_room KHÔNG trả về trận đang chạy — học sinh sẽ kẹt ở sảnh');
  assert(res.match.matchId === active[0].id, 'trả về sai trận');
});

await test('Đánh hết một ván: có người thắng, ELO thay đổi', async () => {
  const { data: active } = await admin.from('matches')
    .select('*').eq('tournament_id', tournamentId).eq('status', 'active').limit(1);
  assert(active.length > 0, 'không có trận đang chạy');
  const m = active[0];
  const p1 = students.find(s => s.id === m.p1_id);
  const p2 = students.find(s => s.id === m.p2_id);
  assert(p1 && p2, 'thiếu người chơi');

  const { data: eloBefore } = await admin.from('tournament_players')
    .select('user_id,elo').eq('tournament_id', tournamentId).in('user_id', [p1.id, p2.id]);

  // p1 xếp 5 quân hàng 0, p2 đánh xa ở hàng 9 để không chặn.
  // make_move chỉ trả {success, isCheck}, nên hỏi CSDL để biết trận kết thúc chưa.
  const stillActive = async () => {
    const { data } = await admin.from('matches').select('status').eq('id', m.id).single();
    return data.status === 'active';
  };
  for (let i = 0; i < 5; i += 1) {
    const r1 = await call(p1, 'make_move', { tournamentId, matchId: m.id, row: 0, col: i });
    assert(r1.success, `p1 nước ${i}: ${r1.message}`);
    if (!await stillActive()) break;
    const r2 = await call(p2, 'make_move', { tournamentId, matchId: m.id, row: 9, col: i });
    assert(r2.success, `p2 nước ${i}: ${r2.message}`);
    if (!await stillActive()) break;
  }

  const { data: finished } = await admin.from('matches').select('*').eq('id', m.id).single();
  assert(finished.status === 'finished', `trận chưa kết thúc (status=${finished.status})`);
  assert(finished.winner_id === p1.id, `người thắng sai: ${finished.winner_id}`);

  const { data: eloAfter } = await admin.from('tournament_players')
    .select('user_id,elo,wins,losses,status').eq('tournament_id', tournamentId).in('user_id', [p1.id, p2.id]);
  const before1 = eloBefore.find(e => e.user_id === p1.id).elo;
  const after1 = eloAfter.find(e => e.user_id === p1.id);
  assert(after1.elo > before1, `ELO người thắng không tăng (${before1} → ${after1.elo})`);
  assert(after1.wins === 1, 'không ghi nhận thắng');
  assert(eloAfter.every(e => e.status === 'result'), 'trạng thái sau trận phải là result');
});

await test('Học sinh không tự nâng mình lên giáo viên được', async () => {
  const s = students[1];
  const { error } = await s.client.from('profiles').update({ role: 'teacher' }).eq('id', s.id);
  const { data: row } = await admin.from('profiles').select('role').eq('id', s.id).single();
  assert(row.role === 'student', 'LỖ HỔNG: học sinh tự lên được giáo viên!');
  void error;
});

await test('Học sinh không gọi được action của admin', async () => {
  let denied = false;
  try {
    const res = await call(students[2], 'admin_list_accounts');
    denied = res.success === false;
  } catch { denied = true; }
  assert(denied, 'LỖ HỔNG: học sinh gọi được admin_list_accounts');
});

await test('Đăng ký kèm đề nghị làm giáo viên chỉ tạo yêu cầu chờ duyệt', async () => {
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `xin${stamp}@lsts.edu.vn`;
  const { data, error } = await client.auth.signUp({
    email, password: 'XinLamGV@2026',
    options: { data: { nickname: 'Xin Lam GV', requested_role: 'teacher' } },
  });
  if (error) throw error;
  const { data: row } = await admin.from('profiles')
    .select('role,requested_role').eq('id', data.user.id).single();
  assert(row.role === 'student', `phải vào quyền student, đang là ${row.role}`);
  assert(row.requested_role === 'teacher', 'không ghi nhận đề nghị chờ duyệt');
});

// ── Báo cáo ─────────────────────────────────────────────────────────────────
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n  ${results.length - failed}/${results.length} test đạt`);
process.exit(failed ? 1 : 0);
