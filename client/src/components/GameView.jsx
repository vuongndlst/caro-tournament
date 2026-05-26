import React, { useCallback, useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { useGame } from '../context/GameContext';
import Board from './Board';
import ChessBoard from './ChessBoard';
import TimerBar from './TimerBar';
import Countdown from './Countdown';
import EmojiReactions from './EmojiReactions';
import { sounds, isMuted, toggleMute } from '../utils/sounds';
import { startMusic, stopMusic, setMusicMuted } from '../utils/music';
import { socket } from '../socket';
import {
  Trophy, Handshake, Skull, ChevronRight, Swords,
  Volume2, VolumeX, Clock, TrendingUp, LayoutList, X, WifiOff
} from 'lucide-react';

// ── Rank badge ─────────────────────────────────────────────────────────────────
const RANK_TEXT = {
  purple: 'text-purple-400', cyan: 'text-cyan-400', yellow: 'text-yellow-400',
  slate:  'text-slate-300',  orange: 'text-orange-400', amber: 'text-amber-500',
};
function RankBadge({ rank, className = '' }) {
  if (!rank) return null;
  return (
    <span className={`text-[11px] font-semibold ${RANK_TEXT[rank.color] || 'text-slate-400'} ${className}`}>
      {rank.emoji} {rank.name}
    </span>
  );
}

// ── Confetti helper ────────────────────────────────────────────────────────────
function fireConfetti() {
  const burst = (opts) => confetti({ particleCount: 80, spread: 70, startVelocity: 45, gravity: 0.8, ticks: 200, ...opts });
  burst({ origin: { x: 0.25, y: 0.6 }, angle: 60 });
  burst({ origin: { x: 0.75, y: 0.6 }, angle: 120 });
  setTimeout(() => burst({ origin: { x: 0.5, y: 0.5 }, angle: 90, particleCount: 60 }), 300);
}

// ── Auto-exit countdown hook ───────────────────────────────────────────────────
function useExitCountdown(active, onExpire, seconds = 10) {
  const [remaining, setRemaining] = useState(seconds);
  useEffect(() => {
    if (!active) { setRemaining(seconds); return; }
    setRemaining(seconds);
    const id = setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) { clearInterval(id); onExpire(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  return remaining;
}

export default function GameView() {
  const {
    currentMatch, gameResult, playerId, nickname,
    playerStatus, makeMove, requestNextMatch, returnToLobbyOnly,
    tournamentState, sendReaction, incomingReaction, showCountdown,
    hideCountdown, opponentReconnecting,
  } = useGame();

  const board = currentMatch?.board;

  const [muted,           setMuted]           = useState(isMuted());
  const [timedOutMsg,     setTimedOutMsg]      = useState('');
  const [showLeaderboard, setShowLeaderboard]  = useState(false);
  const autoQueue = true;
  const resultFired = useRef(false);

  // 10-second countdown after match ends → auto return to lobby
  const exitCountdown = useExitCountdown(
    playerStatus === 'result',
    () => requestNextMatch(),
  );

  const handleCellClick = useCallback((row, col) => {
    if (playerStatus !== 'playing' || currentMatch?.currentTurn !== playerId || showCountdown) return;
    if (!board || board[row][col] !== null) return;
    makeMove(currentMatch.matchId, row, col, null);
  }, [currentMatch, playerId, playerStatus, makeMove, board, showCountdown]);

  const handleChessMove = useCallback((move) => {
    if (playerStatus !== 'playing' || currentMatch?.currentTurn !== playerId || showCountdown) return;
    makeMove(currentMatch.matchId, null, null, move);
  }, [currentMatch, playerId, playerStatus, makeMove, showCountdown]);

  // Game background music
  useEffect(() => {
    if (playerStatus === 'playing') startMusic('game');
    else stopMusic();
    return () => stopMusic();
  }, [playerStatus]);

  const handleToggleMute = () => {
    const nowMuted = toggleMute();
    setMuted(nowMuted);
    setMusicMuted(nowMuted);
  };

  // Timeout notification: listen to move_made with timedOut flag
  useEffect(() => {
    const onMove = (data) => {
      if (!data.timedOut || data.matchId !== currentMatch?.matchId) return;
      const iMeTimedOut = data.timedOutPlayerId === playerId;
      const msg = iMeTimedOut
        ? `⏰ Bạn hết giờ! Lượt chuyển sang ${currentMatch?.opponentNickname}.`
        : `⏰ ${currentMatch?.opponentNickname} hết giờ! Đến lượt bạn.`;
      setTimedOutMsg(msg);
      setTimeout(() => setTimedOutMsg(''), 3500);
    };
    socket.on('move_made', onMove);
    return () => socket.off('move_made', onMove);
  }, [currentMatch?.matchId, currentMatch?.opponentNickname, playerId]);

  const myScore       = tournamentState?.leaderboard?.find(p => p.nickname === nickname);
  const myRankPos     = (tournamentState?.leaderboard?.findIndex(p => p.nickname === nickname) ?? -1) + 1;
  const isMyTurn      = currentMatch?.currentTurn === playerId;

  const opponentScore = tournamentState?.leaderboard?.find(p => p.id === currentMatch?.opponentId);
  const opponentRankPos = (tournamentState?.leaderboard?.findIndex(p => p.id === currentMatch?.opponentId) ?? -1) + 1;

  // Tick sound when timer is urgent
  const { turnStartedAt, turnDurationMs = 30000 } = currentMatch || {};
  useEffect(() => {
    if (!turnStartedAt || playerStatus !== 'playing') return;
    const id = setInterval(() => {
      const remaining = turnDurationMs - (Date.now() - turnStartedAt);
      if (remaining > 0 && remaining <= 10000 && isMyTurn) sounds.tick();
    }, 1000);
    return () => clearInterval(id);
  }, [turnStartedAt, turnDurationMs, isMyTurn, playerStatus]);

  // Result sounds + confetti
  useEffect(() => {
    if (playerStatus === 'result' && gameResult && !resultFired.current) {
      resultFired.current = true;
      const { isDraw, winnerId } = gameResult;
      if (isDraw) { sounds.draw(); }
      else if (winnerId === playerId) { sounds.win(); setTimeout(fireConfetti, 300); }
      else { sounds.lose(); }
    }
    if (playerStatus !== 'result') resultFired.current = false;
  }, [playerStatus, gameResult, playerId]);

  // ── Mute button ───────────────────────────────────────────────────────────
  const MuteBtn = (
    <button
      onClick={handleToggleMute}
      className="fixed top-4 right-4 z-30 p-2.5 rounded-xl bg-slate-800/90 border border-slate-700/60 hover:bg-slate-700 transition-colors shadow-lg"
      title={muted ? 'Bật âm thanh' : 'Tắt âm thanh'}
    >
      {muted ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-indigo-400" />}
    </button>
  );

  // ── Leaderboard overlay ──────────────────────────────────────────────────
  const LeaderboardOverlay = showLeaderboard && tournamentState?.leaderboard?.length > 0 && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowLeaderboard(false)}>
      <div className="card w-full max-w-sm max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <Trophy className="w-4 h-4 text-yellow-400" />
          <h3 className="font-bold text-sm flex-1">Bảng xếp hạng</h3>
          <button onClick={() => setShowLeaderboard(false)} className="text-slate-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <ul className="space-y-1.5 overflow-y-auto">
          {tournamentState.leaderboard.map((p, i) => (
            <li key={p.id} className={`flex items-center gap-2 text-xs rounded-lg px-3 py-2 ${
              p.nickname === nickname ? 'bg-indigo-900/50 border border-indigo-700/40' : 'bg-slate-700/30'
            }`}>
              <span className="text-slate-500 w-5 shrink-0 text-center">
                {i < 3 ? ['🥇','🥈','🥉'][i] : `${i+1}.`}
              </span>
              <span className={`truncate flex-1 font-medium ${p.nickname === nickname ? 'text-indigo-300' : 'text-slate-200'}`}>
                {p.nickname}
              </span>
              {p.streak >= 3 && <span className="text-orange-400 shrink-0">🔥</span>}
              {p.rank && <span className="text-slate-500 shrink-0">{p.rank.emoji}</span>}
              <span className="font-bold text-indigo-300 shrink-0 tabular-nums">{p.elo ?? p.score}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );

  // ── Result screen with 10-second countdown ────────────────────────────────
  if (playerStatus === 'result' && gameResult) {
    const { isDraw, winnerId, opponentDisconnected, winningCells, board, eloChange } = gameResult;
    const iWon = winnerId === playerId;

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 flex flex-col items-center justify-center p-4 gap-5">
        {MuteBtn}
        {LeaderboardOverlay}

        {/* Result card */}
        <div className="card w-full max-w-sm text-center animate-bounce-in">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${
            isDraw ? 'bg-yellow-600/30 border-2 border-yellow-500' :
            iWon   ? 'bg-green-600/30 border-2 border-green-500' :
                     'bg-red-600/30 border-2 border-red-500'
          }`}>
            {isDraw ? <Handshake className="w-10 h-10 text-yellow-400" /> :
             iWon   ? <Trophy    className="w-10 h-10 text-green-400" /> :
                      <Skull     className="w-10 h-10 text-red-400" />}
          </div>

          <h2 className={`text-3xl font-extrabold mb-1 ${isDraw ? 'text-yellow-300' : iWon ? 'text-green-300' : 'text-red-400'}`}>
            {isDraw ? 'Hoà!' : iWon ? 'Chiến Thắng!' : 'Thua Rồi!'}
          </h2>

          <p className="text-slate-400 text-sm mb-3">
            {opponentDisconnected ? 'Đối thủ đã ngắt kết nối' :
             isDraw ? 'Hai bên không phân thắng bại' :
             iWon   ? `Bạn đã đánh bại ${currentMatch?.opponentNickname}!` :
                      `${currentMatch?.opponentNickname} đã thắng`}
          </p>

          {/* ELO change */}
          {eloChange !== undefined && (
            <div className="bg-slate-700/50 rounded-xl px-4 py-2 mb-3">
              <span className="text-sm text-slate-400">ELO: </span>
              <span className="font-bold text-white text-lg">{myScore?.elo ?? '—'}</span>
              <span className={`ml-2 font-bold text-base ${eloChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                ({eloChange >= 0 ? '+' : ''}{eloChange})
              </span>
            </div>
          )}

          {/* Current rank and stats */}
          {myScore && (
            <div className="bg-slate-800/60 rounded-xl p-3 mb-4 text-left">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Thứ hạng của bạn
                </span>
                {myRankPos > 0 && (
                  <span className="text-indigo-300 font-bold text-sm">#{myRankPos}</span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <RankBadge rank={myScore.rank} />
                <span className="text-white font-bold text-lg">{myScore.score}<span className="text-slate-400 text-sm font-normal">đ</span></span>
              </div>
              <p className="text-slate-500 text-xs mt-1">
                {myScore.wins}T · {myScore.draws}H · {myScore.losses}B
                {myScore.streak >= 2 && <span className="ml-2 text-orange-400 font-bold">🔥 ×{myScore.streak}</span>}
              </p>
            </div>
          )}

          {/* Buttons + countdown */}
          <button onClick={requestNextMatch} className="btn-primary w-full flex items-center justify-center gap-2 mb-2">
            <ChevronRight className="w-5 h-5" /> Trận tiếp theo
          </button>
          <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
            <Clock className="w-3 h-3" />
            <span>Tự động ghép tiếp sau <span className="text-slate-300 font-bold tabular-nums">{exitCountdown}s</span></span>
          </div>

          {/* Leaderboard button */}
          {tournamentState?.leaderboard?.length > 0 && (
            <button
              onClick={() => setShowLeaderboard(true)}
              className="w-full mt-2 flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-700/40 hover:bg-slate-700/60 rounded-xl py-2 transition-colors"
            >
              <LayoutList className="w-3.5 h-3.5" /> Xem bảng xếp hạng
            </button>
          )}
        </div>

        {/* Final board */}
        {board && (
          <div className="w-full max-w-3xl animate-fade-in opacity-60 hover:opacity-100 transition-opacity">
            <p className="text-center text-xs text-slate-500 mb-2">Trạng thái bàn cờ cuối trận</p>
            {currentMatch?.gameType === 'chess' ? (
              <ChessBoard
                fen={board}
                yourSymbol={currentMatch?.yourSymbol || 'X'}
                isMyTurn={false}
                onMove={() => {}}
                disabled={true}
              />
            ) : (
              <Board
                board={board}
                size={currentMatch?.size || 15}
                gameType={currentMatch?.gameType}
                yourSymbol={currentMatch?.yourSymbol || 'X'}
                isMyTurn={false}
                onCellClick={() => {}}
                disabled={true}
                winningCells={winningCells}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  if (!currentMatch) return null;

  const { opponentNickname, yourSymbol, size, winningCells, gameType } = currentMatch;
  const myStreak       = myScore?.streak || 0;
  const opponentStreak = opponentScore?.streak || 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 flex flex-col items-center p-3 lg:p-5">
      {MuteBtn}
      {LeaderboardOverlay}

      {/* Leaderboard button during game */}
      {tournamentState?.leaderboard?.length > 0 && (
        <button
          onClick={() => setShowLeaderboard(true)}
          className="fixed top-4 left-4 z-30 p-2.5 rounded-xl bg-slate-800/90 border border-slate-700/60 hover:bg-slate-700 transition-colors shadow-lg"
          title="Bảng xếp hạng"
        >
          <LayoutList className="w-4 h-4 text-yellow-400" />
        </button>
      )}

      {/* 3-2-1 Countdown */}
      {showCountdown && <Countdown onDone={hideCountdown} />}

      {/* Opponent reconnecting banner */}
      {opponentReconnecting && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 px-4 py-2.5 bg-orange-900/90 border border-orange-700/60 rounded-xl text-orange-200 text-sm font-medium shadow-xl flex items-center gap-2 animate-fade-in">
          <WifiOff className="w-4 h-4 text-orange-400 shrink-0" />
          {opponentNickname} mất kết nối — đang chờ kết nối lại (20s)...
        </div>
      )}

      {/* Timeout notification toast */}
      {timedOutMsg && !opponentReconnecting && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 px-4 py-2.5 bg-amber-900/90 border border-amber-700/60 rounded-xl text-amber-300 text-sm font-medium shadow-xl animate-fade-in">
          {timedOutMsg}
        </div>
      )}

      {/* Match header */}
      <div className="w-full max-w-3xl mb-3 animate-slide-down">
        <div className="card py-3 px-4">
          <div className="flex items-center justify-between gap-2">

            {/* Me */}
            <div className={`flex items-center gap-2 flex-1 min-w-0 transition-opacity duration-300 ${isMyTurn ? 'opacity-100' : 'opacity-40'}`}>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm shrink-0 shadow-lg
                ${gameType === 'chess'
                  ? yourSymbol === 'X' ? 'bg-gradient-to-br from-slate-100 to-slate-300 text-slate-900 border-2 border-slate-400'
                                       : 'bg-gradient-to-br from-slate-700 to-slate-900 text-white border-2 border-slate-500'
                  : yourSymbol === 'X' ? 'bg-gradient-to-br from-blue-400 to-blue-700 text-white'
                                       : 'bg-gradient-to-br from-red-400 to-red-700 text-white'}`}>
                {gameType === 'chess' ? (yourSymbol === 'X' ? '♔' : '♚') : yourSymbol}
              </div>
              <div className="min-w-0">
                <p className="font-bold text-sm truncate leading-tight">
                  {nickname}
                  {myStreak >= 2 && <span className="ml-1 text-orange-400 text-xs">🔥{myStreak}</span>}
                </p>
                <div className="flex items-center gap-1.5">
                  <RankBadge rank={myScore?.rank} />
                  {myRankPos > 0 && <span className="text-slate-500 text-[10px]">#{myRankPos}</span>}
                </div>
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
                ${gameType === 'chess'
                  ? yourSymbol === 'X' ? 'bg-gradient-to-br from-slate-700 to-slate-900 text-white border-2 border-slate-500'
                                       : 'bg-gradient-to-br from-slate-100 to-slate-300 text-slate-900 border-2 border-slate-400'
                  : yourSymbol === 'X' ? 'bg-gradient-to-br from-red-400 to-red-700 text-white'
                                       : 'bg-gradient-to-br from-blue-400 to-blue-700 text-white'}`}>
                {gameType === 'chess' ? (yourSymbol === 'X' ? '♚' : '♔') : (yourSymbol === 'X' ? 'O' : 'X')}
              </div>
              <div className="min-w-0 text-right">
                <p className="font-bold text-sm truncate leading-tight">
                  {opponentStreak >= 2 && <span className="mr-1 text-orange-400 text-xs">🔥{opponentStreak}</span>}
                  {opponentNickname}
                </p>
                <div className="flex items-center gap-1.5 justify-end">
                  {opponentRankPos > 0 && <span className="text-slate-500 text-[10px]">#{opponentRankPos}</span>}
                  <RankBadge rank={opponentScore?.rank} />
                </div>
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
        {currentMatch?.gameType === 'chess' ? (
          <ChessBoard
            fen={board}
            yourSymbol={yourSymbol}
            isMyTurn={isMyTurn && !showCountdown}
            onMove={handleChessMove}
            disabled={playerStatus !== 'playing' || showCountdown}
          />
        ) : (
          <Board
            board={board}
            size={size}
            gameType={currentMatch?.gameType}
            yourSymbol={yourSymbol}
            isMyTurn={isMyTurn && !showCountdown}
            onCellClick={handleCellClick}
            disabled={playerStatus !== 'playing' || showCountdown}
            winningCells={winningCells}
          />
        )}
      </div>

      {/* Bottom bar */}
      <div className="w-full max-w-3xl mt-3 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {isMyTurn
            ? <span className="text-indigo-300 font-medium animate-pulse-fast">
                {gameType === 'chess' ? 'Đến lượt bạn — hãy di chuyển quân cờ!' : 'Đến lượt bạn — hãy chọn ô để đánh!'}
              </span>
            : `Đang chờ ${opponentNickname} ${gameType === 'chess' ? 'suy nghĩ' : 'đánh'}...`}
        </p>
        <div className="relative shrink-0">
          <EmojiReactions onReact={sendReaction} incoming={incomingReaction} />
        </div>
      </div>
    </div>
  );
}
