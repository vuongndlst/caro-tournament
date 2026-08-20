'use strict';

const assert = require('assert');
const {
  getRankInfo,
  getKFactor,
  calculateEloPair,
} = require('./elo');

function verifyPair(label, input, expected) {
  const result = calculateEloPair(...input);
  assert.strictEqual(result.p1Delta, expected[0], `${label}: sai delta P1`);
  assert.strictEqual(result.p2Delta, expected[1], `${label}: sai delta P2`);
  assert.strictEqual(result.p1Delta + result.p2Delta, 0, `${label}: ELO không zero-sum`);
  assert.ok(result.p1Elo >= 800 && result.p2Elo >= 800, `${label}: thấp hơn ELO sàn`);
  assert.ok(result.p1Elo <= 3000 && result.p2Elo <= 3000, `${label}: vượt ELO trần`);
  console.log(`✅ ${label}: ${result.p1Delta >= 0 ? '+' : ''}${result.p1Delta} / ${result.p2Delta >= 0 ? '+' : ''}${result.p2Delta} (K=${result.k})`);
}

verifyPair('Hai người mới cùng 1200, P1 thắng', [1200, 1200, 1, 0, 0], [24, -24]);
verifyPair('Định hạng thắng ngược không vượt biên', [900, 1500, 1, 0, 0], [32, -32]);
verifyPair('Sau định hạng nhưng còn provisional', [1200, 1200, 1, 7, 7], [16, -16]);
verifyPair('Hai người ổn định cùng 1200, P1 thắng', [1200, 1200, 1, 10, 10], [12, -12]);
verifyPair('1400 thắng 1200', [1400, 1200, 1, 10, 10], [6, -6]);
verifyPair('1200 thắng ngược 1400', [1200, 1400, 1, 10, 10], [18, -18]);
verifyPair('Hai người cùng 1200 hòa', [1200, 1200, 0.5, 10, 10], [0, 0]);
verifyPair('1200 hòa người 1400', [1200, 1400, 0.5, 10, 10], [6, -6]);
verifyPair('Chạm sàn vẫn zero-sum', [1200, 805, 1, 10, 10], [2, -2]);
verifyPair('Chạm trần vẫn zero-sum', [2995, 2200, 1, 10, 10], [0, 0]);

assert.strictEqual(getKFactor(1200, 1200, 4, 100), 48, 'Một người đang định hạng phải dùng K=48 cho cả cặp');
assert.strictEqual(getKFactor(1200, 1200, 9, 100), 32, 'Một người provisional phải dùng K=32 cho cả cặp');
assert.strictEqual(getKFactor(1200, 1200, 10, 10), 24, 'Người chơi ổn định phải dùng K=24');
assert.strictEqual(getKFactor(1900, 1900, 10, 10), 16, 'Nhóm ELO cao phải dùng K=16');

assert.strictEqual(getRankInfo(1200, 4).name, 'Định hạng');
assert.strictEqual(getRankInfo(999, 5).name, 'Gỗ');
assert.strictEqual(getRankInfo(1000, 5).name, 'Đồng');
assert.strictEqual(getRankInfo(1200, 5).name, 'Bạc');
assert.strictEqual(getRankInfo(1400, 5).name, 'Vàng');
assert.strictEqual(getRankInfo(1600, 5).name, 'Kim Cương');
assert.strictEqual(getRankInfo(1800, 5).name, 'Cao Thủ');

console.log('\n✅ THANG ELO: tất cả công thức, biên và cấp bậc đều hợp lệ.');
