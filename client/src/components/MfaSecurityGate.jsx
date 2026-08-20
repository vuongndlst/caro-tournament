import React, { useState } from 'react';
import { ShieldCheck, Smartphone, LogOut, KeyRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

function Shell({ children, title, description, onLogout }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
      <div className="card w-full max-w-md">
        <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 flex items-center justify-center mb-4">
          <ShieldCheck className="w-6 h-6 text-indigo-300" />
        </div>
        <h1 className="text-xl font-extrabold">{title}</h1>
        <p className="text-sm text-slate-400 mt-2">{description}</p>
        {children}
        <button onClick={onLogout} className="mt-4 text-xs text-slate-500 hover:text-red-300 flex items-center gap-1 mx-auto">
          <LogOut className="w-3.5 h-3.5" /> Đăng xuất
        </button>
      </div>
    </div>
  );
}

export function MfaEnrollment() {
  const { beginMfaEnrollment, verifyMfa, signOut } = useAuth();
  const [enrollment, setEnrollment] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function begin() {
    setLoading(true); setError('');
    try { setEnrollment(await beginMfaEnrollment()); }
    catch (err) { setError(err.message || 'Không khởi tạo được MFA.'); }
    finally { setLoading(false); }
  }

  async function verify(event) {
    event.preventDefault();
    setLoading(true); setError('');
    try { await verifyMfa(enrollment.id, code); }
    catch (err) { setError(err.message || 'Mã xác minh không đúng.'); }
    finally { setLoading(false); }
  }

  return (
    <Shell title="Thiết lập bảo mật hai lớp" description="Quản trị viên và giáo viên phải dùng ứng dụng Authenticator trước khi quản lý giải đấu." onLogout={signOut}>
      {error && <div className="mt-4 rounded-xl bg-red-900/30 border border-red-700/40 px-3 py-2 text-sm text-red-300">{error}</div>}
      {!enrollment ? (
        <button onClick={begin} disabled={loading} className="btn-primary w-full mt-5 flex items-center justify-center gap-2">
          <Smartphone className="w-4 h-4" /> {loading ? 'Đang tạo mã...' : 'Bắt đầu thiết lập MFA'}
        </button>
      ) : (
        <form onSubmit={verify} className="mt-5 space-y-3">
          <div className="bg-white rounded-2xl p-3 w-fit mx-auto">
            <img src={enrollment.totp?.qr_code} alt="QR thiết lập MFA" className="w-48 h-48" />
          </div>
          <p className="text-xs text-center text-slate-400">Quét QR bằng Google Authenticator, Microsoft Authenticator hoặc ứng dụng TOTP tương thích.</p>
          <details className="text-xs text-slate-500 text-center">
            <summary className="cursor-pointer hover:text-slate-300">Không quét được QR?</summary>
            <code className="block mt-2 p-2 rounded-lg bg-slate-900 break-all select-all">{enrollment.totp?.secret}</code>
          </details>
          <input className="input-field text-center tracking-[0.4em] text-lg" inputMode="numeric" pattern="[0-9]{6}"
            maxLength={6} placeholder="000000" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required />
          <button disabled={loading || code.length !== 6} className="btn-primary w-full flex items-center justify-center gap-2">
            <ShieldCheck className="w-4 h-4" /> {loading ? 'Đang xác minh...' : 'Bật MFA'}
          </button>
        </form>
      )}
    </Shell>
  );
}

export function MfaChallenge() {
  const { mfa, verifyMfa, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function verify(event) {
    event.preventDefault(); setLoading(true); setError('');
    try { await verifyMfa(mfa.factors[0].id, code); }
    catch (err) { setError(err.message || 'Mã xác minh không đúng.'); }
    finally { setLoading(false); }
  }

  return (
    <Shell title="Xác minh đăng nhập" description="Nhập mã 6 số đang hiển thị trong ứng dụng Authenticator." onLogout={signOut}>
      {error && <div className="mt-4 rounded-xl bg-red-900/30 border border-red-700/40 px-3 py-2 text-sm text-red-300">{error}</div>}
      <form onSubmit={verify} className="mt-5 space-y-3">
        <input className="input-field text-center tracking-[0.4em] text-lg" inputMode="numeric" pattern="[0-9]{6}"
          maxLength={6} placeholder="000000" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required autoFocus />
        <button disabled={loading || code.length !== 6} className="btn-primary w-full flex items-center justify-center gap-2">
          <KeyRound className="w-4 h-4" /> {loading ? 'Đang xác minh...' : 'Xác minh MFA'}
        </button>
      </form>
    </Shell>
  );
}
