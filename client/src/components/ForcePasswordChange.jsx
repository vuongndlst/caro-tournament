import React, { useState } from 'react';
import { KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function ForcePasswordChange() {
  const { changePassword, signOut, profile } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (newPassword.length < 10) return setError('Mật khẩu mới phải có ít nhất 10 ký tự.');
    if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      return setError('Mật khẩu cần chữ hoa, chữ thường, số và ký tự đặc biệt.');
    }
    if (newPassword !== confirmPassword) return setError('Hai lần nhập mật khẩu mới chưa khớp.');
    if (newPassword === currentPassword) return setError('Mật khẩu mới phải khác mật khẩu tạm.');
    setLoading(true);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (err) {
      setError(err.message || 'Không đổi được mật khẩu.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
      <div className="card w-full max-w-md">
        <div className="w-12 h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center mb-4">
          <KeyRound className="w-6 h-6 text-amber-300" />
        </div>
        <h1 className="text-xl font-extrabold">Đổi mật khẩu lần đầu</h1>
        <p className="text-sm text-slate-400 mt-2">
          Xin chào <span className="text-indigo-300 font-semibold">{profile?.nickname}</span>. Mật khẩu hiện tại là mật khẩu tạm và phải được thay trước khi sử dụng hệ thống.
        </p>

        {error && <div className="mt-4 rounded-xl bg-red-900/30 border border-red-700/40 px-3 py-2 text-sm text-red-300">{error}</div>}

        <form onSubmit={submit} className="space-y-3 mt-5">
          <input type="password" className="input-field" placeholder="Mật khẩu tạm hiện tại"
            value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required autoFocus />
          <input type="password" className="input-field" placeholder="Mật khẩu mới"
            value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={10} required />
          <input type="password" className="input-field" placeholder="Nhập lại mật khẩu mới"
            value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={10} required />
          <div className="rounded-xl bg-slate-800/60 px-3 py-2 text-xs text-slate-400 flex gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            Ít nhất 10 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt.
          </div>
          <button disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
            {loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <KeyRound className="w-4 h-4" />}
            {loading ? 'Đang cập nhật...' : 'Đổi mật khẩu'}
          </button>
        </form>
        <button onClick={signOut} className="mt-4 text-xs text-slate-500 hover:text-red-300 flex items-center gap-1 mx-auto">
          <LogOut className="w-3.5 h-3.5" /> Đăng xuất
        </button>
      </div>
    </div>
  );
}
