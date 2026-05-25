import React, { useState, useEffect, useCallback } from 'react';
import Board from './Board';
import { socket } from '../socket';
import { Eye, X, User } from 'lucide-react';

/**
 * Modal overlay that lets a waiting player watch an active match live.
 *
 * Props:
 *   matchId   — the match to spectate
 *   roomCode  — room code (used to fetch initial state)
 *   onClose   — callback to close the spectator view
 */
export default function SpectatorView({ matchId, roomCode, onClose }) {
  const [matchData, setMatchData]   = useState(null);
  const [board, setBoard]           = useState(null);
  const [currentTurn, setTurn]      = useState(null);
  const [winningCells, setWinCells] = useState(null);
  const [ended, setEnded]           = useState(false);
  const [error, setError]           = useState('');

  useEffect(() => {
    // Subscribe to the match
    socket.emit('spectate_match', { matchId, roomCode }, (res) => {
      if (!res.success) {
        setError(res.message || 'Không thể xem trận này');
        return;
      }
      setMatchData(res.match);
      setBoard(res.match.board);
      setTurn(res.match.currentTurn);
      if (res.match.status === 'finished') setEnded(true);
    });

    const handleMove = (data) => {
      if (data.matchId !== matchId) return;
      setBoard(data.board);
      setTurn(data.currentTurn);
    };

    const handleOver = (data) => {
      if (data.matchId !== matchId) return;
      setBoard(data.board || null);
      setWinCells(data.winningCells || null);
      setEnded(true);
    };

    socket.on('move_made', handleMove);
    socket.on('game_over', handleOver);

    return () => {
      socket.off('move_made', handleMove);
      socket.off('game_over', handleOver);
      socket.emit('stop_spectating', { matchId });
    };
  }, [matchId, roomCode]);

  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4">
      <div className="bg-slate-800 border border-slate-700/60 rounded-2xl w-full max-w-3xl shadow-2xl animate-fade-in overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/60 bg-slate-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-purple-600/30 rounded-lg flex items-center justify-center">
              <Eye className="w-4 h-4 text-purple-400" />
            </div>
            {matchData ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-bold text-blue-300">{matchData.p1Nickname}</span>
                <span className="text-slate-500 font-bold text-xs">VS</span>
                <span className="font-bold text-red-300">{matchData.p2Nickname}</span>
                {ended && <span className="badge bg-slate-600/60 text-slate-400 text-xs ml-1">Đã kết thúc</span>}
              </div>
            ) : (
              <span className="text-sm text-slate-400">Đang tải trận...</span>
            )}
          </div>

          <button
            onClick={handleClose}
            className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors"
            title="Đóng"
          >
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Turn indicator */}
        {matchData && !ended && currentTurn && (
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/40 text-xs text-slate-400">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            Lượt của:{' '}
            <span className="font-semibold text-white">
              {currentTurn === matchData.p1Id ? matchData.p1Nickname : matchData.p2Nickname}
            </span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="p-6 text-center text-red-400 text-sm">{error}</div>
        )}

        {/* Board */}
        {board && (
          <div className="p-3">
            <Board
              board={board}
              size={matchData?.size || 15}
              yourSymbol="X"
              isMyTurn={false}
              onCellClick={() => {}}
              disabled={true}
              winningCells={winningCells}
            />
          </div>
        )}

        {/* Loading */}
        {!board && !error && (
          <div className="p-10 text-center text-slate-500 text-sm">
            <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin mx-auto mb-3" />
            Đang tải bàn cờ...
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-slate-700/40 flex items-center gap-2 text-xs text-slate-500 bg-slate-900/30">
          <Eye className="w-3 h-3" />
          Chế độ khán giả — không thể đánh cờ
        </div>
      </div>
    </div>
  );
}
