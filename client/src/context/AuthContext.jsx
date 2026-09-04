import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getPublicBaseUrl } from '../utils/urls';

const AuthContext = createContext(null);
const EMPTY_MFA = { loading: false, currentLevel: null, nextLevel: null, factors: [] };

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [profile, setProfile] = useState(null);
  const [ratings, setRatings] = useState({});
  const [mfa, setMfa]         = useState({ ...EMPTY_MFA, loading: true });
  const [loading, setLoading] = useState(true);

  const refreshMfa = useCallback(async () => {
    if (!supabase) { setMfa(EMPTY_MFA); return EMPTY_MFA; }
    const [{ data: assurance, error: assuranceError }, { data: factorData, error: factorError }] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
    if (assuranceError) throw assuranceError;
    if (factorError) throw factorError;
    const factors = [...(factorData?.totp || []), ...(factorData?.phone || [])]
      .filter(factor => factor.status === 'verified');
    const value = {
      loading: false,
      currentLevel: assurance?.currentLevel || 'aal1',
      nextLevel: assurance?.nextLevel || 'aal1',
      factors,
    };
    setMfa(value);
    return value;
  }, []);

  const loadProfile = useCallback(async (userId) => {
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { data, error } = await supabase
          .from('profiles')
          .select('id,nickname,role,elo,wins,losses,draws,streak,must_change_password,password_reset_at,is_locked,mfa_required,created_at')
          .eq('id', userId)
          .maybeSingle();
        if (data) {
          setProfile(data);
          const [{ data: ratingRows, error: ratingsError }] = await Promise.all([
            supabase.from('profile_game_ratings').select('game_type,elo,rated_games,wins,draws,losses,streak'),
            refreshMfa(),
          ]);
          if (ratingsError) console.warn('Không tải được ELO theo game:', ratingsError.message);
          setRatings(Object.fromEntries((ratingRows || []).map(row => [row.game_type, row])));
          return data;
        }
        if (error) throw error;
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
      setProfile(null);
      setRatings({});
      return null;
    } catch (error) {
      console.error('Không tải được hồ sơ Supabase:', error);
      setProfile(null);
      setMfa(EMPTY_MFA);
      return null;
    } finally {
      setLoading(false);
    }
  }, [refreshMfa]);

  useEffect(() => {
    if (!supabase) { setLoading(false); setMfa(EMPTY_MFA); return undefined; }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id);
      else { setLoading(false); setMfa(EMPTY_MFA); }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) { setLoading(true); loadProfile(session.user.id); }
      else {
        setProfile(null); setRatings({}); setMfa(EMPTY_MFA); setLoading(false);
      }
    });
    return () => subscription.unsubscribe();
  }, [loadProfile]);

  // requestTeacher chỉ tạo một ĐỀ NGHỊ chờ admin duyệt — tài khoản vẫn vào
  // quyền học sinh cho tới khi được duyệt ở trang quản trị.
  async function signUp(email, password, nickname, requestTeacher = false) {
    if (!supabase) throw new Error('Supabase chưa được cấu hình.');
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        data: requestTeacher ? { nickname, requested_role: 'teacher' } : { nickname },
        emailRedirectTo: getPublicBaseUrl(),
      },
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    if (!supabase) throw new Error('Supabase chưa được cấu hình.');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
  }

  async function getToken() {
    if (!supabase) return null;
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  async function changePassword(currentPassword, newPassword) {
    const { data: current, error: userError } = await supabase.auth.getUser();
    if (userError || !current.user?.email) throw userError || new Error('Không xác định được tài khoản hiện tại.');
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: current.user.email,
      password: currentPassword,
    });
    if (verifyError) throw new Error('Mật khẩu hiện tại không đúng.');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    const { data, error: functionError } = await supabase.functions.invoke('game-api', {
      body: { action: 'complete_password_change' },
    });
    if (functionError || !data?.success) throw functionError || new Error(data?.message || 'Không xác nhận được mật khẩu mới.');
    await loadProfile(user.id);
  }

  async function beginMfaEnrollment() {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `LSTS Caro Tourney · ${profile?.nickname || 'Tài khoản'}`,
    });
    if (error) throw error;
    return data;
  }

  async function verifyMfa(factorId, code) {
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) throw challengeError;
    const { data, error } = await supabase.auth.mfa.verify({
      factorId, challengeId: challenge.id, code: code.trim(),
    });
    if (error) throw error;
    await refreshMfa();
    return data;
  }

  async function refreshProfile() {
    if (user?.id) return loadProfile(user.id);
    return null;
  }

  return (
    <AuthContext.Provider value={{
      user, profile, ratings, mfa, loading,
      signUp, signIn, signOut, getToken, changePassword,
      beginMfaEnrollment, verifyMfa, refreshMfa, refreshProfile,
      supabaseEnabled: !!supabase,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
