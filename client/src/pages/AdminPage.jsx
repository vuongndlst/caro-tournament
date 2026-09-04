import React, { useState, useEffect } from 'react';
import { useGame } from '../context/GameContext';
import AdminLogin from '../components/AdminLogin';
import AdminDashboard from '../components/AdminDashboard';
import { Shield, Plus, ArrowLeft, Pencil, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { socket, usingSupabaseGameBackend } from '../socket';

export default function AdminPage() {
  const { role, createTournament, connected, roomCode } = useGame();
  const { user, profile, loading: authLoading, signOut } = useAuth();

  const [adminToken,    setAdminToken]    = useState(() => localStorage.getItem('caro_admin_token') || '');
  const [adminUsername, setAdminUsername] = useState(() => localStorage.getItem('caro_admin_username') || '');
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');
  const [tournamentName, setTournamentName] = useState('');
  const [gameType, setGameType] = useState('caro');
  const [format, setFormat] = useState('auto');
  const [totalRounds, setTotalRounds] = useState(5);
  const [isRated, setIsRated] = useState(true);
  // Chess time controls
  const [chessPreset, setChessPreset] = useState('5+3');
  const [chessCustomMin, setChessCustomMin] = useState(5);
  const [chessCustomInc, setChessCustomInc] = useState(3);
  const effectiveUsername = usingSupabaseGameBackend ? (profile?.nickname || user?.email || '') : adminUsername;
  const effectiveToken = usingSupabaseGameBackend ? '' : adminToken;
  const canManageTournaments = ['teacher', 'admin'].includes(profile?.role);

  const CHESS_PRESETS = {
    '3+2':   { label: '⚡ Chớp · 3+2', initialMs: 3 * 60 * 1000, incMs: 2_000, mode: 'blitz' },
    '5+3':   { label: '🏃 Nhanh · 5+3', initialMs: 5 * 60 * 1000, incMs: 3_000, mode: 'rapid' },
    '10+0':  { label: '🏃 Nhanh · 10+0', initialMs: 10 * 60 * 1000, incMs: 0, mode: 'rapid' },
    '15+10': { label: '🏆 Chuẩn · 15+10', initialMs: 15 * 60 * 1000, incMs: 10_000, mode: 'standard' },
    'custom': { label: '⚙️ Tuỳ chỉnh', initialMs: null, incMs: null, mode: 'custom' },
  };

  // Thụy Sĩ: đấu theo vòng, hết vòng cuối lấy người dẫn đầu làm vô địch.
  const formatOpts = () => (format === 'swiss' ? { format, totalRounds } : { format: 'auto' });

  const getChessOpts = () => {
    if (gameType !== 'chess') return { isRated, ...formatOpts() };
    if (chessPreset === 'custom') {
      return {
        chessInitialMs: Math.max(1, chessCustomMin) * 60 * 1000,
        chessIncMs: Math.max(0, chessCustomInc) * 1000,
        chessMode: 'custom', isRated, ...formatOpts(),
      };
    }
    const p = CHESS_PRESETS[chessPreset];
    return { chessInitialMs: p.initialMs, chessIncMs: p.incMs, chessMode: p.mode, isRated, ...formatOpts() };
  };

  // If token exists, verify it on mount
  useEffect(() => {
    if (usingSupabaseGameBackend) return;
    if (!adminToken) return;
    const SERVER = import.meta.env.VITE_SERVER_URL || '';
    fetch(`${SERVER}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    })
      .then(r => r.json())
      .then(data => {
        if (!data.success) {
          localStorage.removeItem('caro_admin_token');
          localStorage.removeItem('caro_admin_username');
          setAdminToken('');
          setAdminUsername('');
        }
      })
      .catch(() => {}); // ignore network errors during verification
  }, [adminToken]);

  const handleLoginSuccess = (token, username) => {
    if (usingSupabaseGameBackend) return;
    setAdminToken(token);
    setAdminUsername(username);
    // Update socket auth so future events carry the new token
    socket.auth = { token };
    if (!socket.connected) socket.connect();
  };

  const handleLogout = () => {
    if (usingSupabaseGameBackend) signOut();
    localStorage.removeItem('caro_admin_token');
    localStorage.removeItem('caro_admin_username');
    setAdminToken('');
    setAdminUsername('');
  };

  const handleCreate = () => {
    setLoading(true);
    setError('');
    createTournament(effectiveToken, tournamentName.trim(), gameType, getChessOpts(), (res) => {
      setLoading(false);
      if (!res.success) setError(res.message || 'Không thể tạo giải đấu, thử lại!');
    });
  };

  if (usingSupabaseGameBackend && authLoading) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center"><div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin" /></div>;
  }

  if (usingSupabaseGameBackend && user && !canManageTournaments) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="card max-w-sm text-center">
          <Shield className="w-10 h-10 text-amber-400 mx-auto mb-3" />
          <h1 className="font-bold text-lg">Tài khoản chưa có quyền giáo viên</h1>
          <p className="text-sm text-slate-400 mt-2">Tài khoản cần có vai trò giáo viên hoặc quản trị viên.</p>
          <button onClick={handleLogout} className="btn-primary mt-4 w-full">Đăng xuất</button>
        </div>
      </div>
    );
  }

  const isLoggedIn = usingSupabaseGameBackend ? !!user && canManageTournaments : !!adminToken;
  if (!isLoggedIn) return <AdminLogin onSuccess={handleLoginSuccess} supabaseMode={usingSupabaseGameBackend} />;

  // Already created a tournament → show dashboard
  if (role === 'admin' && roomCode) return <AdminDashboard onLogout={handleLogout} adminUsername={effectiveUsername} />;

  // Logged in but no tournament yet → create form
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4">
      <div className="card w-full max-w-md animate-fade-in">
        <div className="flex items-center justify-between mb-1">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-900/60">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Đăng nhập với tư cách</p>
            <p className="text-sm font-semibold text-indigo-300">{effectiveUsername}</p>
          </div>
        </div>

        <h1 className="text-xl font-extrabold mt-4 mb-1">Tạo giải đấu mới</h1>
        <p className="text-slate-400 text-sm mb-5">Đặt tên cho giải đấu của lớp học</p>

        {error && (
          <p className="text-red-400 text-sm mb-4 bg-red-900/30 rounded-lg px-3 py-2">{error}</p>
        )}

        {/* Tournament name input */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
            <Pencil className="w-3.5 h-3.5" /> Tên giải đấu
          </label>
          <input
            type="text"
            className="input-field"
            placeholder={`Giải Caro lớp 10A – ${new Date().toLocaleDateString('vi-VN')}`}
            value={tournamentName}
            onChange={e => setTournamentName(e.target.value)}
            maxLength={60}
            autoFocus
          />
          <p className="text-xs text-slate-500 mt-1">Để trống để dùng tên mặc định theo ngày.</p>
        </div>

        {/* Game Type select */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-300 mb-1.5">
            Loại trò chơi
          </label>
          <select
            className="input-field appearance-none cursor-pointer bg-slate-800"
            value={gameType}
            onChange={e => setGameType(e.target.value)}
          >
            <option value="caro">Cờ Caro (15x15)</option>
            <option value="tictactoe">Tic Tac Toe (3x3)</option>
            <option value="chess">Cờ Vua (8x8)</option>
          </select>
        </div>

        {/* Thể thức */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-300 mb-1.5">Thể thức</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { key: 'auto',  ten: 'Ghép liên tục', mo: 'Đánh xong là ghép trận mới, không giới hạn' },
              { key: 'swiss', ten: 'Thi đấu có vòng', mo: 'Đấu theo vòng, cuối giải có nhà vô địch' },
            ].map(o => (
              <button key={o.key} type="button" onClick={() => setFormat(o.key)}
                className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${
                  format === o.key ? 'bg-indigo-600/25 border-indigo-500' : 'bg-slate-800/60 border-slate-700 hover:bg-slate-800'}`}>
                <p className="text-sm font-semibold">{o.ten}</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-snug">{o.mo}</p>
              </button>
            ))}
          </div>
          {format === 'swiss' && (
            <div className="mt-3 bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
              <label className="block text-sm font-medium text-slate-300 mb-2">Số vòng đấu</label>
              <div className="flex gap-2 flex-wrap">
                {[3, 4, 5, 6, 7].map(n => (
                  <button key={n} type="button" onClick={() => setTotalRounds(n)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                      totalRounds === n ? 'bg-indigo-600 border-indigo-500' : 'bg-slate-700/50 border-slate-600/50 text-slate-300'}`}>
                    {n} vòng
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-2 leading-snug">
                Mỗi vòng cả lớp đấu cùng lúc, ghép em cùng điểm với nhau và tránh gặp lại.
                Lớp 32 em nên chọn 5 vòng; ước tính khoảng {totalRounds * 6} phút.
              </p>
            </div>
          )}
        </div>

        <button type="button" onClick={() => setIsRated(value => !value)}
          className={`mb-4 w-full flex items-center justify-between rounded-xl border px-3 py-2.5 text-left transition-colors ${isRated ? 'bg-emerald-900/25 border-emerald-700/40' : 'bg-slate-800/60 border-slate-700'}`}>
          <div><p className="text-sm font-semibold">{isRated ? 'Đấu xếp hạng' : 'Đấu thường'}</p><p className="text-xs text-slate-500">{isRated ? 'Kết quả cập nhật ELO học kỳ và toàn thời gian' : 'Không thay đổi ELO'}</p></div>
          <span className={`w-10 h-5 rounded-full p-0.5 ${isRated ? 'bg-emerald-500' : 'bg-slate-600'}`}><span className={`block w-4 h-4 bg-white rounded-full transition-transform ${isRated ? 'translate-x-5' : ''}`} /></span>
        </button>

        {/* Chess time controls */}
        {gameType === 'chess' && (
          <div className="mb-4 bg-slate-800/60 rounded-xl p-3 border border-slate-700/50">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              ⏱ Thời gian cờ vua
            </label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {Object.entries(CHESS_PRESETS).map(([key, { label }]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setChessPreset(key)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    chessPreset === key
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-700/50 border-slate-600/50 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {chessPreset === 'custom' && (
              <div className="flex gap-3 mt-2">
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">Giờ mỗi người (phút)</label>
                  <input
                    type="number" min="1" max="60"
                    className="input-field text-sm py-1.5"
                    value={chessCustomMin}
                    onChange={e => setChessCustomMin(Number(e.target.value))}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-slate-400 mb-1">Cộng mỗi nước (giây)</label>
                  <input
                    type="number" min="0" max="60"
                    className="input-field text-sm py-1.5"
                    value={chessCustomInc}
                    onChange={e => setChessCustomInc(Number(e.target.value))}
                  />
                </div>
              </div>
            )}
            {chessPreset !== 'custom' && (
              <p className="text-xs text-slate-500 mt-1">
                Mỗi người {CHESS_PRESETS[chessPreset].initialMs / 60000} phút
                {CHESS_PRESETS[chessPreset].incMs > 0 ? `, +${CHESS_PRESETS[chessPreset].incMs/1000}s mỗi nước` : ''}
              </p>
            )}
          </div>
        )}

        <button
          onClick={handleCreate}
          disabled={loading || !connected}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {loading
            ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <Plus className="w-5 h-5" />}
          {loading ? 'Đang tạo...' : 'Bắt đầu tạo giải đấu'}
        </button>

        {!connected && (
          <p className="text-xs text-slate-500 mt-3 text-center">
            <span className="w-2 h-2 bg-red-500 rounded-full inline-block mr-1 animate-pulse" />
            Đang kết nối server...
          </p>
        )}
      </div>

      <div className="flex gap-4 mt-5 text-sm text-slate-500">
        <Link to="/" className="hover:text-slate-300 flex items-center gap-1 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Trang học sinh
        </Link>
        {usingSupabaseGameBackend && profile?.role === 'admin' && (
          <><span>·</span><Link to="/admin/accounts" className="hover:text-indigo-300 flex items-center gap-1"><Settings className="w-4 h-4" /> Quản trị hệ thống</Link></>
        )}
        <span>·</span>
        <button onClick={handleLogout} className="hover:text-red-400 transition-colors">Đăng xuất</button>
      </div>
    </div>
  );
}
