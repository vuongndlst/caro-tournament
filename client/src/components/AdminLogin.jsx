import React, { useState } from 'react';
import { Shield, LogIn, Eye, EyeOff, AlertCircle } from 'lucide-react';

const SERVER = import.meta.env.VITE_SERVER_URL || '';

export default function AdminLogin({ onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res  = await fetch(`${SERVER}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('caro_admin_token',    data.token);
        localStorage.setItem('caro_admin_username', data.username);
        onSuccess(data.token, data.username);
      } else {
        setError(data.message || 'Đăng nhập thất bại!');
      }
    } catch {
      setError('Không thể kết nối server, thử lại!');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4">
      <div className="card w-full max-w-sm animate-fade-in">
        <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-indigo-900/60">
          <Shield className="w-9 h-9 text-white" />
        </div>

        <h1 className="text-2xl font-extrabold text-center mb-1">Đăng nhập Giáo viên</h1>
        <p className="text-slate-400 text-sm text-center mb-6">
          LSTS Caro<span className="text-indigo-400 font-bold">Tourney</span>
        </p>

        {error && (
          <div className="flex items-center gap-2 bg-red-900/40 border border-red-700 text-red-300 text-sm px-3 py-2.5 rounded-lg mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Tên đăng nhập</label>
            <input
              type="text"
              className="input-field"
              placeholder="giaovien"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">Mật khẩu</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                className="input-field pr-10"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="btn-primary w-full flex items-center justify-center gap-2 mt-2"
          >
            {loading
              ? <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <LogIn className="w-5 h-5" />}
            {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
          </button>
        </form>

        <div className="mt-4 pt-4 border-t border-slate-700/60">
          <p className="text-xs text-slate-500 text-center">
            Tài khoản mặc định: <span className="text-slate-400 font-mono">giaovien</span>{' '}
            / <span className="text-slate-400 font-mono">lsts@2024</span>
          </p>
        </div>
      </div>

      <a href="/" className="mt-5 text-slate-500 hover:text-slate-300 text-sm transition-colors">
        ← Về trang học sinh
      </a>
    </div>
  );
}
