/**
 * Test logic ghép cặp hệ Thụy Sĩ. Chạy: node test_swiss.mjs
 */

import assert from 'node:assert/strict';
import { planSwissRound, suggestedRounds, finalStandings } from '../supabase/functions/_shared/swiss.ts';

const results = [];
const test = (name, fn) => {
  try { fn(); results.push(['PASS', name]); console.log(`  \x1b[32mPASS\x1b[0m  ${name}`); }
  catch (e) { results.push(['FAIL', name]); console.log(`  \x1b[31mFAIL\x1b[0m  ${name}\n        ${e.message}`); }
};

const p = (id, score = 0, elo = 1200, history = [], byes = 0) =>
  ({ user_id: id, nickname: id, score, elo, byes, opponent_history: history });

const lop = (n, f = () => ({})) => Array.from({ length: n }, (_, i) => p(`e${i}`, 0, 1200, [], 0, ...[]) )
  .map((x, i) => ({ ...x, ...f(i) }));

test('Số vòng đề xuất: 32 em → 5 vòng', () => {
  assert.equal(suggestedRounds(32), 5);
  assert.equal(suggestedRounds(16), 4);
  assert.equal(suggestedRounds(8), 3);
  assert.equal(suggestedRounds(64), 6);
});

test('Số vòng luôn nằm trong 3..9 mà CSDL cho phép', () => {
  assert.equal(suggestedRounds(2), 3);
  assert.equal(suggestedRounds(1000), 9);
});

test('32 học sinh → 16 cặp, không ai bị bỏ lại, không ai được miễn', () => {
  const { pairs, bye } = planSwissRound(lop(32));
  assert.equal(pairs.length, 16);
  assert.equal(bye, null);
  const ids = new Set(pairs.flat().map(x => x.user_id));
  assert.equal(ids.size, 32, 'mỗi em phải xuất hiện đúng một lần');
});

test('Sĩ số lẻ → đúng một em được miễn, những em còn lại đều có cặp', () => {
  const { pairs, bye } = planSwissRound(lop(31));
  assert.equal(pairs.length, 15);
  assert.ok(bye, 'phải có em được miễn');
  const ids = new Set([...pairs.flat().map(x => x.user_id), bye.user_id]);
  assert.equal(ids.size, 31);
});

test('Suất miễn rơi vào em xếp cuối, không phải em dẫn đầu', () => {
  const players = [p('gioi', 9), p('kha', 6), p('trungbinh', 3), p('cuoi', 0), p('cuoi2', 0)];
  const { bye } = planSwissRound(players);
  assert.ok(['cuoi', 'cuoi2'].includes(bye.user_id), `miễn nhầm cho ${bye.user_id}`);
});

test('Không miễn hai lần cho cùng một em khi còn người chưa được miễn', () => {
  const players = [p('a', 9), p('b', 6), p('c', 3), p('d', 0, 1200, [], 1), p('e', 0, 1200, [], 0)];
  const { bye } = planSwissRound(players);
  assert.equal(bye.user_id, 'e', 'phải ưu tiên em chưa từng được miễn');
});

test('Ghép người cùng điểm với nhau', () => {
  const players = [
    p('a', 9), p('b', 9), p('c', 3), p('d', 3), p('e', 0), p('f', 0),
  ];
  const { pairs } = planSwissRound(players);
  for (const [x, y] of pairs) {
    assert.equal(x.score, y.score, `${x.user_id}(${x.score}) ghép với ${y.user_id}(${y.score})`);
  }
});

test('Tránh tái đấu: đã gặp nhau thì tìm đối thủ khác', () => {
  const players = [
    p('a', 3, 1300, ['b']), p('b', 3, 1290, ['a']),
    p('c', 3, 1280), p('d', 3, 1270),
  ];
  const { pairs } = planSwissRound(players);
  const gapLai = pairs.some(([x, y]) =>
    (x.user_id === 'a' && y.user_id === 'b') || (x.user_id === 'b' && y.user_id === 'a'));
  assert.equal(gapLai, false, 'vẫn ghép lại cặp đã đấu');
  assert.equal(pairs.length, 2);
});

test('Cả bảng đã gặp hết thì chấp nhận tái đấu, không bỏ ai lại', () => {
  const players = [p('a', 3, 1300, ['b']), p('b', 3, 1290, ['a'])];
  const { pairs, bye } = planSwissRound(players);
  assert.equal(pairs.length, 1, 'phải vẫn ghép được');
  assert.equal(bye, null);
});

test('Chạy trọn 5 vòng cho 32 em: ai cũng đúng 5 trận, không ai gặp lại nhau', () => {
  const players = lop(32).map((x, i) => ({ ...x, elo: 1100 + i * 10 }));
  const soTran = Object.fromEntries(players.map(x => [x.user_id, 0]));
  for (let vong = 1; vong <= 5; vong += 1) {
    const { pairs, bye } = planSwissRound(players);
    assert.equal(bye, null, `vòng ${vong} không được có em miễn khi sĩ số chẵn`);
    assert.equal(pairs.length, 16, `vòng ${vong} phải có 16 cặp`);
    for (const [x, y] of pairs) {
      assert.ok(!x.opponent_history.includes(y.user_id),
        `vòng ${vong}: ${x.user_id} tái đấu ${y.user_id}`);
      x.opponent_history.push(y.user_id);
      y.opponent_history.push(x.user_id);
      soTran[x.user_id]++; soTran[y.user_id]++;
      // giả lập x thắng
      x.score += 3;
    }
  }
  const sai = Object.entries(soTran).filter(([, n]) => n !== 5);
  assert.equal(sai.length, 0, `có em không đủ 5 trận: ${JSON.stringify(sai.slice(0, 3))}`);
});

test('Bảng xếp hạng cuối: điểm trước, rồi ELO', () => {
  const xh = finalStandings([
    p('b', 6, 1300), p('a', 9, 1200), p('c', 6, 1400),
  ]);
  assert.deepEqual(xh.map(x => x.user_id), ['a', 'c', 'b']);
});

test('Dưới 2 người thì không ghép được cặp nào', () => {
  assert.deepEqual(planSwissRound([]).pairs, []);
  assert.equal(planSwissRound([p('a')]).pairs.length, 0);
});

const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n  ${results.length - failed}/${results.length} test đạt`);
process.exit(failed ? 1 : 0);
