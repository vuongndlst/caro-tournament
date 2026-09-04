/**
 * Mô phỏng giải đấu 20 học sinh trên backend Supabase THẬT, cho cả 3 loại game.
 *
 * Khác simulate.js (chạy trên backend Socket.io cũ đã bỏ), file này đi đúng
 * đường production: client -> edge function game-api -> Postgres, qua Auth và
 * RLS thật.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node simulate_supabase.mjs [soHocSinh] [caro,tictactoe,chess]
 */

import { createClient } from '@supabase/supabase-js';
import { Chess } from 'chess.js';

const URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!ANON || !SERVICE) { console.error('Thiếu khoá Supabase'); process.exit(2); }

const NUM = Number(process.argv[2] || 20);
const GAMES = (process.argv[3] || 'caro,tictactoe,chess').split(',');
const TARGET_MATCHES = Number(process.env.TARGET_MATCHES || 20);
const MAX_SECONDS = Number(process.env.MAX_SECONDS || 240);

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const PASSWORD = 'SimBot@2026x';
const errors = [];
const noteError = (kind, detail) => errors.push({ kind, detail });

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
    const status = error.context?.status;
    try {
      const raw = await error.context?.text?.();
      if (raw) {
        try { const b = JSON.parse(raw); if (b?.message) msg = b.message; }
        catch { msg = raw.slice(0, 200); }
      }
    } catch { /* thân phản hồi đã bị đọc hoặc không có */ }
    return { success: false, message: status ? `[${status}] ${msg}` : msg };
  }
  return data;
}

// ── Chọn nước đi ────────────────────────────────────────────────────────────
function pickCaroMove(board, size, symbol) {
  // Ưu tiên nối dài chuỗi của mình, nếu không thì đánh cạnh quân đã có.
  const empty = [];
  let hasAny = false;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (board[r][c]) { hasAny = true; continue; }
    empty.push([r, c]);
  }
  if (!empty.length) return null;
  if (!hasAny) return { row: Math.floor(size / 2), col: Math.floor(size / 2) };

  const score = ([r, c]) => {
    let best = 0;
    for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
      let run = 0;
      for (const dir of [-1, 1]) {
        let rr = r + dr * dir, cc = c + dc * dir;
        while (rr >= 0 && rr < size && cc >= 0 && cc < size && board[rr][cc] === symbol) {
          run++; rr += dr * dir; cc += dc * dir;
        }
      }
      best = Math.max(best, run);
    }
    let near = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < size && cc >= 0 && cc < size && board[rr][cc]) near++;
    }
    return best * 10 + near;
  };
  empty.sort((a, b) => score(b) - score(a));
  const [row, col] = empty[0];
  return { row, col };
}

function pickChessMove(fen) {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;
  // Ưu tiên ăn quân để ván kết thúc sớm hơn.
  const captures = moves.filter(m => m.captured);
  const m = (captures.length ? captures : moves)[Math.floor(Math.random() * (captures.length || moves.length))];
  return { from: m.from, to: m.to, promotion: m.promotion || 'q' };
}

