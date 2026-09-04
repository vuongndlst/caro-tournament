// Logic ghép trận, tách khỏi edge function để test được bằng Node.
//
// Toàn bộ truy cập CSDL đi qua tham số `db` (một Supabase client thật, hoặc
// bản giả lập trong test). Không import Deno hay npm: ở đây, để Node có thể
// nạp trực tiếp file .ts này.

export const STALE_MATCHING_MS = 30_000;

export type PlayerRow = {
  user_id: string;
  elo: number;
  status: string;
  waiting_since: string | null;
  status_changed_at: string | null;
  last_opponent_id: string | null;
  opponent_history: string[] | null;
};

export function pairingScore(a: PlayerRow, b: PlayerRow, now = Date.now()) {
  const waitSeconds = Math.min(
    a.waiting_since ? (now - new Date(a.waiting_since).getTime()) / 1000 : 0,
    b.waiting_since ? (now - new Date(b.waiting_since).getTime()) / 1000 : 0,
  );
  const rankPenalty = Math.abs(a.elo - b.elo) * Math.max(0.1, 1 - waitSeconds / 60);
  const repeated = a.opponent_history?.includes(b.user_id) || b.opponent_history?.includes(a.user_id);
  const immediate = a.last_opponent_id === b.user_id || b.last_opponent_id === a.user_id;
  if (immediate && waitSeconds < 20) return Number.POSITIVE_INFINITY;
  return rankPenalty + (repeated && waitSeconds < 30 ? 10_000 : 0);
}

// Chọn các cặp tốt nhất theo kiểu tham lam. Hàm thuần: không đụng CSDL, nên
// test được trực tiếp.
export function planPairings(players: PlayerRow[], now = Date.now()): [PlayerRow, PlayerRow][] {
  const pool = [...players];
  const pairs: [PlayerRow, PlayerRow][] = [];
  while (pool.length >= 2) {
    let best: [number, number] | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pool.length; i += 1) for (let j = i + 1; j < pool.length; j += 1) {
      const score = pairingScore(pool[i], pool[j], now);
      if (score < bestScore) { best = [i, j]; bestScore = score; }
    }
    if (!best || !Number.isFinite(bestScore)) break;
    const [i, j] = best;
    pairs.push([pool[i], pool[j]]);
    pool.splice(j, 1); pool.splice(i, 1);
  }
  return pairs;
}

// Gỡ kẹt: người chơi mắc ở trạng thái "matching" quá lâu (edge function bị
// ngắt giữa chừng, mạng rớt...) sẽ không bao giờ được ghép lại, vì matchWaiting
// chỉ quét status = "waiting". Trả họ về hàng chờ.
export async function reclaimStaleMatching(db: any, tournamentId: string, now = Date.now()) {
  const cutoff = new Date(now - STALE_MATCHING_MS).toISOString();
  const { data = [] } = await db.from("tournament_players")
    .select("user_id")
    .eq("tournament_id", tournamentId)
    .eq("status", "matching")
    .lt("status_changed_at", cutoff);
  if (!data.length) return [];
  const stuck = data.map((row: any) => row.user_id);
  await db.from("tournament_players")
    .update({ status: "waiting", waiting_since: new Date(now).toISOString(), status_changed_at: new Date(now).toISOString() })
    .eq("tournament_id", tournamentId)
    .eq("status", "matching")
    .in("user_id", stuck);
  return stuck;
}

// Người chơi mang status "playing" nhưng không còn trận nào đang chạy (tải lại
// trang giữa trận, trận bị kết thúc bởi cron...) cũng bị kẹt vĩnh viễn. Đưa họ
// về "waiting".
export async function reclaimOrphanPlaying(db: any, tournamentId: string, now = Date.now()) {
  const playing = (await db.from("tournament_players")
    .select("user_id").eq("tournament_id", tournamentId).eq("status", "playing")).data ?? [];
  if (!playing.length) return [];
  const active = (await db.from("matches")
    .select("p1_id,p2_id").eq("tournament_id", tournamentId).eq("status", "active")).data ?? [];
  const busy = new Set<string>();
  for (const match of active) { busy.add(match.p1_id); busy.add(match.p2_id); }
  const orphans = playing.map((row: any) => row.user_id).filter((id: string) => !busy.has(id));
  if (!orphans.length) return [];
  await db.from("tournament_players")
    .update({ status: "waiting", waiting_since: new Date(now).toISOString(), status_changed_at: new Date(now).toISOString() })
    .eq("tournament_id", tournamentId)
    .eq("status", "playing")
    .in("user_id", orphans);
  return orphans;
}

