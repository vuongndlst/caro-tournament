import React, { useEffect, useState } from 'react';
import { socket } from '../socket';
import Board from '../components/Board';
import { Eye, X, Wifi, WifiOff } from 'lucide-react';

export default function SpectatorPage() {
  const params   = new URLSearchParams(window.location.search);
  const matchId  = params.get('matchId');
  const roomCode = params.get('room');

  const [connected, setConnected] = useState(socket.connected);
  const [matchData, setMatchData] = useState(null);
  const [board, setBoard]         = useState(null);
  const [currentTurn, setCurrentTurn] = useState(null);
  const [ended, setEnded]         = useState(false);
  const [error, setError]         = useState('');

  useEffect(() => {
    const onConnect    = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect',    onConnect);
    socket.on('disconnect', onDisconnect);
    if (!socket.connected) socket.connect();

    return () => {
      socket.off('connect',    onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  // Join spectate room once connected
  useEffect(() => {
    if (!connected || !matchId || !roomCode) return;

    socket.emit('spectate_match', { matchId, roomCode }, (res) => {
      if (!res?.success) { setError(res?.message || 'Không thể xem trận này.'); return; }
      setMatchData(res.match);
      setBoard(res.match.board);
      setCurrentTurn(res.match.currentTurn);
      if (res.match.status === 'finished') setEnded(true);
    });

    const onMove = (data) => {
      if (data.matchId !== matchId) return;
      setBoard(data.board);
      setCurrentTurn(data.currentTurn);
    };
    const onOver = (data) => {
      if (data.matchId !== matchId) return;
      setEnded(true);
      if (data.board) setBoard(data.board);
    };
    socket.on('move_made', onMove);
    socket.on('game_over', onOver);

    return () => {
      socket.emit('stop_spectating', { matchId });
      socket.off('move_made', onMove);
      socket.off('game_over', onOver);
    };
  }, [connected, matchId, roomCode]);

  if (!matchId || !roomCode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-400">
        URL không hợp lệ. Thiếu matchId hoặc roomCode.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 flex flex-col items-center p-4 gap-4">
      {/* Header */}
      <div className="w-full max-w-3xl">
        <div className="card py-3 px-4 flex items-center gap-3">
          <Eye className="w-5 h-5 text-purple-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-sm">Đang xem trực tiếp</h1>
            {matchData ? (
              <p className="text-xs text-slate-400">
                <span className="text-blue-300 font-semibold">{matchData.p1Nickname}</span>
                {' '}vs{' '}
                <span className="text-red-300 font-semibold">{matchData.p2Nickname}</span>
                {ended && <span className="ml-2 text-slate-500">(Đã kết thúc)</span>}
              </p>
            ) : (
              <p className="text-xs text-slate-500">Đang tải...</p>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            {connected
              ? <><Wifi className="w-3 h-3 text-green-400" /> Kết nối</>
              : <><WifiOff className="w-3 h-3 text-red-400" /> Mất kết nối</>}
          </div>
          <button onClick={() => window.close()} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="card w-full max-w-3xl text-center text-red-400 py-8">{error}</div>
      )}

      {/* Turn indicator */}
      {matchData && board && !ended && (
        <div className="w-full max-w-3xl">
          <div className="flex gap-3">
            <div className={`flex-1 py-2 rounded-xl text-center text-sm font-semibold transition-all ${
              currentTurn === matchData.p1Id
                ? 'bg-blue-900/50 border border-blue-700/50 text-blue-300'
                : 'bg-slate-800/40 border border-slate-700/30 text-slate-500 opacity-50'}`}>
              {matchData.p1Nickname} (X) {currentTurn === matchData.p1Id && '← lượt'}
            </div>
            <div className={`flex-1 py-2 rounded-xl text-center text-sm font-semibold transition-all ${
              currentTurn === matchData.p2Id
                ? 'bg-red-900/50 border border-red-700/50 text-red-300'
                : 'bg-slate-800/40 border border-slate-700/30 text-slate-500 opacity-50'}`}>
              {currentTurn === matchData.p2Id && 'lượt →'} (O) {matchData.p2Nickname}
            </div>
          </div>
        </div>
      )}

      {/* Ended badge */}
      {ended && (
        <div className="badge bg-slate-700/60 border border-slate-600/40 text-slate-300 text-sm px-4 py-2">
          Trận đấu đã kết thúc
        </div>
      )}

      {/* Board */}
      {board && matchData && (
        <div className="w-full max-w-3xl">
          <Board
            board={board}
            size={matchData.size || 15}
            yourSymbol="X"
            isMyTurn={false}
            onCellClick={() => {}}
            disabled={true}
          />
        </div>
      )}
    </div>
  );
}
