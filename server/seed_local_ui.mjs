/**
 * Tạo sẵn dữ liệu để test GIAO DIỆN với backend Supabase local.
 *
 * Tạo 1 giáo viên, N học sinh, 1 mùa giải và 1 giải đấu đang chạy, rồi in ra
 * mã phòng + tài khoản để đăng nhập bằng trình duyệt.
 *
 * Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *        node seed_local_ui.mjs [soHocSinh]
 */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COUNT = Number(process.argv[2] || 4);
if (!ANON || !SERVICE) { console.error('Thiếu khoá Supabase'); process.exit(2); }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const PASSWORD = 'TestUI@2026x';

async function makeUser(email, role, nickname) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { nickname },
    app_metadata: role === 'student' ? {} : { role },
  });
  if (error) throw error;
  await admin.from('profiles').update({ role, mfa_required: false, must_change_password: false })
    .eq('id', data.user.id);
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  return { id: data.user.id, email, nickname, client };
}

const call = async (who, action, payload = {}) => {
  const { data, error } = await who.client.functions.invoke('game-api', { body: { action, ...payload } });
  if (error) throw new Error(`${action}: ${error.message}`);
  if (!data?.success) throw new Error(`${action}: ${data?.message}`);
  return data;
};

await admin.from('seasons').update({ status: 'archived' }).eq('status', 'active');
await admin.from('seasons').insert({
  name: 'Mùa test giao diện', school_year: '2026-2027', semester: '1', status: 'active',
});

const stamp = Date.now().toString().slice(-6);
const teacher = await makeUser(`gv${stamp}@lsts.edu.vn`, 'teacher', 'Thay Vuong');
const created = await call(teacher, 'create_tournament', { name: 'Giải test giao diện', gameType: 'caro' });

const students = [];
for (let i = 0; i < COUNT; i += 1) {
  const s = await makeUser(`hs${stamp}${i}@lsts.edu.vn`, 'student', `Bot HS ${i}`);
  await call(s, 'join_room', { roomCode: created.roomCode, nickname: s.nickname });
  students.push(s);
}

// Một học sinh để trống cho trình duyệt đóng vai — KHÔNG cho vào phòng sẵn.
const human = await makeUser(`em${stamp}@lsts.edu.vn`, 'student', 'Em Test');

await call(teacher, 'start_tournament', { roomCode: created.roomCode, tournamentId: created.tournamentId });

console.log(JSON.stringify({
  roomCode: created.roomCode,
  tournamentId: created.tournamentId,
  matKhau: PASSWORD,
  giaoVien: teacher.email,
  hocSinhTrinhDuyet: human.email,
  botDaVaoPhong: students.map(s => s.email),
}, null, 2));