export type MatchWaitingDeps = {
  emptyBoard: (size: number) => unknown;
  initialChessFen: () => string;
  turnMs: number;
  now?: () => number;
};

export async function matchWaiting(db: any, tournament: any, deps: MatchWaitingDeps) {
  if (tournament.status !== "active") return { paired: 0, reclaimed: [] as string[] };
  const nowMs = deps.now ? deps.now() : Date.now();

  const reclaimed = [
    ...await reclaimStaleMatching(db, tournament.id, nowMs),
    ...await reclaimOrphanPlaying(db, tournament.id, nowMs),
  ];

  const waiting = (await db.from("tournament_players").select("*")
    .eq("tournament_id", tournament.id).eq("status", "waiting")).data ?? [];

  let paired = 0;
  for (const [p1, p2] of planPairings(waiting, nowMs)) {
    const stamp = new Date(nowMs).toISOString();
    const claimed1 = await db.from("tournament_players").update({ status: "matching", status_changed_at: stamp })
      .match({ tournament_id: tournament.id, user_id: p1.user_id, status: "waiting" }).select("user_id");
    const claimed2 = await db.from("tournament_players").update({ status: "matching", status_changed_at: stamp })
      .match({ tournament_id: tournament.id, user_id: p2.user_id, status: "waiting" }).select("user_id");
    if (!claimed1.data?.length || !claimed2.data?.length) {
      // Ai đã bị chiếm thì trả ngay về hàng chờ, không để mắc kẹt.
      if (claimed1.data?.length) await releaseToWaiting(db, tournament.id, p1.user_id, stamp);
      if (claimed2.data?.length) await releaseToWaiting(db, tournament.id, p2.user_id, stamp);
      continue;
    }

    const isChess = tournament.game_type === "chess";
    const size = isChess ? 8 : tournament.game_type === "tictactoe" ? 3 : 15;
    const initial = isChess ? (tournament.chess_initial_ms || 300_000) : deps.turnMs;
    const started = new Date(nowMs);
    const deadline = new Date(nowMs + initial);

    try {
      const { error } = await db.from("matches").insert({
        tournament_id: tournament.id, p1_id: p1.user_id, p2_id: p2.user_id,
        board: isChess ? deps.initialChessFen() : deps.emptyBoard(size), board_size: size,
        current_turn: p1.user_id, p1_time_ms: isChess ? initial : null,
        p2_time_ms: isChess ? initial : null,
        chess_increment_ms: isChess ? (tournament.chess_increment_ms || 0) : null,
        turn_started_at: started.toISOString(), turn_deadline_at: deadline.toISOString(),
      });
      if (error) throw error;

      await Promise.all([
        db.from("tournament_players").update({
          status: "playing", waiting_since: null, status_changed_at: stamp,
          opponent_history: [...new Set([...(p1.opponent_history || []), p2.user_id])],
        }).match({ tournament_id: tournament.id, user_id: p1.user_id }),
        db.from("tournament_players").update({
          status: "playing", waiting_since: null, status_changed_at: stamp,
          opponent_history: [...new Set([...(p2.opponent_history || []), p1.user_id])],
        }).match({ tournament_id: tournament.id, user_id: p2.user_id }),
      ]);
      paired += 1;
    } catch (error) {
      // Bất kỳ lỗi nào sau khi đã chiếm chỗ đều phải trả người chơi về hàng
      // chờ, nếu không họ kẹt ở "matching" vĩnh viễn.
      await Promise.all([
        releaseToWaiting(db, tournament.id, p1.user_id, stamp),
        releaseToWaiting(db, tournament.id, p2.user_id, stamp),
      ]);
      throw error;
    }
  }
  return { paired, reclaimed };
}

async function releaseToWaiting(db: any, tournamentId: string, userId: string, stamp: string) {
  await db.from("tournament_players")
    .update({ status: "waiting", waiting_since: stamp, status_changed_at: stamp })
    .match({ tournament_id: tournamentId, user_id: userId });
}
