import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { authReturnToFromSearch, withReturnTo } from '../lib/returnTo';
import AuthShell from './AuthShell';

export default function AuthCallback() {
  const location = useLocation();
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState('');
  const returnTo = authReturnToFromSearch(location.search, '/app');

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const providerError = params.get('error_description') || params.get('error');

    // Remove the one-time code from browser history and referrers immediately.
    window.history.replaceState({}, '', withReturnTo('/auth/callback', returnTo));

    async function finish() {
      if (providerError) throw new Error(providerError);
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          const { data } = await supabase.auth.getSession();
          if (!data.session) throw exchangeError;
        }
      }
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!data.session) throw new Error('This sign-in link is invalid or has expired.');
      navigate(returnTo, { replace: true });
    }

    finish().catch((authError) => setError(authError.message || 'Unable to finish signing in.'));
  }, [location.search, navigate, returnTo]);

  return (
    <AuthShell>
      <section className="login-card" aria-live="polite">
        <h1>{error ? 'That link did not work' : 'Finishing sign in…'}</h1>
        <p className="login-sub auth-copy">
          {error || 'Securely exchanging your one-time code and restoring your Brian session.'}
        </p>
        {error && <a className="login-submit login-submit--link" href={withReturnTo('/login', returnTo)}>Return to login</a>}
      </section>
    </AuthShell>
  );
}
