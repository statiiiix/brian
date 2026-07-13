import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { authCallbackUrl, authReturnToFromSearch, withReturnTo } from '../lib/returnTo';
import { useAuth } from '../app/auth';
import AuthShell from './AuthShell';

function loginErrorMessage(error) {
  const message = error?.message || 'Login failed';
  if (/invalid login credentials/i.test(message)) return 'Wrong email or password.';
  if (/confirm|verified/i.test(message)) return 'Please confirm your email before logging in.';
  if (/rate|too many/i.test(message)) return 'Too many attempts. Please wait a moment and try again.';
  return message;
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const returnTo = authReturnToFromSearch(location.search, '/app');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);

  useEffect(() => {
    if (session) navigate(returnTo, { replace: true });
  }, [session, navigate, returnTo]);

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    setNeedsConfirmation(false);
    setBusy(true);
    try {
      if (!isSupabaseConfigured) throw new Error('Supabase Auth is not configured for this deployment.');
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authError) throw authError;
      if (!data.session) throw new Error('Login did not create a session. Please try again.');
      navigate(returnTo, { replace: true });
    } catch (authError) {
      const message = loginErrorMessage(authError);
      setError(message);
      setNeedsConfirmation(/confirm your email/i.test(message));
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: authCallbackUrl(returnTo) },
      });
      if (resendError) throw resendError;
      setNotice('Confirmation email sent. Check your inbox and spam folder.');
    } catch (resendError) {
      setError(loginErrorMessage(resendError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <form className="login-card" onSubmit={onSubmit}>
        <h1>Log in</h1>
        <p className="login-sub">Your company brain is waiting.</p>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <div className="login-label-row">
          <label htmlFor="login-password">Password</label>
          <a href={withReturnTo('/forgot-password', returnTo)}>Forgot password?</a>
        </div>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {error && <p className="login-error" role="alert">{error}</p>}
        {notice && <p className="login-success" role="status">{notice}</p>}
        {needsConfirmation && (
          <button type="button" className="login-secondary" onClick={resendConfirmation} disabled={busy}>
            Resend confirmation email
          </button>
        )}
        <button type="submit" className="login-submit" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <p className="login-hint">
          New to Brian? <a href={withReturnTo('/signup', returnTo)}>Create an account</a>
        </p>
      </form>
    </AuthShell>
  );
}
