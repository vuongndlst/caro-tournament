import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.2";
import { Chess } from "npm:chess.js@1.4.0";
import { calculateEloPair, rankInfo } from "../_shared/elo.ts";
import { matchWaiting as runMatchWaiting } from "../_shared/matchmaking.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TURN_MS = 30_000;

function cors(req: Request) {
  const origin = req.headers.get("origin") || "*";
  const configured = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map(v => v.trim()).filter(Boolean);
  return {
    "Access-Control-Allow-Origin": configured.length === 0 || configured.includes(origin) ? origin : configured[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function response(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8" },
  });
}

function bearerToken(req: Request) {
  return req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
}

function jwtAssuranceLevel(token: string) {
  try {
    const raw = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = raw.padEnd(Math.ceil(raw.length / 4) * 4, "=");
    return JSON.parse(atob(payload)).aal || "aal1";
  } catch {
    return "aal1";
  }
}

function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), n => chars[n % chars.length]).join("");
}

function emptyBoard(size: number) {
  return Array.from({ length: size }, () => Array(size).fill(null));
}

function checkLine(board: (string | null)[][], row: number, col: number, gameType: string) {
  const symbol = board[row]?.[col];
  if (!symbol) return null;
  const size = board.length;
  const required = gameType === "tictactoe" ? 3 : 5;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells: number[][] = [[row, col]];
    let blocked = 0;
    for (const direction of [-1, 1]) {
      let r = row + dr * direction;
      let c = col + dc * direction;
      while (r >= 0 && r < size && c >= 0 && c < size && board[r][c] === symbol) {
        cells.push([r, c]); r += dr * direction; c += dc * direction;
      }
      if (r < 0 || r >= size || c < 0 || c >= size || board[r]?.[c] !== null) blocked += 1;
    }
    if (cells.length >= required) {
      if (gameType === "caro" && cells.length === 5 && blocked === 2) continue;
      return cells;
    }
  }
  return null;
}

async function authenticatedContext(req: Request) {
  const token = bearerToken(req);
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error || !data.user ? null : { user: data.user, token, aal: jwtAssuranceLevel(token) };
}

async function profile(userId: string) {
  const { data } = await db.from("profiles").select("*").eq("id", userId).maybeSingle();
  return data;
}

async function gameRating(userId: string, gameType: string) {
  const { data: existing, error: selectError } = await db.from("profile_game_ratings")
    .select("*").match({ user_id: userId, game_type: gameType }).maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing;

  const { data, error } = await db.from("profile_game_ratings").insert({
    user_id: userId, game_type: gameType,
  }).select().single();
  if (error) throw error;
  return data;
}

async function seasonRating(userId: string, gameType: string, seasonId: string) {
  const { data: existing, error: selectError } = await db.from("season_game_ratings")
    .select("*").match({ user_id: userId, game_type: gameType, season_id: seasonId }).maybeSingle();
  if (selectError) throw selectError;
  if (existing) return existing;

  const { data, error } = await db.from("season_game_ratings").insert({
    user_id: userId, game_type: gameType, season_id: seasonId,
  }).select().single();
  if (error) throw error;
  return data;
}

async function activeSeason() {
  const { data, error } = await db.from("seasons").select("*").eq("status", "active").maybeSingle();
  if (error) throw error;
  return data;
}

function privilegedError(me: any, auth: any, requireAdmin = false) {
  if (me.is_locked) return "Tài khoản đã bị khóa.";
  if (requireAdmin ? me.role !== "admin" : !["teacher", "admin"].includes(me.role)) {
    return requireAdmin ? "Chỉ quản trị viên được thực hiện thao tác này." : "Không có quyền quản lý giải đấu.";
  }
  if (me.must_change_password) return "Bạn phải đổi mật khẩu tạm trước khi tiếp tục.";
  if (me.mfa_required && auth.aal !== "aal2") return "Bạn phải xác minh MFA trước khi tiếp tục.";
  return null;
}

async function tournamentByCode(code: string) {
  const { data } = await db.from("tournaments").select("*").eq("room_code", code.toUpperCase()).maybeSingle();
  return data;
}

async function tournamentById(id: string) {
  const { data } = await db.from("tournaments").select("*").eq("id", id).maybeSingle();
  return data;
}

