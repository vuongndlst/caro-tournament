import React, { useState, useEffect } from 'react';
import { useGame } from '../context/GameContext';
import AdminLogin from '../components/AdminLogin';
import AdminDashboard from '../components/AdminDashboard';
import { Shield, Plus, ArrowLeft, Pencil } from 'lucide-react';

export default function AdminPage() {
  const { role, createTournament, connected, roomCode } = useGame();

  const [adminToken,    setAdminToken]    = useState(() => localStorage.getItem('caro_admin_token') || '');
  const [adminUsername, setAdminUsername] = useState(() => localStorage.getItem('caro_admin_username') || '');
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState('');
  const [tournamentName, setTournamentName] = useState('');

  // If token exists, verify it on mount
  useEffect(() => {
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
    setAdminToken(token);
    setAdminUsername(username);
    // Update socket auth so future events carry the new token
    import('../socket').then(({ socket }) => {
      socket.auth = { token };
      if (!socket.connected) socket.connect();
    });
  };

  const handleLogout = () => {
    localStorage.removeItem('caro_admin_token');
    localStorage.removeItem('caro_admin_username');
    setAdminToken('');
    setAdminUsername('');
  };

  const handleCreate = () => {
    setLoading(true);
    setError('');
    createTournament(adminToken, tournamentName.trim(), (res) => {
      setLoading(false);
      if (!res.success) setError(res.message || 'Không thể tạo giải đấu, thử lại!');
    });
  };

  // Not logged in → show login screen
  if (!adminToken) return <AdminLogin onSuccess={handleLoginSuccess} />;

  // Already created a tournament → show dashboard
  if (role === 'admin' && roomCode) return <AdminDashboard onLogout={handleLogout} adminUsername={adminUsername} />;

  // Logged in but no tournament yet → create form
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4">
      <div className="card w-full max-w-sm animate-fade-in">
        <div className="flex items-center justify-between mb-1">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-900/60">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Đăng nhập với tư cách</p>
            <p className="text-sm font-semibold text-indigo-300">{adminUsername}</p>
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
        <a href="/" className="hover:text-slate-300 flex items-center gap-1 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Trang học sinh
        </a>
        <span>·</span>
        <button onClick={handleLogout} className="hover:text-red-400 transition-colors">Đăng xuất</button>
      </div>
    </div>
  );
}
