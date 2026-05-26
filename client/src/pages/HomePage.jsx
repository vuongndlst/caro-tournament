import React, { useState } from 'react';
import { useGame } from '../context/GameContext';
import LobbyView from '../components/LobbyView';
import GameView from '../components/GameView';
import RulesModal from '../components/RulesModal';
import Footer from '../components/Footer';
import { Gamepad2, LogIn, AlertCircle, HelpCircle } from 'lucide-react';

export default function HomePage() {
  const { role, playerStatus, joinRoom, error, clearError, connected } = useGame();
  const [nickname, setNickname] = useState('');
  // Pre-fill room code from QR scan: ?room=XXXXXX
  const [roomCode, setRoomCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') || '').toUpperCase();
  });
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [showRules, setShowRules] = useState(false);

  const handleJoin = (e) => {
    e.preventDefault();
    setLocalError('');
    clearError();
    if (!nickname.trim()) return setLocalError('Vui lòng nhập biệt danh!');
    if (!roomCode.trim()) return setLocalError('Vui lòng nhập mã phòng!');

    setLoading(true);
    joinRoom(roomCode.trim().toUpperCase(), nickname.trim(), (res) => {
      setLoading(false);
      if (!res.success) setLocalError(res.message || 'Lỗi kết nối');
    });
  };

  const displayError = localError || error;

  // Player already joined — show lobby or game
  if (role === 'player') {
    if (playerStatus === 'playing' || playerStatus === 'result') return <GameView />;
    return <LobbyView />;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4">
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}

      {/* Logo */}
      <div className="mb-8 text-center animate-fade-in">
        <div className="flex items-center justify-center gap-3 mb-3">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-900/60">
            <Gamepad2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight">
            LSTS Caro<span className="text-indigo-400">Tourney</span>
          </h1>
        </div>
        <p className="text-slate-400 text-sm">Giải đấu Cờ Caro trực tuyến cho lớp học</p>
      </div>

      {/* Join form */}
      <div className="card w-full max-w-sm animate-fade-in">
        <h2 className="text-xl font-bold mb-5 text-center">Tham gia giải đấu</h2>

        <form onSubmit={handleJoin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Biệt danh</label>
            <input
              type="text"
              className="input-field"
              placeholder="Nhập tên của bạn..."
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              maxLength={20}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Mã phòng</label>
            <input
              type="text"
              className="input-field uppercase tracking-widest text-lg font-bold"
              placeholder="VD: ABC123"
              value={roomCode}
              onChange={e => setRoomCode(e.target.value.toUpperCase())}
              maxLength={6}
            />
          </div>

          {displayError && (
            <div className="flex items-center gap-2 bg-red-900/40 border border-red-700 text-red-300 text-sm px-3 py-2.5 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{displayError}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn-primary w-full flex items-center justify-center gap-2 mt-2"
            disabled={loading || !connected}
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <LogIn className="w-5 h-5" />
            )}
            {loading ? 'Đang kết nối...' : 'Vào phòng'}
          </button>
        </form>

        {!connected && (
          <p className="text-center text-xs text-slate-500 mt-3">
            <span className="w-2 h-2 bg-red-500 rounded-full inline-block mr-1 animate-pulse" />
            Đang kết nối server...
          </p>
        )}
      </div>

      <div className="flex items-center gap-4 mt-5 text-sm">
        <p className="text-slate-600">
          Bạn là giáo viên?{' '}
          <a href="/admin" className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
            Tạo giải đấu →
          </a>
        </p>
        <span className="text-slate-700">·</span>
        <button
          onClick={() => setShowRules(true)}
          className="flex items-center gap-1 text-slate-500 hover:text-slate-300 transition-colors"
        >
          <HelpCircle className="w-3.5 h-3.5" /> Luật chơi
        </button>
      </div>

      <Footer className="mt-4" />
    </div>
  );
}
