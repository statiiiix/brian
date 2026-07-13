import { useCallback, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { authCallbackUrl, authReturnToFromSearch, withReturnTo } from '../lib/returnTo';
import AuthShell from './AuthShell';
import Turnstile, { TURNSTILE_SITE_KEY } from '../components/Turnstile';

export default function ForgotPassword() {
  const location = useLocation();
  const returnTo = authReturnToFromSearch(location.search, '/app');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);
  const onCaptchaToken = useCallback((token) => setCaptchaToken(token), []);

  async function submit(event) {
    event.preventDefault();
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError('Complete the bot-protection challenge to continue.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (!isSupabaseConfigured) throw new Error('Supabase Auth is not configured for this deployment.');
      const resetRoute = withReturnTo('/reset-password', returnTo);
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: authCallbackUrl(resetRoute),
        ...(captchaToken ? { captchaToken } : {}),
      });
      if (resetError) throw resetError;
      setSent(true);
    } catch (resetError) {
      setError(resetError.message || 'Unable to send a reset email.');
      setCaptchaToken('');
      setCaptchaReset((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell backHref={withReturnTo('/login', returnTo)} backLabel="Back to login">
      <form className="login-card" onSubmit={submit}>
        <h1>Reset your password</h1>
        <p className="login-sub auth-copy">Enter your email. If an account exists, we’ll send a one-time reset link.</p>
        <label htmlFor="forgot-email">Email</label>
        <input id="forgot-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <Turnstile onToken={onCaptchaToken} resetKey={captchaReset} />
        {error && <p className="login-error" role="alert">{error}</p>}
        {sent && <p className="login-success" role="status">Check your inbox for a password reset link.</p>}
        <button className="login-submit" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
      </form>
    </AuthShell>
  );
}
