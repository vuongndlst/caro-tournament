import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);  // Supabase user
  const [profile, setProfile] = useState(null);  // profiles row
  const [ratings, setRatings] = useState({});    // independent rating per game type
  const [loading, setLoading] = useState(true);

  // Load session on mount
  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id);
      else setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) { setLoading(true); loadProfile(session.user.id); }
      else { setProfile(null); setRatings({}); setLoading(false); }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId) {
    try {
      // The auth trigger and the browser session can complete a few milliseconds apart.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { data, error } = await supabase
          .from('profiles')
          .select('id,nickname,role,elo,wins,losses,draws,streak,created_at')
          .eq('id', userId)
          .maybeSingle();
        if (data) {
          setProfile(data);
          const { data: ratingRows, error: ratingsError } = await supabase
            .from('profile_game_ratings')
            .select('game_type,elo,wins,draws,losses,streak');
          if (ratingsError) console.warn('Không tải được ELO theo game:', ratingsError.message);
          setRatings(Object.fromEntries((ratingRows || []).map(row => [row.game_type, row])));
          return;
        }
        if (error) throw error;
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
      setProfile(null);
      setRatings({});
    } catch (error) {
      console.error('Không tải được hồ sơ Supabase:', error);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }

  async function signUp(email, password, nickname) {
    if (!supabase) throw new Error('Supabase chưa được cấu hình.');
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        data: { nickname },
        emailRedirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
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

  return (
    <AuthContext.Provider value={{ user, profile, ratings, loading, signUp, signIn, signOut, getToken, supabaseEnabled: !!supabase }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
