'use strict';

const ELO_START = 1200;
const ELO_FLOOR = 800;
const ELO_CEILING = 3000;
const PLACEMENT_GAMES = 5;
const PROVISIONAL_GAMES = 10;
const MAX_PLACEMENT_DELTA = 32;
const MAX_STANDARD_DELTA = 20;
const MAX_MASTER_DELTA = 12;

function getRankInfo(elo, ratedGames = Number.POSITIVE_INFINITY) {
  if (ratedGames < PLACEMENT_GAMES) {
    return { name: 'Định hạng', index: 2, emoji: '🎯', color: 'indigo' };
  }
  if (elo >= 1800) return { name: 'Cao Thủ',   index: 5, emoji: '🔮', color: 'purple' };
  if (elo >= 1600) return { name: 'Kim Cương', index: 4, emoji: '💎', color: 'cyan' };
  if (elo >= 1400) return { name: 'Vàng',      index: 3, emoji: '🏆', color: 'yellow' };
  if (elo >= 1200) return { name: 'Bạc',       index: 2, emoji: '🥈', color: 'slate' };
  if (elo >= 1000) return { name: 'Đồng',      index: 1, emoji: '🥉', color: 'orange' };
  return                  { name: 'Gỗ',        index: 0, emoji: '🪵', color: 'amber' };
}

function getKFactor(p1Elo, p2Elo, p1Games = 0, p2Games = 0) {
  if (p1Games < PLACEMENT_GAMES || p2Games < PLACEMENT_GAMES) return 48;
  if (p1Games < PROVISIONAL_GAMES || p2Games < PROVISIONAL_GAMES) return 32;
  if ((p1Elo + p2Elo) / 2 >= 1800) return 16;
  return 24;
}

function getMaxDelta(p1Elo, p2Elo, p1Games = 0, p2Games = 0) {
  if (p1Games < PROVISIONAL_GAMES || p2Games < PROVISIONAL_GAMES) return MAX_PLACEMENT_DELTA;
  if ((p1Elo + p2Elo) / 2 >= 1800) return MAX_MASTER_DELTA;
  return MAX_STANDARD_DELTA;
}

/**
 * Calculate one zero-sum rating change for a match.
 * p1Result: 1 = p1 wins, 0.5 = draw, 0 = p1 loses.
 * The same K is used for both players so streaks cannot create rating inflation.
 */
function calculateEloPair(p1Elo, p2Elo, p1Result, p1Games = 0, p2Games = 0) {
  const k = getKFactor(p1Elo, p2Elo, p1Games, p2Games);
  const maxDelta = getMaxDelta(p1Elo, p2Elo, p1Games, p2Games);
  const expectedP1 = 1 / (1 + Math.pow(10, (p2Elo - p1Elo) / 400));
  let p1Delta = Math.round(k * (p1Result - expectedP1));
  p1Delta = Math.max(-maxDelta, Math.min(maxDelta, p1Delta));

  // Keep the pair strictly zero-sum even when one rating reaches a boundary.
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

module.exports = {
  ELO_START,
  ELO_FLOOR,
  ELO_CEILING,
  PLACEMENT_GAMES,
  PROVISIONAL_GAMES,
  MAX_PLACEMENT_DELTA,
  MAX_STANDARD_DELTA,
  MAX_MASTER_DELTA,
  getRankInfo,
  getKFactor,
  getMaxDelta,
  calculateEloPair,
};