async function tournamentState(tournament: any) {
  const [{ data: playerRows }, { data: matchRows }] = await Promise.all([
    db.from("tournament_players").select("*").eq("tournament_id", tournament.id),
    db.from("matches").select("*").eq("tournament_id", tournament.id).order("created_at"),
  ]);
  // Supabase trả data: null khi truy vấn lỗi, nên phải ?? [] chứ không dùng
  // được giá trị mặc định khi destructuring (chỉ áp dụng cho undefined).
  const players = playerRows ?? [];
  const matches = matchRows ?? [];
  const byId = new Map(players.map((player: any) => [player.user_id, player]));
  const leaderboard = [...players].map((player: any) => ({
    id: player.user_id, nickname: player.nickname, elo: player.elo, score: player.score,
    wins: player.wins, draws: player.draws, losses: player.losses, streak: player.streak,
    status: player.status, ratedGames: player.rated_games || 0,
    rank: rankInfo(player.elo, player.rated_games || 0),
  })).sort((a: any, b: any) => b.score - a.score || b.wins - a.wins || b.elo - a.elo);
  return {
    roomCode: tournament.room_code, tournamentId: tournament.id, name: tournament.name,
    gameType: tournament.game_type, status: tournament.status,
    seasonId: tournament.season_id, isRated: tournament.is_rated,
    chessMode: tournament.chess_mode,
    players: players.filter((p: any) => p.status !== "offline").map((p: any) => ({
      id: p.user_id, nickname: p.nickname, status: p.status === "result" ? "waiting" : p.status,
    })),
    matches: matches.map((match: any) => ({
      id: match.id, p1Id: match.p1_id, p2Id: match.p2_id,
      p1Nickname: byId.get(match.p1_id)?.nickname || "?",
      p2Nickname: byId.get(match.p2_id)?.nickname || "?",
      status: match.status, winner: match.winner_id,
    })),
    leaderboard,
  };
}

async function matchPayload(match: any, tournament: any, userId?: string) {
  const players = (await db.from("tournament_players")
    .select("user_id,nickname").eq("tournament_id", tournament.id)
    .in("user_id", [match.p1_id, match.p2_id])).data ?? [];
  const names = new Map(players.map((p: any) => [p.user_id, p.nickname]));
  const isP1 = userId === match.p1_id;
  return {
    matchId: match.id, tournamentId: tournament.id, roomCode: tournament.room_code,
    gameType: tournament.game_type,
    board: match.board, size: match.board_size, currentTurn: match.current_turn,
    status: match.status, p1Id: match.p1_id, p2Id: match.p2_id,
    p1Nickname: names.get(match.p1_id) || "?", p2Nickname: names.get(match.p2_id) || "?",
    opponentId: userId ? (isP1 ? match.p2_id : match.p1_id) : undefined,
    opponentNickname: userId ? names.get(isP1 ? match.p2_id : match.p1_id) : undefined,
    yourSymbol: userId ? (isP1 ? "X" : "O") : undefined,
    opponentSymbol: userId ? (isP1 ? "O" : "X") : undefined,
    p1TimeMs: match.p1_time_ms, p2TimeMs: match.p2_time_ms,
    chessIncMs: match.chess_increment_ms,
    turnStartedAt: match.turn_started_at ? new Date(match.turn_started_at).getTime() : null,
    turnDurationMs: match.turn_deadline_at && match.turn_started_at
      ? new Date(match.turn_deadline_at).getTime() - new Date(match.turn_started_at).getTime()
      : TURN_MS,
    winnerId: match.winner_id, isDraw: match.is_draw,
    winningCells: match.winning_cells, resultReason: match.result_reason,
    eloChange: userId ? (isP1 ? match.elo_delta_p1 : match.elo_delta_p2) : null,
    isRated: tournament.is_rated, seasonId: tournament.season_id,
    chessMode: tournament.chess_mode,
    version: match.version,
  };
}

async function historyPayload(userId: string, rows: any[]) {
  const opponentIds = [...new Set(rows.map(row => row.p1_id === userId ? row.p2_id : row.p1_id).filter(Boolean))];
  const opponents = (opponentIds.length
    ? await db.from("profiles").select("id,nickname").in("id", opponentIds)
    : { data: [] }).data ?? [];
  const names = new Map(opponents.map((item: any) => [item.id, item.nickname]));
  return rows.map(row => {
    const opponentId = row.p1_id === userId ? row.p2_id : row.p1_id;
    return {
      matchId: row.id, opponentId, opponentNickname: names.get(opponentId) || "?",
      startedAt: new Date(row.played_at).getTime(),
      result: row.is_draw ? "draw" : row.winner_id === userId ? "win" : "loss",
    };
  });
}

