// Ghép cặp theo hệ Thụy Sĩ. Hàm thuần, không đụng CSDL, để test bằng Node.

export type SwissPlayer = {
  user_id: string;
  nickname?: string;
  score: number;
  elo: number;
  byes: number;
  opponent_history: string[] | null;
};

export type SwissPairing = {
  pairs: [SwissPlayer, SwissPlayer][];
  bye: SwissPlayer | null;
};

// Số vòng nên đấu: đủ để phân định ngôi đầu là log2(sĩ số), làm tròn lên.
// 8 em → 3 vòng, 16 → 4, 32 → 5, 64 → 6. Kẹp trong khoảng cho phép của CSDL.
export function suggestedRounds(playerCount: number) {
  if (playerCount < 2) return 3;
  return Math.min(9, Math.max(3, Math.ceil(Math.log2(playerCount))));
}

function hasMet(a: SwissPlayer, b: SwissPlayer) {
  return (a.opponent_history || []).includes(b.user_id)
    || (b.opponent_history || []).includes(a.user_id);
}

/**
 * Xếp cặp cho một vòng.
 *
 * Nguyên tắc Thụy Sĩ: sắp theo điểm giảm dần rồi ghép người kề nhau, nên các
 * em cùng trình độ gặp nhau. Tránh tái đấu bằng cách nhảy xuống đối thủ kế
 * tiếp chưa từng gặp; nếu cả bảng đều đã gặp thì chấp nhận tái đấu để không ai
 * bị bỏ lại (đúng thông lệ Thụy Sĩ).
 *
 * Sĩ số lẻ: một em được miễn đấu, ưu tiên em ít điểm nhất và chưa từng được
 * miễn — để suất miễn không rơi vào người đang dẫn đầu.
 */
export function planSwissRound(players: SwissPlayer[]): SwissPairing {
  if (players.length < 2) return { pairs: [], bye: players[0] ?? null };

  const ranked = [...players].sort((a, b) =>
    b.score - a.score || b.elo - a.elo || (a.nickname || '').localeCompare(b.nickname || ''));

  let bye: SwissPlayer | null = null;
  let pool = ranked;
  if (pool.length % 2 === 1) {
    // Duyệt từ dưới lên: em xếp cuối và chưa từng được miễn sẽ nhận suất.
    let chosen = pool[pool.length - 1];
    for (let i = pool.length - 1; i >= 0; i -= 1) {
      if (pool[i].byes === 0) { chosen = pool[i]; break; }
    }
    bye = chosen;
    pool = pool.filter(p => p.user_id !== chosen.user_id);
  }

  const pairs: [SwissPlayer, SwissPlayer][] = [];
  const taken = new Set<string>();
  for (let i = 0; i < pool.length; i += 1) {
    const a = pool[i];
    if (taken.has(a.user_id)) continue;
    let partner: SwissPlayer | null = null;
    // Ưu tiên đối thủ gần nhất về điểm mà chưa từng gặp.
    for (let j = i + 1; j < pool.length; j += 1) {
      const b = pool[j];
      if (taken.has(b.user_id)) continue;
      if (!hasMet(a, b)) { partner = b; break; }
    }
    // Cả bảng đã gặp hết thì lấy người kế tiếp còn trống.
    if (!partner) {
      for (let j = i + 1; j < pool.length; j += 1) {
        const b = pool[j];
        if (!taken.has(b.user_id)) { partner = b; break; }
      }
    }
    if (!partner) continue;
    taken.add(a.user_id); taken.add(partner.user_id);
    pairs.push([a, partner]);
  }

  return { pairs, bye };
}

// Bảng xếp hạng cuối: điểm, rồi ELO, rồi hiệu số thắng - thua.
export function finalStandings<T extends SwissPlayer & { wins?: number; losses?: number }>(players: T[]): T[] {
  return [...players].sort((a, b) =>
    b.score - a.score
    || b.elo - a.elo
    || ((b.wins || 0) - (b.losses || 0)) - ((a.wins || 0) - (a.losses || 0))
    || (a.nickname || '').localeCompare(b.nickname || ''));
}
