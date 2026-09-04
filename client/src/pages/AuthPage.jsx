import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { User, Mail, Lock, LogIn, UserPlus, ArrowRight } from 'lucide-react';
import { usingSupabaseGameBackend } from '../socket';

export default function AuthPage({ onSkip }) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode]     = useState('login'); // 'login' | 'register'
  const [email, setEmail]   = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [requestTeacher, setRequestTeacher] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [info, setInfo]         = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setInfo('');
    setLoading(true);
    try {
      if (mode === 'register') {
        if (!nickname.trim()) { setError('Vui lòng nhập biệt danh.'); setLoading(false); return; }
        if (password.length < 10 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
          setError('Mật khẩu cần ít nhất 10 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.');
          setLoading(false); return;
        }
        const data = await signUp(email.trim(), password, nickname.trim(), requestTeacher);
        const teacherNote = requestTeacher
          ? ' Đề nghị làm giáo viên đã được gửi, chờ quản trị viên duyệt.'
          : '';
        if (data?.session) {
          setInfo(`Đăng ký thành công!${teacherNote}`);
          if (!requestTeacher) onSkip?.();
        } else {
          setInfo(`Đăng ký thành công! Kiểm tra email để xác nhận, sau đó đăng nhập.${teacherNote}`);
          setMode('login');
        }
      } else {
        await signIn(email.trim(), password);
        onSkip?.();
      }
    } catch (err) {
      setError(err.message || 'Có lỗi xảy ra, thử lại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-4">
      <div className="card w-full max-w-sm animate-fade-in">

        {/* Logo */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-900/60">
            <span className="text-xl">♟</span>
          </div>
          <div>
            <h1 className="text-lg font-extrabold leading-tight">LSTS CaroTourney</h1>
            <p className="text-xs text-slate-400">
              {mode === 'login' ? 'Đăng nhập để tham gia giải đấu' : 'Tạo tài khoản học sinh'}
            </p>
          </div>
        </div>

        {/* Tab switch */}
        <div className="flex rounded-xl overflow-hidden border border-slate-700/50 mb-5">
          <button
            type="button"
            onClick={() => { setMode('login'); setError(''); setInfo(''); }}
            className={`flex-1 py-2 text-sm font-semibold transition-colors ${
              mode === 'login' ? 'bg-indigo-600 text-white' : 'bg-slate-800/50 text-slate-400 hover:text-slate-200'
            }`}
          >
            <LogIn className="w-3.5 h-3.5 inline mr-1.5" />Đăng nhập
          </button>
          <button
            type="button"
            onClick={() => { setMode('register'); setError(''); setInfo(''); }}
            className={`flex-1 py-2 text-sm font-semibold transition-colors ${
              mode === 'register' ? 'bg-indigo-600 text-white' : 'bg-slate-800/50 text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5 inline mr-1.5" />Đăng ký
          </button>
        </div>

        {error && <p className="text-red-400 text-sm mb-4 bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}
        {info  && <p className="text-green-400 text-sm mb-4 bg-green-900/30 rounded-lg px-3 py-2">{info}</p>}

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" /> Biệt danh
              </label>
              <input
                type="text"
                className="input-field"
                placeholder="Tên hiển thị trong trận đấu"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                maxLength={20}
                autoFocus={mode === 'register'}
                required
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" /> Email
            </label>
            <input
              type="email"
              className="input-field"
              placeholder="email@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoFocus={mode === 'login'}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" /> Mật khẩu
            </label>
            <input
              type="password"
              className="input-field"
              placeholder={mode === 'register' ? 'Ít nhất 10 ký tự' : '••••••••'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              minLength={mode === 'register' ? 10 : 6}
              required
            />
          </div>

          {mode === 'register' && (
            <label className="flex items-start gap-2.5 rounded-xl bg-slate-800/50 border border-slate-700/50 px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 w-4 h-4 accent-indigo-500 shrink-0"
                checked={requestTeacher}
                onChange={e => setRequestTeacher(e.target.checked)}
              />
              <span className="text-xs text-slate-300 leading-relaxed">
                Tôi là giáo viên
                <span className="block text-slate-500 mt-0.5">
                  Tài khoản vẫn vào quyền học sinh cho tới khi quản trị viên duyệt.
                </span>
              </span>
            </label>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full flex items-center justify-center gap-2 mt-2"
          >
            {loading
              ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : mode === 'login'
                ? <><LogIn className="w-4 h-4" /> Đăng nhập</>
                : <><UserPlus className="w-4 h-4" /> Tạo tài khoản</>
            }
          </button>
        </form>

        {/* Skip auth option */}
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="mt-4 w-full text-center text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center justify-center gap-1"
          >
            {usingSupabaseGameBackend ? 'Quay lại' : 'Tiếp tục không đăng nhập'} <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-600 text-center max-w-xs">
        Đăng nhập để lưu ELO và lịch sử trận đấu qua các giải.
      </p>
    </div>
  );
}