async function finishMatch(match: any, tournament: any, winnerId: string | null, isDraw: boolean, reason: string, winningCells: any = null) {
  if (match.status !== "active") return match;
  const players = (await db.from("tournament_players").select("*")
    .eq("tournament_id", tournament.id).in("user_id", [match.p1_id, match.p2_id])).data ?? [];
  const p1 = players.find((p: any) => p.user_id === match.p1_id);
  const p2 = players.find((p: any) => p.user_id === match.p2_id);
  if (!p1 || !p2) throw new Error("Không tìm thấy người chơi của trận");

  const p1Result = isDraw ? 0.5 : winnerId === p1.user_id ? 1 : 0;
  const p2Result = isDraw ? 0.5 : 1 - p1Result;
  const isRated = tournament.is_rated !== false;
  const eloResult = isRated
    ? calculateEloPair(p1.elo, p2.elo, p1Result, p1.rated_games || 0, p2.rated_games || 0)
    : { p1Delta: 0, p2Delta: 0 };
  const d1 = eloResult.p1Delta, d2 = eloResult.p2Delta;
  const playerUpdate = (player: any, result: number, delta: number) => ({
    status: "result", elo: player.elo + delta,
    score: player.score + (result === 1 ? 3 : result === 0.5 ? 1 : 0),
    wins: player.wins + (result === 1 ? 1 : 0),
    draws: player.draws + (result === 0.5 ? 1 : 0),
    losses: player.losses + (result === 0 ? 1 : 0),
    streak: result === 1 ? player.streak + 1 : 0,
    rated_games: (player.rated_games || 0) + (isRated ? 1 : 0),
    waiting_since: null,
  });
  const p1Update = playerUpdate(p1, p1Result, d1);
  const p2Update = playerUpdate(p2, p2Result, d2);

  const { data: finished, error } = await db.from("matches").update({
    status: "finished", winner_id: winnerId, is_draw: isDraw,
    result_reason: reason, winning_cells: winningCells,
    elo_delta_p1: d1, elo_delta_p2: d2,
    current_turn: null, turn_deadline_at: null, finished_at: new Date().toISOString(),
    version: match.version + 1,
  }).eq("id", match.id).eq("status", "active").select().maybeSingle();
  if (error) throw error;
  if (!finished) return match;

  const writes: any[] = [
    db.from("tournament_players").update({ ...p1Update, last_opponent_id: p2.user_id }).match({ tournament_id: tournament.id, user_id: p1.user_id }),
    db.from("tournament_players").update({ ...p2Update, last_opponent_id: p1.user_id }).match({ tournament_id: tournament.id, user_id: p2.user_id }),
    db.from("match_history").insert({ room_code: tournament.room_code, game_type: tournament.game_type,
      p1_id: p1.user_id, p2_id: p2.user_id, winner_id: winnerId, is_draw: isDraw,
      elo_delta_p1: d1, elo_delta_p2: d2, season_id: tournament.season_id,
      is_rated: isRated, chess_mode: tournament.chess_mode }),
  ];

  if (isRated) {
    const [{ data: gameRatingRows }, { data: seasonRatingRows }] = await Promise.all([
      db.from("profile_game_ratings").select("*").eq("game_type", tournament.game_type)
        .in("user_id", [p1.user_id, p2.user_id]),
      db.from("season_game_ratings").select("*").eq("season_id", tournament.season_id)
        .eq("game_type", tournament.game_type).in("user_id", [p1.user_id, p2.user_id]),
    ]);
    const gameRatings = gameRatingRows ?? [];
    const seasonRatings = seasonRatingRows ?? [];
    const fallback = (player: any) => ({ elo: player.elo, wins: 0, draws: 0, losses: 0, streak: 0, rated_games: 0 });
    const global1 = gameRatings.find((item: any) => item.user_id === p1.user_id) || fallback(p1);
    const global2 = gameRatings.find((item: any) => item.user_id === p2.user_id) || fallback(p2);
    const seasonal1 = seasonRatings.find((item: any) => item.user_id === p1.user_id) || fallback(p1);
    const seasonal2 = seasonRatings.find((item: any) => item.user_id === p2.user_id) || fallback(p2);
    const ratingRow = (base: any, userId: string, result: number, delta: number, extra: any = {}) => ({
      ...extra, user_id: userId, game_type: tournament.game_type,
      elo: Math.max(800, Math.min(3000, base.elo + delta)),
      rated_games: (base.rated_games || 0) + 1,
      wins: base.wins + (result === 1 ? 1 : 0),
      draws: base.draws + (result === 0.5 ? 1 : 0),
      losses: base.losses + (result === 0 ? 1 : 0),
      streak: result === 1 ? base.streak + 1 : 0,
      updated_at: new Date().toISOString(),
    });
    writes.push(
      db.from("profile_game_ratings").upsert(ratingRow(global1, p1.user_id, p1Result, d1), { onConflict: "user_id,game_type" }),
      db.from("profile_game_ratings").upsert(ratingRow(global2, p2.user_id, p2Result, d2), { onConflict: "user_id,game_type" }),
      db.from("season_game_ratings").upsert(ratingRow(seasonal1, p1.user_id, p1Result, d1, { season_id: tournament.season_id }), { onConflict: "season_id,user_id,game_type" }),
      db.from("season_game_ratings").upsert(ratingRow(seasonal2, p2.user_id, p2Result, d2, { season_id: tournament.season_id }), { onConflict: "season_id,user_id,game_type" }),
    );
  }

  await Promise.all(writes);
  return { ...finished, elo_delta_p1: d1, elo_delta_p2: d2 };
}

