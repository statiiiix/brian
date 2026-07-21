import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { api } from './api';
import { clearCache } from './queryCache';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      setSession(error ? null : data.session);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setLoading(false);
      if (!nextSession) {
        clearCache();
        setProfile(null);
        setProfileError('');
      }
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session) {
      setProfile(null);
      return null;
    }
    setProfileLoading(true);
    setProfileError('');
    try {
      const nextProfile = await api('/api/me', { redirectOnUnauthorized: false });
      setProfile(nextProfile);
      return nextProfile;
    } catch (error) {
      setProfile(null);
      setProfileError(error.message || 'Unable to load your company membership.');
      return null;
    } finally {
      setProfileLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) refreshProfile();
  }, [session, refreshProfile]);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    clearCache();
    setSession(null);
    setProfile(null);
  }, []);

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    loading,
    profile,
    profileLoading,
    profileError,
    refreshProfile,
    signOut,
  }), [session, loading, profile, profileLoading, profileError, refreshProfile, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
