export const ELO_START = 1200;
export const ELO_FLOOR = 800;
export const ELO_CEILING = 3000;
export const PLACEMENT_GAMES = 5;
export const PROVISIONAL_GAMES = 10;
export const MAX_PLACEMENT_DELTA = 32;
export const MAX_STANDARD_DELTA = 20;
export const MAX_MASTER_DELTA = 12;

export function rankInfo(elo: number, ratedGames = Number.POSITIVE_INFINITY) {
  if (ratedGames < PLACEMENT_GAMES) {
    return { name: "Định hạng", index: 2, emoji: "🎯", color: "indigo" };
  }
  if (elo >= 1800) return { name: "Cao Thủ", index: 5, emoji: "🔮", color: "purple" };
  if (elo >= 1600) return { name: "Kim Cương", index: 4, emoji: "💎", color: "cyan" };
  if (elo >= 1400) return { name: "Vàng", index: 3, emoji: "🏆", color: "yellow" };
  if (elo >= 1200) return { name: "Bạc", index: 2, emoji: "🥈", color: "slate" };
  if (elo >= 1000) return { name: "Đồng", index: 1, emoji: "🥉", color: "orange" };
  return { name: "Gỗ", index: 0, emoji: "🪵", color: "amber" };
}

export function getKFactor(p1Elo: number, p2Elo: number, p1Games = 0, p2Games = 0) {
  if (p1Games < PLACEMENT_GAMES || p2Games < PLACEMENT_GAMES) return 48;
  if (p1Games < PROVISIONAL_GAMES || p2Games < PROVISIONAL_GAMES) return 32;
  if ((p1Elo + p2Elo) / 2 >= 1800) return 16;
  return 24;
}

export function getMaxDelta(p1Elo: number, p2Elo: number, p1Games = 0, p2Games = 0) {
  if (p1Games < PROVISIONAL_GAMES || p2Games < PROVISIONAL_GAMES) return MAX_PLACEMENT_DELTA;
  if ((p1Elo + p2Elo) / 2 >= 1800) return MAX_MASTER_DELTA;
  return MAX_STANDARD_DELTA;
}

export function calculateEloPair(
  p1Elo: number,
  p2Elo: number,
  p1Result: number,
  p1Games = 0,
  p2Games = 0,
) {
  const k = getKFactor(p1Elo, p2Elo, p1Games, p2Games);
  const maxDelta = getMaxDelta(p1Elo, p2Elo, p1Games, p2Games);
  const expectedP1 = 1 / (1 + Math.pow(10, (p2Elo - p1Elo) / 400));
  let p1Delta = Math.round(k * (p1Result - expectedP1));
  p1Delta = Math.max(-maxDelta, Math.min(maxDelta, p1Delta));

  if (p1Delta > 0) {
    p1Delta = Math.min(p1Delta, ELO_CEILING - p1Elo, p2Elo - ELO_FLOOR);
  } else if (p1Delta < 0) {
    p1Delta = -Math.min(-p1Delta, p1Elo - ELO_FLOOR, ELO_CEILING - p2Elo);
  }

  return {
    p1Delta,
    p2Delta: p1Delta === 0 ? 0 : -p1Delta,
    p1Elo: p1Elo + p1Delta,
    p2Elo: p2Elo - p1Delta,
    k,
    maxDelta,
    expectedP1,
  };
}
