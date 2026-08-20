import { Chess } from 'chess.js';

const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];
const CHESS_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

export function createPracticeBoard(gameType) {
  const size = gameType === 'tictactoe' ? 3 : 15;
  return Array.from({ length: size }, () => Array(size).fill(null));
}

export function findBoardResult(board, row, col, gameType) {
  const symbol = board[row]?.[col];
  if (!symbol) return null;
  const required = gameType === 'tictactoe' ? 3 : 5;

  for (const [dr, dc] of DIRECTIONS) {
    const cells = [[row, col]];
    let blocked = 0;
    for (const direction of [-1, 1]) {
      let r = row + dr * direction;
      let c = col + dc * direction;
      while (r >= 0 && r < board.length && c >= 0 && c < board.length && board[r][c] === symbol) {
        cells.push([r, c]);
        r += dr * direction;
        c += dc * direction;
      }
      if (r >= 0 && r < board.length && c >= 0 && c < board.length && board[r][c] !== null) blocked += 1;
    }

    if (cells.length >= required) {
      if (gameType === 'caro' && cells.length === 5 && blocked === 2) continue;
      return { winner: symbol, winningCells: cells };
    }
  }

  if (board.every(line => line.every(Boolean))) return { winner: null, isDraw: true, winningCells: null };
  return null;
}

function emptyCells(board) {
  const result = [];
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col] === null) result.push({ row, col });
    }
  }
  return result;
}

function candidateCells(board) {
  const occupied = [];
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board.length; col += 1) {
      if (board[row][col] !== null) occupied.push({ row, col });
    }
  }
  if (!occupied.length) {
    const center = Math.floor(board.length / 2);
    return [{ row: center, col: center }];
  }

  const candidates = new Map();
  for (const piece of occupied) {
    for (let dr = -2; dr <= 2; dr += 1) {
      for (let dc = -2; dc <= 2; dc += 1) {
        const row = piece.row + dr;
        const col = piece.col + dc;
        if (row >= 0 && row < board.length && col >= 0 && col < board.length && board[row][col] === null) {
          candidates.set(`${row},${col}`, { row, col });
        }
      }
    }
  }
  return [...candidates.values()];
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)] || null;
}

function boardAfter(board, row, col, symbol) {
  const next = board.map(line => [...line]);
  next[row][col] = symbol;
  return next;
}

function patternScore(board, row, col, symbol) {
  let score = 0;
  for (const [dr, dc] of DIRECTIONS) {
    let count = 1;
    let openEnds = 0;
    for (const direction of [-1, 1]) {
      let r = row + dr * direction;
      let c = col + dc * direction;
      while (r >= 0 && r < board.length && c >= 0 && c < board.length && board[r][c] === symbol) {
        count += 1;
        r += dr * direction;
        c += dc * direction;
      }
      if (r >= 0 && r < board.length && c >= 0 && c < board.length && board[r][c] === null) openEnds += 1;
    }
    if (count >= 5) score += 1_000_000;
    else if (count === 4 && openEnds === 2) score += 100_000;
    else if (count === 4 && openEnds === 1) score += 20_000;
    else if (count === 3 && openEnds === 2) score += 8_000;
    else if (count === 3 && openEnds === 1) score += 1_000;
    else if (count === 2 && openEnds === 2) score += 350;
    else score += count * 12 + openEnds * 4;
  }
  return score;
}

function chooseCaroMove(board, botSymbol, difficulty) {
  const opponent = botSymbol === 'X' ? 'O' : 'X';
  const candidates = candidateCells(board);
  if (difficulty === 'easy') return randomItem(candidates);

  for (const move of candidates) {
    const next = boardAfter(board, move.row, move.col, botSymbol);
    if (findBoardResult(next, move.row, move.col, 'caro')?.winner === botSymbol) return move;
  }
  for (const move of candidates) {
    const next = boardAfter(board, move.row, move.col, opponent);
    if (findBoardResult(next, move.row, move.col, 'caro')?.winner === opponent) return move;
  }

  const scored = scoreCaroCandidates(board, candidates, botSymbol, opponent, difficulty);
  if (difficulty === 'expert') return chooseCaroMinimaxMove(board, botSymbol, scored);
  return scored[0] || randomItem(candidates);
}

