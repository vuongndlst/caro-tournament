import React, { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bot, BrainCircuit, Crown, Gamepad2, RotateCcw, Shield, Sparkles, Trophy, User } from 'lucide-react';
import Board from '../components/Board';
import ChessBoard from '../components/ChessBoard';
import Footer from '../components/Footer';
import { chooseBoardMove, chooseChessMove, createPracticeBoard, findBoardResult } from '../utils/botEngine';
import { sounds } from '../utils/sounds';

const GAME_OPTIONS = [
  { id: 'caro', label: 'Cờ Caro', icon: '⚫', description: 'Bàn 15×15, 5 quân liên tiếp' },
  { id: 'tictactoe', label: 'Tic-tac-toe', icon: '❎', description: 'Bàn 3×3, luyện phản xạ nhanh' },
  { id: 'chess', label: 'Cờ vua', icon: '♟️', description: 'Đầy đủ nước đi hợp lệ của cờ vua' },
];

const DIFFICULTIES = [
  { id: 'easy', label: 'Dễ', icon: Sparkles, color: 'green', description: 'Bot chọn nước hợp lệ, đôi khi mắc sai lầm.' },
  { id: 'medium', label: 'Vừa', icon: Shield, color: 'yellow', description: 'Biết tấn công, phòng thủ và chặn nước thắng.' },
  { id: 'hard', label: 'Khó', icon: BrainCircuit, color: 'red', description: 'Đánh giá thế cờ và dự đoán các nước tiếp theo.' },
  { id: 'expert', label: 'Siêu khó', icon: Crown, color: 'purple', description: 'Minimax sâu + alpha-beta, luôn giả định bạn đi nước tốt nhất.' },
];

const DIFFICULTY_STYLE = {
  easy:   { selected: 'bg-green-900/30 border-green-500/70', icon: 'text-green-400' },
  medium: { selected: 'bg-yellow-900/30 border-yellow-500/70', icon: 'text-yellow-400' },
  hard:   { selected: 'bg-red-900/30 border-red-500/70', icon: 'text-red-400' },
  expert: { selected: 'bg-purple-900/30 border-purple-500/70', icon: 'text-purple-400' },
};

const DEFAULT_STATS = { wins: 0, draws: 0, losses: 0 };

function readStats() {
  try { return { ...DEFAULT_STATS, ...JSON.parse(localStorage.getItem('caro_practice_stats') || '{}') }; }
  catch { return DEFAULT_STATS; }
}

function chessResult(chess, moverSymbol) {
  if (chess.isCheckmate()) return { winner: moverSymbol, reason: 'Chiếu hết' };
  if (chess.isStalemate()) return { winner: null, isDraw: true, reason: 'Hết nước đi' };
  if (chess.isThreefoldRepetition()) return { winner: null, isDraw: true, reason: 'Lặp lại thế cờ' };
  if (chess.isInsufficientMaterial()) return { winner: null, isDraw: true, reason: 'Không đủ quân chiếu hết' };
  if (chess.isDraw()) return { winner: null, isDraw: true, reason: 'Hòa theo luật cờ vua' };
  return null;
}

