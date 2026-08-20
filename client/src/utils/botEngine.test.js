import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { chooseBoardMove, chooseChessMove, createPracticeBoard, findBoardResult } from './botEngine.js';

const caro = createPracticeBoard('caro');
for (let col = 3; col < 7; col += 1) caro[7][col] = 'O';
const caroWin = chooseBoardMove(caro, 'caro', 'O', 'hard');
assert.ok(caroWin && caroWin.row === 7 && [2, 7].includes(caroWin.col), 'Bot Caro phải hoàn tất 5 quân');

const block = createPracticeBoard('caro');
for (let col = 4; col < 8; col += 1) block[5][col] = 'X';
const blockMove = chooseBoardMove(block, 'caro', 'O', 'medium');
assert.ok(blockMove && blockMove.row === 5 && [3, 8].includes(blockMove.col), 'Bot Caro phải chặn nước thắng ngay');

const caroSearch = createPracticeBoard('caro');
[[7,7,'X'], [7,8,'O'], [8,7,'X'], [6,7,'O'], [8,8,'X'], [6,8,'O']]
  .forEach(([row, col, symbol]) => { caroSearch[row][col] = symbol; });
const caroStartedAt = Date.now();
const expertCaroMove = chooseBoardMove(caroSearch, 'caro', 'O', 'expert');
assert.ok(expertCaroMove && caroSearch[expertCaroMove.row][expertCaroMove.col] === null, 'Minimax Caro phải trả về ô trống hợp lệ');
assert.ok(Date.now() - caroStartedAt < 3_000, 'Minimax Caro phải hoàn thành trong ngân sách 3 giây');

const ttt = [['X', 'X', null], ['O', 'O', null], [null, null, null]];
assert.deepEqual(chooseBoardMove(ttt, 'tictactoe', 'O', 'hard'), { row: 1, col: 2 }, 'Bot 3x3 phải ưu tiên thắng');

const won = createPracticeBoard('caro');
for (let col = 0; col < 5; col += 1) won[2][col] = 'X';
assert.equal(findBoardResult(won, 2, 4, 'caro')?.winner, 'X');

const chess = new Chess();
const chessMove = chooseChessMove(chess.fen(), 'hard');
assert.ok(chessMove && chess.moves({ verbose: true }).some(move => move.from === chessMove.from && move.to === chessMove.to), 'Bot Chess phải trả về nước hợp lệ');

const expertChess = new Chess();
const chessStartedAt = Date.now();
const expertChessMove = chooseChessMove(expertChess.fen(), 'expert');
assert.ok(expertChess.moves({ verbose: true }).some(move => move.from === expertChessMove.from && move.to === expertChessMove.to), 'Minimax sâu Chess phải trả về nước hợp lệ');
assert.ok(Date.now() - chessStartedAt < 5_000, 'Chess siêu khó phải tôn trọng giới hạn suy nghĩ');

const mateInOne = new Chess('7k/5Q2/6K1/8/8/8/8/8 w - - 0 1');
const mateMove = chooseChessMove(mateInOne.fen(), 'medium');
mateInOne.move({ from: mateMove.from, to: mateMove.to, promotion: mateMove.promotion || 'q' });
assert.ok(mateInOne.isCheckmate() || mateInOne.inCheck(), 'Bot Chess vừa phải ưu tiên chiếu/chiếu hết');

console.log('✅ Bot Caro: biết thắng và chặn nước thắng');
console.log('✅ Bot Tic-tac-toe: ưu tiên thắng, minimax hoạt động');
console.log('✅ Bot Chess: chỉ chọn nước hợp lệ và ưu tiên chiếu');
console.log('✅ Siêu khó: minimax + alpha-beta hoạt động trong giới hạn thời gian');
