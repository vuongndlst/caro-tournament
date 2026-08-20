'use strict';

const assert = require('assert');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!URL || !SERVICE_KEY || !PUBLISHABLE_KEY) {
  console.error('Thiếu SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY hoặc SUPABASE_PUBLISHABLE_KEY.');
  process.exit(2);
}

const service = createClient(URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of value.replace(/=+$/g, '').toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, '0');
}

async function invoke(accessToken, action, payload = {}) {
  const response = await fetch(`${URL}/functions/v1/game-api`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  return { status: response.status, data: await response.json() };
}

(async () => {
  const suffix = Date.now();
  const adminEmail = `security-admin-${suffix}@example.com`;
  const studentEmail = `security-student-${suffix}@example.com`;
  const password = 'LSTS-Security@Test9';
  const createdIds = [];
  const createdTournamentIds = [];
  try {
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email: adminEmail, password, email_confirm: true,
      user_metadata: { nickname: 'Security Admin' },
      app_metadata: { role: 'admin', must_change_password: false },
    });
    if (createError) throw createError;
    createdIds.push(created.user.id);
    await new Promise(resolve => setTimeout(resolve, 500));
    const { error: roleError } = await service.from('profiles').update({ role: 'admin', mfa_required: true }).eq('id', created.user.id);
    if (roleError) throw roleError;

    const client = createClient(URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({ email: adminEmail, password });
    if (signInError) throw signInError;

    const beforeMfa = await invoke(signedIn.session.access_token, 'admin_list_accounts');
    assert.equal(beforeMfa.status, 403, 'Admin AAL1 phải bị chặn');

    const { data: enrollment, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Automated security test' });
    if (enrollError) throw enrollError;
    const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: enrollment.id });
    if (challengeError) throw challengeError;
    const { data: verified, error: verifyError } = await client.auth.mfa.verify({ factorId: enrollment.id, challengeId: challenge.id, code: totp(enrollment.totp.secret) });
    if (verifyError) throw verifyError;

    const afterMfa = await invoke(verified.access_token, 'admin_list_accounts');
    if (afterMfa.status !== 200) console.error(`AAL2 diagnostic: HTTP ${afterMfa.status} · ${afterMfa.data?.message || 'không có thông báo'}`);
    assert.equal(afterMfa.status, 200, 'Admin AAL2 phải truy cập được quản trị');
    assert.equal(afterMfa.data.success, true);

    const temporaryPassword = 'LSTS-Student@Test8';
    const createdStudent = await invoke(verified.access_token, 'admin_create_account', {
      email: studentEmail, nickname: `Security A ${suffix}`, role: 'student', temporaryPassword,
    });
    assert.equal(createdStudent.status, 200);
    createdIds.push(createdStudent.data.account.id);

    const studentClient = createClient(URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: studentLogin, error: studentLoginError } = await studentClient.auth.signInWithPassword({ email: studentEmail, password: temporaryPassword });
    if (studentLoginError) throw studentLoginError;
    const forcedBefore = await invoke(studentLogin.session.access_token, 'get_seasons');
    assert.equal(forcedBefore.status, 403, 'Học sinh dùng mật khẩu tạm phải bị chặn');
    const { error: passwordError } = await studentClient.auth.updateUser({ password: 'LSTS-Changed@Test6' });
    if (passwordError) throw passwordError;
    const { data: changedSession } = await studentClient.auth.getSession();
    const completed = await invoke(changedSession.session.access_token, 'complete_password_change');
    assert.equal(completed.status, 200, 'Đổi mật khẩu lần đầu phải hoàn tất');
    const forcedAfter = await invoke(changedSession.session.access_token, 'get_seasons');
    assert.equal(forcedAfter.status, 200, 'Sau khi đổi mật khẩu phải được sử dụng hệ thống');

    const secondEmail = `security-student-b-${suffix}@example.com`;
    const secondCreated = await invoke(verified.access_token, 'admin_create_account', {
      email: secondEmail, nickname: `Security B ${suffix}`, role: 'student', temporaryPassword,
    });
    assert.equal(secondCreated.status, 200);
    createdIds.push(secondCreated.data.account.id);
    const studentClientB = createClient(URL, PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: studentLoginB, error: studentLoginErrorB } = await studentClientB.auth.signInWithPassword({ email: secondEmail, password: temporaryPassword });
    if (studentLoginErrorB) throw studentLoginErrorB;
    const { error: passwordErrorB } = await studentClientB.auth.updateUser({ password: 'LSTS-ChangedB@Test5' });
    if (passwordErrorB) throw passwordErrorB;
    const { data: changedSessionB } = await studentClientB.auth.getSession();
    const completedB = await invoke(changedSessionB.session.access_token, 'complete_password_change');
    assert.equal(completedB.status, 200);

    const tournament = await invoke(verified.access_token, 'create_tournament', {
      name: `Automated seasonal ELO test ${suffix}`, gameType: 'tictactoe', isRated: true,
    });
    assert.equal(tournament.status, 200);
    createdTournamentIds.push(tournament.data.tournamentId);
    const gamePayload = { tournamentId: tournament.data.tournamentId, roomCode: tournament.data.roomCode };
    assert.equal((await invoke(changedSession.session.access_token, 'join_room', { ...gamePayload, nickname: createdStudent.data.account.nickname })).status, 200);
    assert.equal((await invoke(changedSessionB.session.access_token, 'join_room', { ...gamePayload, nickname: secondCreated.data.account.nickname })).status, 200);
    assert.equal((await invoke(verified.access_token, 'start_tournament', gamePayload)).status, 200);

    const tokens = {
      [createdStudent.data.account.id]: changedSession.session.access_token,
      [secondCreated.data.account.id]: changedSessionB.session.access_token,
    };
    let state = await invoke(changedSession.session.access_token, 'get_state', gamePayload);
    const moves = [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]];
    for (const [row, col] of moves) {
      const match = state.data.match;
      const moved = await invoke(tokens[match.currentTurn], 'make_move', { ...gamePayload, matchId: match.matchId, row, col });
      assert.equal(moved.status, 200, `Nước ${row},${col} phải hợp lệ`);
      state = await invoke(changedSession.session.access_token, 'get_state', gamePayload);
    }
    assert.equal(state.data.match.status, 'finished');
    const { data: seasonalRows, error: seasonalError } = await service.from('season_game_ratings')
      .select('user_id,elo,rated_games').eq('season_id', tournament.data.state.seasonId)
      .in('user_id', [createdStudent.data.account.id, secondCreated.data.account.id]);
    if (seasonalError) throw seasonalError;
    assert.equal(seasonalRows.length, 2);
    assert.ok(seasonalRows.every(row => row.rated_games === 1));
    assert.equal(seasonalRows.reduce((sum, row) => sum + row.elo, 0), 2400, 'ELO mùa phải zero-sum');
    assert.ok(seasonalRows.every(row => Math.abs(row.elo - 1200) <= 32), 'Placement delta phải được giới hạn');

    const locked = await invoke(verified.access_token, 'admin_set_lock', { userId: createdStudent.data.account.id, locked: true });
    assert.equal(locked.status, 200);
    const unlocked = await invoke(verified.access_token, 'admin_set_lock', { userId: createdStudent.data.account.id, locked: false });
    assert.equal(unlocked.status, 200);
    const reset = await invoke(verified.access_token, 'admin_reset_password', { userId: createdStudent.data.account.id, temporaryPassword: 'LSTS-Reset@Test7' });
    assert.equal(reset.status, 200);

    console.log('✅ AAL1 bị chặn; AAL2 được cấp quyền admin');
    console.log('✅ Tạo tài khoản, khóa/mở khóa và reset mật khẩu hoạt động');
    console.log('✅ Mật khẩu tạm bị chặn cho đến khi người dùng đổi mật khẩu');
    console.log('✅ ELO học kỳ cập nhật zero-sum và tuân thủ giới hạn placement');
  } finally {
    for (const id of createdTournamentIds.reverse()) {
      try { await service.from('tournaments').delete().eq('id', id); } catch { /* best effort test cleanup */ }
    }
    for (const id of createdIds.reverse()) {
      try { await service.auth.admin.deleteUser(id); } catch { /* best effort test cleanup */ }
    }
  }
})().catch(error => {
  console.error(`❌ Supabase security test: ${error.stack || error.message}`);
  process.exit(1);
});