export default function PracticePage() {
  const [phase, setPhase] = useState('setup');
  const [gameType, setGameType] = useState('caro');
  const [difficulty, setDifficulty] = useState('medium');
  const [side, setSide] = useState('first');
  const [humanSymbol, setHumanSymbol] = useState('X');
  const [board, setBoard] = useState(() => createPracticeBoard('caro'));
  const [currentTurn, setCurrentTurn] = useState('X');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [botThinking, setBotThinking] = useState(false);
  const [stats, setStats] = useState(readStats);

  const botSymbol = humanSymbol === 'X' ? 'O' : 'X';
  const boardSize = gameType === 'tictactoe' ? 3 : 15;
  const selectedDifficulty = DIFFICULTIES.find(item => item.id === difficulty);

  const checkMessage = useMemo(() => {
    if (gameType !== 'chess' || typeof board !== 'string' || phase !== 'playing') return '';
    try {
      const chess = new Chess(board);
      if (!chess.inCheck()) return '';
      return currentTurn === humanSymbol ? '⚠️ Vua của bạn đang bị chiếu!' : '♟ Vua của máy đang bị chiếu.';
    } catch { return ''; }
  }, [board, currentTurn, gameType, humanSymbol, phase]);

  function saveStats(next) {
    setStats(next);
    localStorage.setItem('caro_practice_stats', JSON.stringify(next));
  }

  function finishGame(outcome) {
    setResult(outcome);
    setPhase('finished');
    setBotThinking(false);
    const key = outcome.isDraw ? 'draws' : outcome.winner === humanSymbol ? 'wins' : 'losses';
    saveStats({ ...stats, [key]: stats[key] + 1 });
    if (outcome.isDraw) sounds.draw();
    else if (outcome.winner === humanSymbol) sounds.win();
    else sounds.lose();
  }

  function startGame() {
    const selectedSide = side === 'random' ? (Math.random() < 0.5 ? 'first' : 'second') : side;
    const symbol = selectedSide === 'first' ? 'X' : 'O';
    setHumanSymbol(symbol);
    setBoard(gameType === 'chess' ? new Chess().fen() : createPracticeBoard(gameType));
    setCurrentTurn('X');
    setResult(null);
    setHistory([]);
    setBotThinking(false);
    setPhase('playing');
    sounds.go();
  }

  function handleBoardMove(row, col) {
    if (phase !== 'playing' || botThinking || currentTurn !== humanSymbol || board[row][col] !== null) return;
    const previous = { board: board.map(line => [...line]), currentTurn };
    const next = board.map(line => [...line]);
    next[row][col] = humanSymbol;
    setHistory(items => [...items, previous]);
    setBoard(next);
    sounds.place();
    const outcome = findBoardResult(next, row, col, gameType);
    if (outcome) finishGame(outcome);
    else setCurrentTurn(botSymbol);
  }

  function handleChessMove(move) {
    if (phase !== 'playing' || botThinking || currentTurn !== humanSymbol) return;
    try {
      const chess = new Chess(board);
      const applied = chess.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
      if (!applied) return;
      setHistory(items => [...items, { board, currentTurn }]);
      setBoard(chess.fen());
      sounds.place();
      const outcome = chessResult(chess, humanSymbol);
      if (outcome) finishGame(outcome);
      else setCurrentTurn(botSymbol);
    } catch {}
  }

  useEffect(() => {
    if (phase !== 'playing' || currentTurn !== botSymbol) return undefined;
    setBotThinking(true);
    let worker = null;
    const delay = difficulty === 'easy' ? 450 : difficulty === 'medium' ? 650 : difficulty === 'hard' ? 850 : 300;

    const applyBotMove = (move) => {
      if (!move) { setBotThinking(false); return; }
      if (gameType === 'chess') {
        const chess = new Chess(board);
        chess.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
        setHistory(items => [...items, { board, currentTurn }]);
        setBoard(chess.fen());
        sounds.place();
        const outcome = chessResult(chess, botSymbol);
        if (outcome) finishGame(outcome);
        else { setCurrentTurn(humanSymbol); setBotThinking(false); }
        return;
      }

      const previous = { board: board.map(line => [...line]), currentTurn };
      const next = board.map(line => [...line]);
      next[move.row][move.col] = botSymbol;
      setHistory(items => [...items, previous]);
      setBoard(next);
      sounds.place();
      const outcome = findBoardResult(next, move.row, move.col, gameType);
      if (outcome) finishGame(outcome);
      else { setCurrentTurn(humanSymbol); setBotThinking(false); }
    };

    const timer = setTimeout(() => {
      if (difficulty === 'expert' && typeof Worker !== 'undefined') {
        worker = new Worker(new URL('../workers/botWorker.js', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => {
          if (data.success) applyBotMove(data.move);
          else setBotThinking(false);
          worker?.terminate();
          worker = null;
        };
        worker.onerror = () => { setBotThinking(false); worker?.terminate(); worker = null; };
        worker.postMessage({ gameType, board, botSymbol, difficulty });
        return;
      }
      const move = gameType === 'chess'
        ? chooseChessMove(board, difficulty)
        : chooseBoardMove(board, gameType, botSymbol, difficulty);
      applyBotMove(move);
    }, delay);
    return () => { clearTimeout(timer); worker?.terminate(); };
  }, [board, botSymbol, currentTurn, difficulty, gameType, humanSymbol, phase]);

  function undoTurn() {
    if (!history.length) return;
    if (phase === 'finished' && result) {
      const key = result.isDraw ? 'draws' : result.winner === humanSymbol ? 'wins' : 'losses';
      saveStats({ ...stats, [key]: Math.max(0, stats[key] - 1) });
    }
    let index = history.length - 1;
    while (index > 0 && history[index].currentTurn !== humanSymbol) index -= 1;
    const snapshot = history[index];
    setBoard(Array.isArray(snapshot.board) ? snapshot.board.map(line => [...line]) : snapshot.board);
    setCurrentTurn(snapshot.currentTurn);
    setHistory(items => items.slice(0, index));
    setResult(null);
    setPhase('playing');
    setBotThinking(false);
    sounds.click();
  }

  if (phase === 'setup') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 p-4 flex flex-col">
        <div className="w-full max-w-3xl mx-auto flex-1 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white mb-6">
            <ArrowLeft className="w-4 h-4" /> Trang chủ
          </Link>
          <div className="text-center mb-7">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-600 flex items-center justify-center mx-auto mb-3 shadow-xl shadow-indigo-900/50">
              <Bot className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-black">Luyện tập với máy</h1>
            <p className="text-sm text-slate-400 mt-1">Không ảnh hưởng ELO · chơi được ngay cả khi không có mạng</p>
          </div>

          <section className="card mb-4">
            <h2 className="font-bold mb-3">1. Chọn trò chơi</h2>
            <div className="grid sm:grid-cols-4 gap-2">
              {GAME_OPTIONS.map(item => (
                <button key={item.id} onClick={() => setGameType(item.id)} className={`text-left rounded-xl p-3 border transition-all ${gameType === item.id ? 'bg-indigo-600/25 border-indigo-500 shadow-lg shadow-indigo-950' : 'bg-slate-800/50 border-slate-700 hover:border-slate-500'}`}>
                  <span className="text-2xl">{item.icon}</span>
                  <p className="font-bold text-sm mt-1">{item.label}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{item.description}</p>
                </button>
              ))}
            </div>
          </section>

          <section className="card mb-4">
            <h2 className="font-bold mb-3">2. Chọn độ khó</h2>
            <div className="grid sm:grid-cols-3 gap-2">
              {DIFFICULTIES.map(item => {
                const Icon = item.icon;
                return (
                  <button key={item.id} onClick={() => setDifficulty(item.id)} className={`text-left rounded-xl p-3 border transition-all ${difficulty === item.id ? DIFFICULTY_STYLE[item.id].selected : 'bg-slate-800/50 border-slate-700 hover:border-slate-500'}`}>
                    <div className="flex items-center gap-2"><Icon className={`w-4 h-4 ${DIFFICULTY_STYLE[item.id].icon}`} /><span className="font-bold text-sm">{item.label}</span></div>
                    <p className="text-[11px] text-slate-400 mt-1">{item.description}</p>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="card mb-5">
            <h2 className="font-bold mb-3">3. Chọn lượt đi</h2>
            <div className="grid grid-cols-3 gap-2">
              {[['first', 'Đi trước', 'X / Trắng'], ['second', 'Đi sau', 'O / Đen'], ['random', 'Ngẫu nhiên', 'Máy chọn']].map(([id, label, detail]) => (
                <button key={id} onClick={() => setSide(id)} className={`rounded-xl py-2.5 border text-sm ${side === id ? 'bg-cyan-600/25 border-cyan-500 text-cyan-200' : 'bg-slate-800/50 border-slate-700 text-slate-400'}`}>
                  <span className="font-bold block">{label}</span><span className="text-[10px] opacity-70">{detail}</span>
                </button>
              ))}
            </div>
          </section>

          <button onClick={startGame} className="btn-primary w-full py-3 flex items-center justify-center gap-2 text-base">
            <Gamepad2 className="w-5 h-5" /> Bắt đầu luyện tập
          </button>

          <div className="grid grid-cols-3 gap-2 mt-4 text-center">
            <div className="bg-green-900/20 rounded-xl p-2"><strong className="text-green-400">{stats.wins}</strong><span className="text-xs text-slate-500 block">Thắng</span></div>
            <div className="bg-yellow-900/20 rounded-xl p-2"><strong className="text-yellow-400">{stats.draws}</strong><span className="text-xs text-slate-500 block">Hòa</span></div>
            <div className="bg-red-900/20 rounded-xl p-2"><strong className="text-red-400">{stats.losses}</strong><span className="text-xs text-slate-500 block">Thua</span></div>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const humanLabel = gameType === 'chess' ? (humanSymbol === 'X' ? 'Trắng' : 'Đen') : humanSymbol;
  const botLabel = gameType === 'chess' ? (botSymbol === 'X' ? 'Trắng' : 'Đen') : botSymbol;

  return (
    <div className="min-h-screen bg-slate-950 p-3 flex flex-col">
      <header className="w-full max-w-5xl mx-auto flex items-center gap-3 mb-3">
        <button onClick={() => setPhase('setup')} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700"><ArrowLeft className="w-4 h-4" /></button>
        <div className="flex-1"><h1 className="font-black">Luyện tập · {GAME_OPTIONS.find(item => item.id === gameType)?.label}</h1><p className="text-xs text-slate-500">Bot {selectedDifficulty?.label} · Không tính ELO</p></div>
        <button onClick={undoTurn} disabled={!history.length || botThinking} className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-30" title="Đi lại"><RotateCcw className="w-4 h-4" /></button>
      </header>

      <main className="w-full max-w-5xl mx-auto flex-1 grid lg:grid-cols-[220px_1fr_220px] gap-3 items-start">
        <div className={`card order-2 lg:order-1 ${currentTurn === humanSymbol && phase === 'playing' ? 'ring-2 ring-cyan-500/60' : ''}`}>
          <User className="w-7 h-7 text-cyan-400 mb-2" /><p className="font-bold">Bạn</p><p className="text-xs text-slate-400">Quân {humanLabel}</p>
          {currentTurn === humanSymbol && phase === 'playing' && <span className="inline-block mt-2 text-xs text-cyan-300 animate-pulse">● Đến lượt bạn</span>}
        </div>

        <div className="order-1 lg:order-2">
          {checkMessage && <div className="mb-2 rounded-xl bg-red-900/40 border border-red-600/50 text-red-200 text-sm font-bold text-center py-2">{checkMessage}</div>}
          {gameType === 'chess' ? (
            <ChessBoard fen={board} yourSymbol={humanSymbol} isMyTurn={currentTurn === humanSymbol} onMove={handleChessMove} disabled={phase !== 'playing' || botThinking} />
          ) : (
            <Board board={board} size={boardSize} gameType={gameType} yourSymbol={humanSymbol} isMyTurn={currentTurn === humanSymbol} onCellClick={handleBoardMove} disabled={phase !== 'playing' || botThinking} winningCells={result?.winningCells} />
          )}
          <div className="text-center h-7 mt-2 text-sm text-slate-400">
            {botThinking ? <span className="animate-pulse">🤖 Máy đang suy nghĩ...</span> : phase === 'playing' ? (currentTurn === humanSymbol ? 'Hãy chọn nước đi của bạn' : 'Đang chờ máy') : ''}
          </div>
        </div>

        <div className={`card order-3 ${currentTurn === botSymbol && phase === 'playing' ? 'ring-2 ring-indigo-500/60' : ''}`}>
          <Bot className="w-7 h-7 text-indigo-400 mb-2" /><p className="font-bold">Máy · {selectedDifficulty?.label}</p><p className="text-xs text-slate-400">Quân {botLabel}</p>
          {botThinking && <span className="inline-block mt-2 text-xs text-indigo-300 animate-pulse">● Đang tính nước</span>}
        </div>
      </main>

      {phase === 'finished' && result && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="card max-w-sm w-full text-center animate-bounce-in">
            <div className="text-5xl mb-3">{result.isDraw ? '🤝' : result.winner === humanSymbol ? '🏆' : '🤖'}</div>
            <h2 className="text-2xl font-black">{result.isDraw ? 'Trận đấu hòa!' : result.winner === humanSymbol ? 'Bạn đã thắng!' : 'Máy đã thắng!'}</h2>
            {result.reason && <p className="text-sm text-slate-400 mt-1">{result.reason}</p>}
            <p className="text-xs text-slate-500 mt-2">Chế độ luyện tập không thay đổi ELO.</p>
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button onClick={undoTurn} className="btn-secondary flex items-center justify-center gap-1.5"><RotateCcw className="w-4 h-4" /> Đi lại</button>
              <button onClick={startGame} className="btn-primary flex items-center justify-center gap-1.5"><Trophy className="w-4 h-4" /> Chơi lại</button>
            </div>
            <button onClick={() => setPhase('setup')} className="mt-3 text-xs text-slate-400 hover:text-white">Thay đổi thiết lập</button>
          </div>
        </div>
      )}
      <Footer />
    </div>
  );
}