function scoreCaroCandidates(board, candidates, symbol, opponent, difficulty = 'hard') {
  const center = (board.length - 1) / 2;
  const scored = candidates.map(move => {
    const attackBoard = boardAfter(board, move.row, move.col, symbol);
    const defendBoard = boardAfter(board, move.row, move.col, opponent);
    const attack = patternScore(attackBoard, move.row, move.col, symbol);
    const defense = patternScore(defendBoard, move.row, move.col, opponent);
    const centerBonus = Math.max(0, 20 - Math.abs(move.row - center) - Math.abs(move.col - center));
    const noise = difficulty === 'medium' ? Math.random() * 180 : difficulty === 'expert' ? 0 : Math.random() * 8;
    const defenseWeight = difficulty === 'expert' ? 1.15 : difficulty === 'hard' ? 1.08 : 0.82;
    return { ...move, score: attack * 1.12 + defense * defenseWeight + centerBonus + noise };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function evaluateCaroPosition(board, botSymbol) {
  const opponent = botSymbol === 'X' ? 'O' : 'X';
  const candidates = candidateCells(board);
  if (!candidates.length) return 0;
  let botBest = 0;
  let opponentBest = 0;
  for (const move of candidates) {
    const botBoard = boardAfter(board, move.row, move.col, botSymbol);
    const opponentBoard = boardAfter(board, move.row, move.col, opponent);
    botBest = Math.max(botBest, patternScore(botBoard, move.row, move.col, botSymbol));
    opponentBest = Math.max(opponentBest, patternScore(opponentBoard, move.row, move.col, opponent));
  }
  return botBest * 1.08 - opponentBest * 1.12;
}

function minimaxCaro(board, depth, maximizing, botSymbol, alpha, beta, lastMove) {
  if (lastMove) {
    const terminal = findBoardResult(board, lastMove.row, lastMove.col, 'caro');
    if (terminal?.winner === botSymbol) return 10_000_000 + depth;
    if (terminal?.winner) return -10_000_000 - depth;
    if (terminal?.isDraw) return 0;
  }
  if (depth === 0) return evaluateCaroPosition(board, botSymbol);

  const symbol = maximizing ? botSymbol : (botSymbol === 'X' ? 'O' : 'X');
  const opponent = symbol === 'X' ? 'O' : 'X';
  const limit = depth >= 3 ? 7 : depth === 2 ? 6 : 5;
  const moves = scoreCaroCandidates(board, candidateCells(board), symbol, opponent, 'expert').slice(0, limit);
  if (!moves.length) return 0;

  if (maximizing) {
    let value = -Infinity;
    for (const move of moves) {
      const next = boardAfter(board, move.row, move.col, symbol);
      value = Math.max(value, minimaxCaro(next, depth - 1, false, botSymbol, alpha, beta, move));
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  }

  let value = Infinity;
  for (const move of moves) {
    const next = boardAfter(board, move.row, move.col, symbol);
    value = Math.min(value, minimaxCaro(next, depth - 1, true, botSymbol, alpha, beta, move));
    beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return value;
}

function chooseCaroMinimaxMove(board, botSymbol, rankedMoves) {
  const rootMoves = rankedMoves.slice(0, 9);
  let bestScore = -Infinity;
  let bestMoves = [];
  for (const move of rootMoves) {
    const next = boardAfter(board, move.row, move.col, botSymbol);
    const terminal = findBoardResult(next, move.row, move.col, 'caro');
    const score = terminal?.winner === botSymbol
      ? 10_000_000
      : minimaxCaro(next, 3, false, botSymbol, -Infinity, Infinity, move);
    if (score > bestScore) { bestScore = score; bestMoves = [move]; }
    else if (score === bestScore) bestMoves.push(move);
  }
  return randomItem(bestMoves) || rootMoves[0] || null;
}

function tttWinner(board) {
  const lines = [
    [[0,0],[0,1],[0,2]], [[1,0],[1,1],[1,2]], [[2,0],[2,1],[2,2]],
    [[0,0],[1,0],[2,0]], [[0,1],[1,1],[2,1]], [[0,2],[1,2],[2,2]],
    [[0,0],[1,1],[2,2]], [[0,2],[1,1],[2,0]],
  ];
  for (const line of lines) {
    const [a, b, c] = line;
    if (board[a[0]][a[1]] && board[a[0]][a[1]] === board[b[0]][b[1]] && board[a[0]][a[1]] === board[c[0]][c[1]]) {
      return board[a[0]][a[1]];
    }
  }
  return board.every(row => row.every(Boolean)) ? 'draw' : null;
}

function minimaxTtt(board, maximizing, botSymbol) {
  const result = tttWinner(board);
  if (result) return result === 'draw' ? 0 : result === botSymbol ? 10 : -10;
  const symbol = maximizing ? botSymbol : (botSymbol === 'X' ? 'O' : 'X');
  let best = maximizing ? -Infinity : Infinity;
  for (const move of emptyCells(board)) {
    board[move.row][move.col] = symbol;
    const score = minimaxTtt(board, !maximizing, botSymbol);
    board[move.row][move.col] = null;
    best = maximizing ? Math.max(best, score) : Math.min(best, score);
  }
  return best;
}

function chooseTttMove(board, botSymbol, difficulty) {
  const moves = emptyCells(board);
  if (difficulty === 'easy') return randomItem(moves);
  const opponent = botSymbol === 'X' ? 'O' : 'X';
  for (const symbol of [botSymbol, opponent]) {
    for (const move of moves) {
      const next = boardAfter(board, move.row, move.col, symbol);
      if (tttWinner(next) === symbol) return move;
    }
  }
  if (difficulty === 'medium') {
    if (board[1][1] === null) return { row: 1, col: 1 };
    return randomItem(moves);
  }
  let bestScore = -Infinity;
  let bestMoves = [];
  for (const move of moves) {
    board[move.row][move.col] = botSymbol;
    const score = minimaxTtt(board, false, botSymbol);
    board[move.row][move.col] = null;
    if (score > bestScore) { bestScore = score; bestMoves = [move]; }
    else if (score === bestScore) bestMoves.push(move);
  }
  return randomItem(bestMoves);
}

export function chooseBoardMove(board, gameType, botSymbol, difficulty = 'medium') {
  if (!board?.length) return null;
  return gameType === 'tictactoe'
    ? chooseTttMove(board.map(row => [...row]), botSymbol, difficulty)
    : chooseCaroMove(board, botSymbol, difficulty);
}

function moveChess(chess, move) {
  return chess.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
}

function evaluateChess(chess, botColor) {
  if (chess.isCheckmate()) return chess.turn() === botColor ? -100_000 : 100_000;
  if (chess.isDraw()) return 0;
  let score = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const value = CHESS_VALUE[piece.type] || 0;
      const file = piece.square.charCodeAt(0) - 97;
      const rank = Number(piece.square[1]) - 1;
      const centerDistance = Math.abs(file - 3.5) + Math.abs(rank - 3.5);
      let position = 0;
      if (piece.type === 'n') position = Math.round((7 - centerDistance) * 8);
      else if (piece.type === 'b') position = Math.round((7 - centerDistance) * 4);
      else if (piece.type === 'p') {
        const advance = piece.color === 'w' ? rank : 7 - rank;
        position = advance * 5 + Math.round((7 - centerDistance) * 2);
      } else if (piece.type === 'q' || piece.type === 'r') position = Math.round((7 - centerDistance) * 1.5);
      score += piece.color === botColor ? value + position : -(value + position);
    }
  }
  if (chess.inCheck()) score += chess.turn() === botColor ? -35 : 35;
  return score;
}

function minimaxChess(chess, depth, alpha, beta, maximizing, botColor, deadline = Infinity, cache = null) {
  if (Date.now() > deadline) throw new Error('BOT_SEARCH_TIMEOUT');
  if (depth === 0 || chess.isGameOver()) return evaluateChess(chess, botColor);
  const cacheKey = cache ? `${chess.fen()}|${depth}|${maximizing ? 1 : 0}` : null;
  if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);
  const moves = chess.moves({ verbose: true }).sort((a, b) => {
    const aScore = (a.captured ? CHESS_VALUE[a.captured] : 0) + (a.promotion ? CHESS_VALUE[a.promotion] : 0);
    const bScore = (b.captured ? CHESS_VALUE[b.captured] : 0) + (b.promotion ? CHESS_VALUE[b.promotion] : 0);
    return bScore - aScore;
  });
  if (maximizing) {
    let value = -Infinity;
    for (const move of moves) {
      moveChess(chess, move);
      value = Math.max(value, minimaxChess(chess, depth - 1, alpha, beta, false, botColor, deadline, cache));
      chess.undo();
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    if (cacheKey) cache.set(cacheKey, value);
    return value;
  }
  let value = Infinity;
  for (const move of moves) {
    moveChess(chess, move);
    value = Math.min(value, minimaxChess(chess, depth - 1, alpha, beta, true, botColor, deadline, cache));
    chess.undo();
    beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  if (cacheKey) cache.set(cacheKey, value);
  return value;
}

function searchChessRoot(chess, botColor, depth, deadline) {
  const moves = chess.moves({ verbose: true });
  const cache = new Map();
  let bestScore = -Infinity;
  let bestMoves = [];
  for (const move of moves) {
    if (Date.now() > deadline) throw new Error('BOT_SEARCH_TIMEOUT');
    moveChess(chess, move);
    const score = minimaxChess(chess, depth, -Infinity, Infinity, false, botColor, deadline, cache);
    chess.undo();
    if (score > bestScore) { bestScore = score; bestMoves = [move]; }
    else if (score === bestScore) bestMoves.push(move);
  }
  return randomItem(bestMoves);
}

export function chooseChessMove(fen, difficulty = 'medium') {
  const chess = new Chess(fen);
  const moves = chess.moves({ verbose: true });
  if (!moves.length) return null;
  if (difficulty === 'easy') return randomItem(moves);

  const botColor = chess.turn();
  if (difficulty === 'medium') {
    const scored = moves.map(move => {
      const captured = move.captured ? CHESS_VALUE[move.captured] : 0;
      const promoted = move.promotion ? CHESS_VALUE[move.promotion] - CHESS_VALUE.p : 0;
      moveChess(chess, move);
      const checkBonus = chess.inCheck() ? 70 : 0;
      const mateBonus = chess.isCheckmate() ? 100_000 : 0;
      chess.undo();
      return { move, score: captured + promoted + checkBonus + mateBonus + Math.random() * 45 };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].move;
  }

  if (difficulty === 'expert') {
    const deadline = Date.now() + 3_500;
    let best = null;
    for (const depth of [1, 2, 3]) {
      try { best = searchChessRoot(chess, botColor, depth, deadline) || best; }
      catch (error) {
        if (error?.message !== 'BOT_SEARCH_TIMEOUT') throw error;
        break;
      }
    }
    return best || randomItem(moves);
  }

  return searchChessRoot(chess, botColor, 2, Infinity) || randomItem(moves);
}