async function matchWaiting(tournament: any) {
  return await runMatchWaiting(db, tournament, {
    emptyBoard,
    initialChessFen: () => new Chess().fen(),
    turnMs: TURN_MS,
  });
}

async function processExpiredMatches() {
  const now = new Date().toISOString();
  const { data: expiredRows, error } = await db.from("matches").select("*")
    .eq("status", "active").lte("turn_deadline_at", now).limit(100);
  if (error) throw error;
  const expired = expiredRows ?? [];
  let processed = 0;
  for (const match of expired) {
    const tournament = await tournamentById(match.tournament_id);
    if (!tournament) continue;
    const winnerId = match.current_turn === match.p1_id ? match.p2_id : match.p1_id;
    const finished = await finishMatch(match, tournament, winnerId, false, "timeout");
    if (finished?.status === "finished") processed += 1;
  }
  return processed;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return response(req, { success: false, message: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const action = body.action;
    if (action === "process_expired_matches") {
      if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
        return response(req, { success: false, message: "Không có quyền." }, 403);
      }
      const processed = await processExpiredMatches();
      return response(req, { success: true, processed });
    }

    const auth = await authenticatedContext(req);
    if (!auth) return response(req, { success: false, message: "Vui lòng đăng nhập." }, 401);
    const user = auth.user;
    const me = await profile(user.id);
    if (!me) return response(req, { success: false, message: "Hồ sơ chưa sẵn sàng." }, 409);
    if (me.is_locked) return response(req, { success: false, message: "Tài khoản đã bị khóa." }, 403);

    if (action === "complete_password_change") {
      const { data: authUser, error } = await db.auth.admin.getUserById(user.id);
      if (error || !authUser.user) throw error || new Error("Không đọc được tài khoản Auth.");
      const resetAt = me.password_reset_at ? new Date(me.password_reset_at).getTime() : 0;
      const authUpdatedAt = new Date(authUser.user.updated_at || 0).getTime();
      if (resetAt && authUpdatedAt <= resetAt) {
        return response(req, { success: false, message: "Mật khẩu chưa được cập nhật." }, 409);
      }
      await Promise.all([
        db.from("profiles").update({ must_change_password: false, password_reset_at: null, updated_at: new Date().toISOString() }).eq("id", user.id),
        db.auth.admin.updateUserById(user.id, { app_metadata: { ...authUser.user.app_metadata, role: me.role, must_change_password: false } }),
      ]);
      return response(req, { success: true });
    }

    if (me.must_change_password) {
      return response(req, { success: false, message: "Bạn phải đổi mật khẩu tạm trước khi tiếp tục." }, 403);
    }

    if (["teacher", "admin"].includes(me.role)) {
      const securityDenied = privilegedError(me, auth);
      if (securityDenied) return response(req, { success: false, message: securityDenied }, 403);
    }

    if (action === "admin_list_accounts") {
      const denied = privilegedError(me, auth, true);
      if (denied) return response(req, { success: false, message: denied }, 403);
      const { data: usersData, error } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
      if (error) throw error;
      const users = usersData.users || [];
      const ids = users.map((item: any) => item.id);
      const profiles = (ids.length
        ? await db.from("profiles").select("id,nickname,role,must_change_password,is_locked,mfa_required,created_at,requested_role,requested_role_at").in("id", ids)
        : { data: [] }).data ?? [];
      const byId = new Map(profiles.map((item: any) => [item.id, item]));
      const accounts = await Promise.all(users.map(async (item: any) => {
        const { data: factorData } = await db.auth.admin.mfa.listFactors({ userId: item.id });
        const factors = factorData?.factors || [];
        return {
          id: item.id, email: item.email, lastSignInAt: item.last_sign_in_at,
          bannedUntil: item.banned_until, mfaEnabled: factors.some((factor: any) => factor.status === "verified"),
          ...byId.get(item.id),
        };
      }));
      accounts.sort((a: any, b: any) => (a.role || "").localeCompare(b.role || "") || (a.nickname || "").localeCompare(b.nickname || ""));
      return response(req, { success: true, accounts });
    }

    if (action === "admin_review_teacher_request") {
      const denied = privilegedError(me, auth, true);
      if (denied) return response(req, { success: false, message: denied }, 403);
      const targetId = String(body.userId || "");
      const approve = body.approve === true;
      if (!targetId) {
        return response(req, { success: false, message: "Thiếu tài khoản cần duyệt." }, 422);
      }
      const { data: target, error: targetError } = await db
        .from("profiles").select("id,role,requested_role").eq("id", targetId).single();
      if (targetError || !target) throw targetError || new Error("Không tìm thấy tài khoản.");
      if (target.requested_role !== "teacher") {
        return response(req, { success: false, message: "Tài khoản này không có đề nghị nào đang chờ." }, 409);
      }
      if (target.role !== "student") {
        return response(req, { success: false, message: "Chỉ nâng quyền được cho tài khoản học sinh." }, 409);
      }

      const reviewedAt = new Date().toISOString();
      if (!approve) {
        const { error } = await db.from("profiles")
          .update({ requested_role: null, requested_role_at: null, updated_at: reviewedAt })
          .eq("id", targetId);
        if (error) throw error;
        return response(req, { success: true, approved: false });
      }

      // Quyền thật nằm ở app_metadata; cập nhật trước rồi mới đồng bộ profile.
      const { data: authUser, error: authError } = await db.auth.admin.getUserById(targetId);
      if (authError || !authUser.user) throw authError || new Error("Không tìm thấy tài khoản Auth.");
      const { error: metaError } = await db.auth.admin.updateUserById(targetId, {
        app_metadata: { ...authUser.user.app_metadata, role: "teacher" },
      });
      if (metaError) throw metaError;

      const { error: profileError } = await db.from("profiles").update({
        role: "teacher", mfa_required: true,
        requested_role: null, requested_role_at: null, updated_at: reviewedAt,
      }).eq("id", targetId);
      if (profileError) {
        // Không để app_metadata lệch với profile nếu bước dưới hỏng.
        await db.auth.admin.updateUserById(targetId, {
          app_metadata: { ...authUser.user.app_metadata, role: "student" },
        });
        throw profileError;
      }
      return response(req, { success: true, approved: true });
    }

    if (action === "admin_create_account") {
      const denied = privilegedError(me, auth, true);
      if (denied) return response(req, { success: false, message: denied }, 403);
      const email = String(body.email || "").trim().toLowerCase();
      const nickname = String(body.nickname || "").trim().slice(0, 20);
      const role = ["student", "teacher"].includes(body.role) ? body.role : "student";
      const password = String(body.temporaryPassword || "");
      if (!/^\S+@\S+\.\S+$/.test(email) || nickname.length < 2 || password.length < 10) {
        return response(req, { success: false, message: "Email, biệt danh hoặc mật khẩu tạm không hợp lệ." }, 422);
      }
      const { data, error } = await db.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { nickname },
        app_metadata: { role, must_change_password: true },
      });
      if (error) throw error;
      const resetAt = new Date().toISOString();
      const { error: profileError } = await db.from("profiles").update({
        role, must_change_password: true, password_reset_at: resetAt,
        mfa_required: role === "teacher", is_locked: false, locked_at: null,
        updated_at: resetAt,
      }).eq("id", data.user.id);
      if (profileError) {
        await db.auth.admin.deleteUser(data.user.id);
        throw profileError;
      }
      const { data: createdProfile, error: profileReadError } = await db
        .from("profiles").select("nickname").eq("id", data.user.id).single();
      if (profileReadError) throw profileReadError;
      return response(req, {
        success: true,
        account: { id: data.user.id, email, nickname: createdProfile.nickname, role },
      });
    }

    if (action === "admin_reset_password") {
      const denied = privilegedError(me, auth, true);
      if (denied) return response(req, { success: false, message: denied }, 403);
      const targetId = String(body.userId || "");
      const password = String(body.temporaryPassword || "");
      if (!targetId || targetId === user.id || password.length < 10) {
        return response(req, { success: false, message: "Không thể reset tài khoản này hoặc mật khẩu quá ngắn." }, 422);
      }
      const { data: target, error: targetError } = await db.auth.admin.getUserById(targetId);
      if (targetError || !target.user) throw targetError || new Error("Không tìm thấy tài khoản.");
      const resetAt = new Date().toISOString();
      const { error } = await db.auth.admin.updateUserById(targetId, {
        password,
        app_metadata: { ...target.user.app_metadata, must_change_password: true },
      });
      if (error) throw error;
      await db.from("profiles").update({ must_change_password: true, password_reset_at: resetAt, updated_at: resetAt }).eq("id", targetId);
      return response(req, { success: true });
    }

    if (action === "admin_set_lock") {
      const denied = privilegedError(me, auth, true);
      if (denied) return response(req, { success: false, message: denied }, 403);
      const targetId = String(body.userId || "");
      const locked = body.locked === true;
      const target = await profile(targetId);
      if (!target || target.role !== "student" || targetId === user.id) {
        return response(req, { success: false, message: "Chỉ được khóa hoặc mở khóa tài khoản học sinh." }, 422);
      }
      const { error } = await db.auth.admin.updateUserById(targetId, { ban_duration: locked ? "876000h" : "none" });
      if (error) throw error;
      await db.from("profiles").update({ is_locked: locked, locked_at: locked ? new Date().toISOString() : null }).eq("id", targetId);
      return response(req, { success: true });
    }

    if (action === "get_seasons") {
      const { data: seasonRows, error } = await db.from("seasons").select("*").order("starts_at", { ascending: false });
      if (error) throw error;
      const seasons = seasonRows ?? [];
      const seasonId = body.seasonId || seasons[0]?.id;
      let query = db.from("season_leaderboard").select("*").eq("season_id", seasonId || "00000000-0000-0000-0000-000000000000");
      if (["caro", "tictactoe", "chess"].includes(body.gameType)) query = query.eq("game_type", body.gameType);
      const leaderboard = (await query.limit(200)).data ?? [];
      return response(req, { success: true, seasons, leaderboard });
    }

    if (action === "admin_create_season") {
      const denied = privilegedError(me, auth, true);
      if (denied) return response(req, { success: false, message: denied }, 403);
      const name = String(body.name || "").trim().slice(0, 80);
      const schoolYear = String(body.schoolYear || "");
      const semester = ["1", "2", "summer"].includes(body.semester) ? body.semester : "1";
      if (name.length < 2 || !/^\d{4}-\d{4}$/.test(schoolYear)) {
        return response(req, { success: false, message: "Tên mùa hoặc năm học không hợp lệ." }, 422);
      }
      await db.from("seasons").update({ status: "archived", ends_at: new Date().toISOString() }).eq("status", "active");
      const { data, error } = await db.from("seasons").insert({
        name, school_year: schoolYear, semester, status: "active", created_by: user.id,
      }).select().single();
      if (error) throw error;
      return response(req, { success: true, season: data });
    }

    if (action === "create_tournament") {
      const denied = privilegedError(me, auth);
      if (denied) return response(req, { success: false, message: denied }, 403);
      const gameType = ["caro", "tictactoe", "chess"].includes(body.gameType) ? body.gameType : "caro";
      const season = await activeSeason();
      if (!season) return response(req, { success: false, message: "Chưa có mùa giải đang hoạt động." }, 409);
      const chessMode = gameType === "chess" && ["blitz", "rapid", "standard", "custom"].includes(body.chessMode)
        ? body.chessMode : null;
      let code = roomCode();
      for (let i = 0; i < 5; i += 1) {
        const exists = await tournamentByCode(code); if (!exists) break; code = roomCode();
      }
      const { data, error } = await db.from("tournaments").insert({
        room_code: code, name: String(body.name || `Giải đấu ${new Date().toLocaleDateString("vi-VN")}`).slice(0, 60),
        game_type: gameType, teacher_id: user.id,
        season_id: season.id, is_rated: body.isRated !== false, chess_mode: chessMode,
        chess_initial_ms: gameType === "chess" ? Math.max(60_000, Number(body.chessInitialMs) || 300_000) : null,
        chess_increment_ms: gameType === "chess" ? Math.max(0, Number(body.chessIncMs) || 0) : null,
      }).select().single();
      if (error) throw error;
      return response(req, { success: true, roomCode: code, tournamentId: data.id, name: data.name, state: await tournamentState(data) });
    }

    const tournament = body.tournamentId ? await tournamentById(body.tournamentId) : await tournamentByCode(body.roomCode || "");
    if (!tournament) return response(req, { success: false, message: "Phòng không tồn tại." }, 404);
    const canManageTournament = tournament.teacher_id === user.id || me.role === "admin";
    const { data: membership } = await db.from("tournament_players").select("*")
      .match({ tournament_id: tournament.id, user_id: user.id }).maybeSingle();

    if (action === "join_room") {
      if (tournament.status === "finished") return response(req, { success: false, message: "Giải đấu đã kết thúc." }, 409);
      if (!membership) {
        const nickname = String(body.nickname || me.nickname).trim().slice(0, 20);
        const [rating] = await Promise.all([
          seasonRating(user.id, tournament.game_type, tournament.season_id),
          gameRating(user.id, tournament.game_type),
        ]);
        const { error } = await db.from("tournament_players").insert({
          tournament_id: tournament.id, user_id: user.id, nickname,
          elo: rating.elo, wins: 0, draws: 0, losses: 0, streak: rating.streak,
          rated_games: rating.rated_games || 0,
          status: "waiting", waiting_since: new Date().toISOString(),
        });
        if (error) throw error;
      }
      if (tournament.status === "active") await matchWaiting(tournament);

      // Vào lại sau khi tải lại trang: trả về trận đang chạy để client khôi
      // phục đúng màn hình, thay vì ném học sinh về sảnh và kẹt ở đó.
      const ongoing = (await db.from("matches").select("*")
        .eq("tournament_id", tournament.id).eq("status", "active")
        .or(`p1_id.eq.${user.id},p2_id.eq.${user.id}`).limit(1)).data ?? [];
      return response(req, { success: true, playerId: user.id, roomCode: tournament.room_code,
        tournamentId: tournament.id, state: await tournamentState(tournament),
        match: ongoing[0] ? await matchPayload(ongoing[0], tournament, user.id) : null });
    }

    if (!membership && !canManageTournament) return response(req, { success: false, message: "Bạn không thuộc giải đấu này." }, 403);

    if (action === "get_state" || action === "admin_rejoin") {
      const state = await tournamentState(tournament);
      const myMatches = (await db.from("matches").select("*").eq("tournament_id", tournament.id)
        .or(`p1_id.eq.${user.id},p2_id.eq.${user.id}`).order("created_at", { ascending: false }).limit(1)).data ?? [];
      return response(req, { success: true, state, tournamentId: tournament.id,
        match: myMatches[0] ? await matchPayload(myMatches[0], tournament, user.id) : null });
    }

    if (action === "start_tournament") {
      const denied = privilegedError(me, auth);
      if (!canManageTournament || denied) return response(req, { success: false, message: denied || "Không có quyền." }, 403);
      const { count } = await db.from("tournament_players").select("*", { count: "exact", head: true }).eq("tournament_id", tournament.id);
      if ((count || 0) < 2) return response(req, { success: false, message: "Cần ít nhất 2 học sinh." }, 409);
      const now = new Date().toISOString();
      await db.from("tournaments").update({ status: "active", started_at: now }).eq("id", tournament.id);
      await db.from("tournament_players").update({ waiting_since: now }).eq("tournament_id", tournament.id).eq("status", "waiting");
      await matchWaiting({ ...tournament, status: "active" });
      return response(req, { success: true });
    }

    if (action === "request_next_match") {
      if (!membership) return response(req, { success: false, message: "Bạn chưa tham gia." }, 403);
      // "matching" phải nằm trong danh sách, nếu không người chơi kẹt ở đó
      // không thể tự thoát ra bằng cách bấm tìm trận mới.
      await db.from("tournament_players").update({ status: "waiting", waiting_since: new Date().toISOString() })
        .match({ tournament_id: tournament.id, user_id: user.id }).in("status", ["result", "waiting", "matching"]);
      await matchWaiting(tournament);
      return response(req, { success: true });
    }

    if (action === "make_move") {
      const { data: match } = await db.from("matches").select("*").eq("id", body.matchId).eq("tournament_id", tournament.id).maybeSingle();
      if (!match || match.status !== "active") return response(req, { success: false, message: "Trận đấu không hợp lệ." }, 409);
      if (match.current_turn !== user.id) return response(req, { success: false, message: "Chưa đến lượt bạn." }, 409);
      const now = Date.now();
      if (match.turn_deadline_at && now >= new Date(match.turn_deadline_at).getTime()) {
        const winnerId = match.p1_id === user.id ? match.p2_id : match.p1_id;
        await finishMatch(match, tournament, winnerId, false, "timeout");
        return response(req, { success: false, timedOut: true, message: "Bạn đã hết giờ." }, 409);
      }
      let board = match.board;
      let nextTurn = match.p1_id === user.id ? match.p2_id : match.p1_id;
      let winnerId: string | null = null;
      let draw = false;
      let winningCells = null;
      let isCheck = false;
      let p1Time = match.p1_time_ms;
      let p2Time = match.p2_time_ms;

      if (tournament.game_type === "chess") {
        const chess = new Chess(String(match.board));
        let move;
        try { move = chess.move({ from: body.move?.from, to: body.move?.to, promotion: body.move?.promotion || "q" }); }
        catch { move = null; }
        if (!move) return response(req, { success: false, message: "Nước đi không hợp lệ." }, 422);
        const elapsed = Math.max(0, now - new Date(match.turn_started_at).getTime());
        if (user.id === match.p1_id) p1Time = Math.max(0, p1Time - elapsed) + match.chess_increment_ms;
        else p2Time = Math.max(0, p2Time - elapsed) + match.chess_increment_ms;
        board = chess.fen();
        if (chess.isCheckmate()) winnerId = user.id;
        else if (chess.isDraw()) draw = true;
        else isCheck = chess.inCheck();
      } else {
        const row = Number(body.row), col = Number(body.col);
        if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= match.board_size || col >= match.board_size)
          return response(req, { success: false, message: "Ô cờ không hợp lệ." }, 422);
        board = structuredClone(match.board);
        if (board[row][col] !== null) return response(req, { success: false, message: "Ô này đã được đánh." }, 409);
        board[row][col] = user.id === match.p1_id ? "X" : "O";
        winningCells = checkLine(board, row, col, tournament.game_type);
        winnerId = winningCells ? user.id : null;
        draw = !winnerId && board.every((line: any[]) => line.every(cell => cell !== null));
      }

      const turnStarted = new Date();
      const nextDuration = tournament.game_type === "chess"
        ? (nextTurn === match.p1_id ? p1Time : p2Time) : TURN_MS;
      const { data: updated, error } = await db.from("matches").update({
        board, current_turn: winnerId || draw ? match.current_turn : nextTurn,
        p1_time_ms: p1Time, p2_time_ms: p2Time,
        turn_started_at: turnStarted.toISOString(),
        turn_deadline_at: new Date(turnStarted.getTime() + nextDuration).toISOString(),
        last_move_at: turnStarted.toISOString(), version: match.version + 1,
      }).eq("id", match.id).eq("version", match.version).eq("status", "active").select().maybeSingle();
      if (error) throw error;
      if (!updated) return response(req, { success: false, message: "Trạng thái vừa thay đổi, vui lòng thử lại." }, 409);
      if (winnerId || draw) await finishMatch(updated, tournament, winnerId, draw, winnerId ? "win" : "draw", winningCells);
      return response(req, { success: true, isCheck });
    }

    if (action === "claim_timeout") {
      const { data: match } = await db.from("matches").select("*").eq("id", body.matchId).eq("tournament_id", tournament.id).maybeSingle();
      if (!match || match.status !== "active") return response(req, { success: true, alreadyFinished: true });
      if (!match.turn_deadline_at || Date.now() < new Date(match.turn_deadline_at).getTime())
        return response(req, { success: false, message: "Người chơi chưa hết giờ." }, 409);
      const winnerId = match.current_turn === match.p1_id ? match.p2_id : match.p1_id;
      await finishMatch(match, tournament, winnerId, false, "timeout");
      return response(req, { success: true, winnerId, timedOutPlayerId: match.current_turn });
    }

    if (action === "end_tournament") {
      const denied = privilegedError(me, auth);
      if (!canManageTournament || denied) return response(req, { success: false, message: denied || "Không có quyền." }, 403);
      await db.from("tournaments").update({ status: "finished", finished_at: new Date().toISOString() }).eq("id", tournament.id);
      const active = (await db.from("matches").select("*").eq("tournament_id", tournament.id).eq("status", "active")).data ?? [];
      for (const match of active) await finishMatch(match, { ...tournament, status: "finished" }, null, true, "tournament_ended");
      return response(req, { success: true, leaderboard: (await tournamentState({ ...tournament, status: "finished" })).leaderboard });
    }

    if (action === "spectate_match") {
      const { data: match } = await db.from("matches").select("*").eq("id", body.matchId).eq("tournament_id", tournament.id).maybeSingle();
      if (!match) return response(req, { success: false, message: "Trận không tồn tại." }, 404);
      return response(req, { success: true, match: await matchPayload(match, tournament) });
    }

    if (action === "send_reaction") {
      await db.from("game_events").insert({ tournament_id: tournament.id, match_id: body.matchId,
        actor_id: user.id, event_type: "reaction", payload: { emoji: String(body.emoji || "").slice(0, 8) } });
      return response(req, { success: true });
    }

    if (action === "get_player_stats") {
      const { data: player } = await db.from("tournament_players").select("*")
        .match({ tournament_id: tournament.id, user_id: body.playerId }).maybeSingle();
      if (!player) return response(req, { success: false, message: "Không tìm thấy học sinh." }, 404);
      const history = (await db.from("match_history").select("*")
        .or(`p1_id.eq.${body.playerId},p2_id.eq.${body.playerId}`).order("played_at", { ascending: false }).limit(20)).data ?? [];
      return response(req, { success: true, stats: { id: player.user_id, nickname: player.nickname,
        elo: player.elo, score: player.score, wins: player.wins, draws: player.draws,
        losses: player.losses, streak: player.streak, ratedGames: player.rated_games || 0,
        rank: rankInfo(player.elo, player.rated_games || 0),
        matchHistory: await historyPayload(body.playerId, history) } });
    }

    if (action === "get_my_history") {
      const history = (await db.from("match_history").select("*")
        .or(`p1_id.eq.${user.id},p2_id.eq.${user.id}`).order("played_at", { ascending: false }).limit(20)).data ?? [];
      return response(req, { success: true, history: await historyPayload(user.id, history) });
    }

    return response(req, { success: false, message: "Hành động không được hỗ trợ." }, 400);
  } catch (error) {
    console.error(error);
    return response(req, { success: false, message: error instanceof Error ? error.message : "Lỗi hệ thống." }, 500);
  }
});
