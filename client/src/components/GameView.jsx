import React, { useCallback, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { useGame } from '../context/GameContext';
import Board from './Board';
import TimerBar from './TimerBar';
import Countdown from './Countdown';
import EmojiReactions from './EmojiReactions';
import { sounds, isMuted, toggleMute } from '../utils/sounds';
import { Trophy, Handshake, Skull, ChevronRight, Swords, Volume2, VolumeX } from 'lucide-react';

// ── Confetti helper ────────────────────────────────────────────────────────────
function fireConfetti() {
  const burst = (opts) => confetti({
    particleCount: 80,
    spread: 70,
    startVelocity: 45,
    gravity: 0.8,
    ticks: 200,
    ...opts,
  });
  burst({ origin: { x: 0.25, y: 0.6 }, angle: 60 });
  burst({ origin: { x: 0.75, y: 0.6 }, angle: 120 });
  setTimeout(() => burst({ origin: { x: 0.5, y: 0.5 }, angle: 90, particleCount: 60 }), 300);
}

export default function GameView() {
  const {
    currentMatch, gameResult, playerId, nickname,
    playerStatus, makeMove, requestNextMatch, tournamentState,
    sendReaction, incomingReaction, showCountdown, hideCountdown,
  } = useGame();

  const [muted, setMuted] = useState(isMuted());
  const resultFired = useRef(false);

  const handleCellClick = useCallback((row, col) => {
    if (!currentMatch || playerStatus !== 'playing') return;
    if (currentMatch.currentTurn !== playerId) return;
    if (currentMatch.board[row][col] !== null) return;
    makeMove(currentMatch.matchId, row, col);
  }, [currentMatch, playerId, playerStatus, makeMove]);

  const handleToggleMute = () => {
    const nowMuted = toggleMute();
    setMuted(nowMuted);
  };

  const myScore = tournamentState?.leaderboard?.find(p => p.nickname === nickname);
  const isMyTurn = currentMatch?.currentTurn === playerId;

  // ── Tick sound when timer is urgent ───────────────────────────────────────
  const { turnStartedAt, turnDurationMs = 30000 } = currentMatch || {};
  useEffect(() => {
    if (!turnStartedAt || playerStatus !== 'playing') return;
    const checkTick = () => {
      const elapsed = Date.now() - turnStartedAt;
      const remaining = turnDurationMs - elapsed;
      if (remaining > 0 && remaining <= 10000 && isMyTurn) {
        sounds.tick();
      }
    };
    const id = setInterval(checkTick, 1000);
    return () => clearInterval(id);
  }, [turnStartedAt, turnDurationMs, isMyTurn, playerStatus]);

  // ── Result sounds + confetti ───────────────────────────────────────────────
  useEffect(() => {
    if (playerStatus === 'result' && gameResult && !resultFired.current) {
      resultFired.current = true;
      const { isDraw, winnerId } = gameResult;
      if (isDraw) {
        sounds.draw();
      } else if (winnerId === playerId) {
        sounds.win();
        setTimeout(fireConfetti, 300);
      } else {
        sounds.lose();
      }
    }
    if (playerStatus !== 'result') resultFired.current = false;
  }, [playerStatus, gameResult, playerId]);

  // ── Mute button (top-right corner) ────────────────────────────────────────
  const MuteBtn = (
    <button
      onClick={handleToggleMute}
      className="fixed top-4 right-4 z-30 p-2.5 rounded-xl bg-slate-800/90 border border-slate-700/60 hover:bg-slate-700 transition-colors shadow-lg"
      title={muted ? 'Bật âm thanh' : 'Tắt âm thanh'}
    >
      {muted
        ? <VolumeX className="w-4 h-4 text-slate-400" />
        : <Volume2 className="w-4 h-4 text-indigo-400" />}
    </button>
  );

  // ── Win / Lose / Draw result screen ───────────────────────────────────────
  if (playerStatus === 'result' && gameResult) {
    const { isDraw, winnerId, opponentDisconnected, winningCells, board } = gameResult;
    const iWon = winnerId === playerId;

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 flex flex-col items-center justify-center p-4 gap-5">
        {MuteBtn}

        {/* Result card */}
        <div className="card w-full max-w-sm text-center animate-bounce-in">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${
            isDraw ? 'bg-yellow-600/30 border-2 border-yellow-500' :
            iWon   ? 'bg-green-600/30 border-2 border-green-500' :
                     'bg-red-600/30 border-2 border-red-500'
          }`}>
            {isDraw ? <Handshake className="w-10 h-10 text-yellow-400" /> :
             iWon   ? <Trophy className="w-10 h-10 text-green-400" /> :
                      <Skull className="w-10 h-10 text-red-400" />}
          </div>

          <h2 className={`text-3xl font-extrabold mb-1 ${
            isDraw ? 'text-yellow-300' : iWon ? 'text-green-300' : 'text-red-400'
          }`}>
            {isDraw ? 'Hoà!' : iWon ? 'Chiến Thắng!' : 'Thua Rồi!'}
          </h2>

          <p className="text-slate-400 text-sm mb-3">
            {opponentDisconnected ? 'Đối thủ đã ngắt kết nối' :
             isDraw ? 'Hai bên không phân thắng bại' :
             iWon   ? `Bạn đã đánh bại ${currentMatch?.opponentNickname}!` :
                      `${currentMatch?.opponentNickname} đã thắng`}
          </p>

          <div className="bg-slate-700/50 rounded-xl px-4 py-2 mb-2">
            <span className="text-sm text-slate-400">Điểm nhận được: </span>
            <span className="font-bold text-indigo-300 text-lg">
              +{isDraw ? 1 : iWon ? 3 : 0} điểm
            </span>
          </div>

          {myScore && (
            <p className="text-slate-500 text-xs mb-5">
              Tổng: <span className="text-white font-semibold">{myScore.score}</span> điểm
              &nbsp;·&nbsp; {myScore.wins}T {myScore.draws}H {myScore.losses}B
              {myScore.streak >= 2 && (
                <span className="ml-2 text-orange-400 font-bold">🔥 ×{myScore.streak}</span>
              )}
            </p>
          )}

          <button onClick={requestNextMatch} className="btn-primary w-full flex items-center justify-center gap-2">
            <ChevronRight className="w-5 h-5" /> Trận tiếp theo
          </button>
        </div>

        {/* Final board */}
        {board && (
          <div className="w-full max-w-3xl animate-fade-in opacity-60 hover:opacity-100 transition-opacity">
            <p className="text-center text-xs text-slate-500 mb-2">Trạng thái bàn cờ cuối trận</p>
            <Board
              board={board}
              size={currentMatch?.size || 15}
              yourSymbol={currentMatch?.yourSymbol || 'X'}
              isMyTurn={false}
              onCellClick={() => {}}
              disabled={true}
              winningCells={winningCells}
            />
          </div>
        )}
      </div>
    );
  }

  if (!currentMatch) return null;

  const { opponentNickname, yourSymbol, board, size, winningCells } = currentMatch;
  const opponentStreak = tournamentState?.leaderboard?.find(p => p.id === currentMatch.opponentId)?.streak || 0;
  const myStreak       = tournamentState?.leaderboard?.find(p => p.nickname === nickname)?.streak || 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 flex flex-col items-center p-3 lg:p-5">
      {MuteBtn}

      {/* 3-2-1 Countdown */}
      {showCountdown && <Countdown onDone={hideCountdown} />}

      {/* Match header */}
      <div className="w-full max-w-3xl mb-3 animate-slide-down">
        <div className="card py-3 px-4">
          <div className="flex items-center justify-between gap-2">

            {/* Me */}
            <div className={`flex items-center gap-2 flex-1 min-w-0 transition-opacity duration-300 ${isMyTurn ? 'opacity-100' : 'opacity-40'}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm shrink-0 shadow-lg
                ${yourSymbol === 'X' ? 'bg-gradient-to-br from-blue-400 to-blue-700 text-white' : 'bg-gradient-to-br from-red-400 to-red-700 text-white'}`}>
                {yourSymbol}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-sm truncate leading-tight">
                  {nickname}
                  {myStreak >= 2 && <span className="ml-1 text-orange-400 text-xs">🔥{myStreak}</span>}
                </p>
                <p className="text-xs text-slate-400">{yourSymbol === 'X' ? '⬤ Xanh' : '⬤ Đỏ'}</p>
              </div>
              {isMyTurn && (
                <span className="badge bg-green-900/70 text-green-300 text-xs ml-auto shrink-0 animate-pulse-fast border border-green-700/50">
                  Lượt bạn
                </span>
              )}
            </div>

            {/* VS */}
            <div className="flex flex-col items-center shrink-0 px-2">
              <Swords className="w-4 h-4 text-slate-500" />
              <span className="text-[10px] text-slate-600 font-bold tracking-widest">VS</span>
            </div>

            {/* Opponent */}
            <div className={`flex items-center gap-2 flex-1 min-w-0 flex-row-reverse transition-opacity duration-300 ${!isMyTurn ? 'opacity-100' : 'opacity-40'}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm shrink-0 shadow-lg
                ${yourSymbol === 'X' ? 'bg-gradient-to-br from-red-400 to-red-700 text-white' : 'bg-gradient-to-br from-blue-400 to-blue-700 text-white'}`}>
                {yourSymbol === 'X' ? 'O' : 'X'}
              </div>
              <div className="min-w-0 text-right">
                <p className="font-bold text-sm truncate leading-tight">
                  {opponentStreak >= 2 && <span className="mr-1 text-orange-400 text-xs">🔥{opponentStreak}</span>}
                  {opponentNickname}
                </p>
                <p className="text-xs text-slate-400">{yourSymbol === 'X' ? '⬤ Đỏ' : '⬤ Xanh'}</p>
              </div>
              {!isMyTurn && (
                <span className="badge bg-amber-900/60 text-amber-300 text-xs mr-auto shrink-0 animate-pulse-fast border border-amber-700/40">
                  Đang nghĩ...
                </span>
              )}
            </div>
          </div>

          {/* Timer */}
          {currentMatch.turnStartedAt && !showCountdown && (
            <div className="mt-3 pt-3 border-t border-slate-700/60">
              <TimerBar
                key={currentMatch.turnStartedAt}
                turnStartedAt={currentMatch.turnStartedAt}
                turnDurationMs={currentMatch.turnDurationMs || 30000}
                isMyTurn={isMyTurn}
              />
            </div>
          )}
        </div>
      </div>

      {/* Board */}
      <div className="w-full max-w-3xl animate-fade-in">
        <Board
          board={board}
          size={size}
          yourSymbol={yourSymbol}
          isMyTurn={isMyTurn && !showCountdown}
          onCellClick={handleCellClick}
          disabled={playerStatus !== 'playing' || showCountdown}
          winningCells={winningCells}
        />
      </div>

      {/* Bottom bar: turn indicator + emoji reactions */}
      <div className="w-full max-w-3xl mt-3 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {isMyTurn
            ? <span className="text-indigo-300 font-medium animate-pulse-fast">Đến lượt bạn — hãy chọn ô để đánh!</span>
            : `Đang chờ ${opponentNickname} đánh...`}
        </p>

        {/* Emoji reactions */}
        <div className="relative shrink-0">
          <EmojiReactions
            onReact={sendReaction}
            incoming={incomingReaction}
          />
        </div>
      </div>
    </div>
  );
}