// ── Vòng lặp của một bot ────────────────────────────────────────────────────
async function botLoop(bot, ctx) {
  while (Date.now() < ctx.deadline && ctx.finished < TARGET_MATCHES) {
    const res = await call(bot, 'get_state', { tournamentId: ctx.tournamentId });
    if (!res.success) { noteError('get_state', `${bot.nickname}: ${res.message}`); await sleep(500); continue; }

    const m = res.match;
    if (!m || m.status !== 'active') {
      const me = res.state?.players?.find(p => p.id === bot.id);
      if (!me || me.status !== 'playing') {
        const next = await call(bot, 'request_next_match', { tournamentId: ctx.tournamentId });
        if (!next.success && !/chưa tham gia/i.test(next.message || '')) {
          noteError('request_next_match', `${bot.nickname}: ${next.message}`);
        }
      }
      await sleep(300 + Math.random() * 300);
      continue;
    }

    if (m.currentTurn !== bot.id) { await sleep(200); continue; }

    let payload;
    if (ctx.gameType === 'chess') {
      const move = pickChessMove(String(m.board));
      if (!move) { await sleep(300); continue; }
      payload = { move };
    } else {
      const move = pickCaroMove(m.board, m.size, m.yourSymbol);
      if (!move) { await sleep(300); continue; }
      payload = move;
    }

    const moved = await call(bot, 'make_move', { tournamentId: ctx.tournamentId, matchId: m.matchId, ...payload });
    if (moved.success) { ctx.moves++; }
    else if (/hết giờ/i.test(moved.message || '')) { ctx.timeouts++; }
    else if (!/Chưa đến lượt|không hợp lệ|vừa thay đổi/i.test(moved.message || '')) {
      noteError('make_move', `${bot.nickname}: ${moved.message}`);
    }
    await sleep(60);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Chạy một giải cho một loại game ─────────────────────────────────────────
async function runTournament(gameType, teacher, students) {
  const created = await call(teacher, 'create_tournament', {
    name: `Sim ${gameType}`, gameType,
    ...(gameType === 'chess' ? { chessMode: 'blitz', chessInitialMs: 180_000, chessIncMs: 2000 } : {}),
  });
  if (!created.success) throw new Error(`create_tournament ${gameType}: ${created.message}`);

  for (const s of students) {
    const r = await call(s, 'join_room', { roomCode: created.roomCode, nickname: s.nickname });
    if (!r.success) noteError('join_room', `${s.nickname}: ${r.message}`);
  }
  const started = await call(teacher, 'start_tournament', { tournamentId: created.tournamentId });
  if (!started.success) throw new Error(`start_tournament ${gameType}: ${started.message}`);

  const ctx = {
    tournamentId: created.tournamentId, gameType, moves: 0, timeouts: 0, finished: 0,
    deadline: Date.now() + MAX_SECONDS * 1000,
  };

  const counter = (async () => {
    while (Date.now() < ctx.deadline && ctx.finished < TARGET_MATCHES) {
      const { count } = await admin.from('matches')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', ctx.tournamentId).eq('status', 'finished');
      ctx.finished = count || 0;
      await sleep(1500);
    }
  })();

  await Promise.all([...students.map(s => botLoop(s, ctx)), counter]);

  // ── Kiểm tra tính đúng đắn sau giải ──────────────────────────────────────
  const { data: players } = await admin.from('tournament_players')
    .select('user_id,nickname,status,status_changed_at,elo,wins,draws,losses,score')
    .eq('tournament_id', ctx.tournamentId);
  const { data: matches } = await admin.from('matches')
    .select('id,status,winner_id,is_draw,p1_id,p2_id').eq('tournament_id', ctx.tournamentId);

  const stuckMatching = players.filter(p => p.status === 'matching'
    && Date.now() - new Date(p.status_changed_at).getTime() > 30_000);
  const activeIds = new Set(matches.filter(m => m.status === 'active').flatMap(m => [m.p1_id, m.p2_id]));
  const orphanPlaying = players.filter(p => p.status === 'playing' && !activeIds.has(p.user_id));
  const done = matches.filter(m => m.status === 'finished');
  const badResult = done.filter(m => !m.is_draw && !m.winner_id);

  const totalWins = players.reduce((a, p) => a + p.wins, 0);
  const totalLosses = players.reduce((a, p) => a + p.losses, 0);
  const totalDraws = players.reduce((a, p) => a + p.draws, 0);
  const decided = done.filter(m => !m.is_draw).length;
  const drawn = done.filter(m => m.is_draw).length;

  if (stuckMatching.length) noteError('stuck', `${gameType}: ${stuckMatching.length} người kẹt ở matching`);
  if (orphanPlaying.length) noteError('orphan', `${gameType}: ${orphanPlaying.length} người playing mồ côi`);
  if (badResult.length) noteError('result', `${gameType}: ${badResult.length} trận xong mà không có kết quả`);
  if (totalWins !== decided) noteError('sostat', `${gameType}: tổng thắng ${totalWins} ≠ số trận phân thắng bại ${decided}`);
  if (totalLosses !== decided) noteError('sostat', `${gameType}: tổng thua ${totalLosses} ≠ ${decided}`);
  if (totalDraws !== drawn * 2) noteError('sostat', `${gameType}: tổng hoà ${totalDraws} ≠ ${drawn * 2}`);

  const top = [...players].sort((a, b) => b.score - a.score || b.elo - a.elo)[0];
  return {
    gameType, tranXong: done.length, nuocDaDanh: ctx.moves, hetGio: ctx.timeouts,
    ketKhop: stuckMatching.length + orphanPlaying.length,
    hoa: drawn, quanQuan: top ? `${top.nickname} (${top.score}đ, ${top.elo} ELO)` : '—',
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
console.log(`\n${C.b}  Mô phỏng trên Supabase — ${NUM} học sinh · ${GAMES.join(', ')}${C.x}\n`);

await admin.from('seasons').update({ status: 'archived' }).eq('status', 'active');
await admin.from('seasons').insert({
  name: 'Mùa mô phỏng', school_year: '2026-2027', semester: '1', status: 'active',
});

const stamp = Date.now().toString().slice(-7);
const teacher = await makeUser(`simgv${stamp}@lsts.edu.vn`, 'teacher', 'GV Sim');
const students = [];
for (let i = 0; i < NUM; i++) {
  students.push(await makeUser(`simhs${stamp}_${i}@lsts.edu.vn`, 'student', `HS ${String(i).padStart(2, '0')}`));
}
console.log(`${C.d}  Đã tạo 1 giáo viên + ${students.length} học sinh${C.x}\n`);

const rows = [];
for (const g of GAMES) {
  process.stdout.write(`${C.d}  Đang chạy ${g}...${C.x}`);
  const t0 = Date.now();
  const r = await runTournament(g, teacher, students);
  console.log(`\r  ${C.g}✓${C.x} ${g.padEnd(10)} ${Math.round((Date.now() - t0) / 1000)}s${' '.repeat(20)}`);
  rows.push(r);
}

console.log(`\n${C.b}  ── Kết quả ──────────────────────────────────────────${C.x}`);
console.log(`  ${'Game'.padEnd(11)}${'Trận'.padEnd(7)}${'Nước'.padEnd(8)}${'Hoà'.padEnd(6)}${'Hết giờ'.padEnd(9)}${'Kẹt'.padEnd(6)}Quán quân`);
for (const r of rows) {
  console.log(`  ${r.gameType.padEnd(11)}${String(r.tranXong).padEnd(7)}${String(r.nuocDaDanh).padEnd(8)}${String(r.hoa).padEnd(6)}${String(r.hetGio).padEnd(9)}${(r.ketKhop ? C.r + r.ketKhop + C.x : '0').padEnd(6)}${r.quanQuan}`);
}

console.log('');
if (!errors.length) {
  console.log(`  ${C.g}Không phát hiện lỗi nào.${C.x}\n`);
} else {
  const byKind = {};
  for (const e of errors) (byKind[e.kind] ||= []).push(e.detail);
  console.log(`  ${C.r}Phát hiện ${errors.length} lỗi:${C.x}`);
  for (const [k, list] of Object.entries(byKind)) {
    console.log(`   ${C.r}[${k}]${C.x} ${list.length} lần — ví dụ: ${list[0]}`);
  }
  console.log('');
}
process.exit(errors.length ? 1 : 0);
