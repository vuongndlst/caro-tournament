import React from 'react';
import { LockKeyhole } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import ForcePasswordChange from './ForcePasswordChange';
import { MfaChallenge, MfaEnrollment } from './MfaSecurityGate';

export default function AccountSecurityGate({ children }) {
  const { user, profile, mfa, loading, signOut } = useAuth();
  if (loading || (user && mfa.loading)) {
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center"><div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-400 rounded-full animate-spin" /></div>;
  }
  if (!user || !profile) return children;
  if (profile.is_locked) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="card max-w-sm text-center">
          <LockKeyhole className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <h1 className="font-bold text-xl">Tài khoản đã bị khóa</h1>
          <p className="text-sm text-slate-400 mt-2">Vui lòng liên hệ quản trị viên hoặc giáo viên phụ trách.</p>
          <button onClick={signOut} className="btn-primary w-full mt-5">Đăng xuất</button>
        </div>
      </div>
    );
  }
  if (profile.must_change_password) return <ForcePasswordChange />;

  const privileged = ['teacher', 'admin'].includes(profile.role);
  if (privileged && mfa.factors.length === 0) return <MfaEnrollment />;
  if (mfa.nextLevel === 'aal2' && mfa.currentLevel !== 'aal2') return <MfaChallenge />;
  return children;
}
