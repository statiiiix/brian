import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../app/auth';
import { supabase } from '../lib/supabase';
import { authReturnToFromSearch } from '../lib/returnTo';
import AuthShell from './AuthShell';

export default function ResetPassword() {
  const location = useLocation();
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const returnTo = authReturnToFromSearch(location.search, '/app');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError('Use at least 10 characters, including a letter and a number.');
      return;
    }
    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      navigate(returnTo, { replace: true });
    } catch (updateError) {
      setError(updateError.message || 'Unable to update your password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <form className="login-card" onSubmit={submit}>
        <h1>Choose a new password</h1>
        <p className="login-sub">Use at least 10 characters, with a letter and a number.</p>
        {loading && <p className="login-notice" role="status">Checking your reset link…</p>}
        {!loading && !session && <p className="login-error" role="alert">This reset link is invalid or expired. Request a new one.</p>}
        <label htmlFor="reset-password">New password</label>
        <input id="reset-password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={!session || loading} required />
        <label htmlFor="reset-confirmation">Confirm new password</label>
        <input id="reset-confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={!session || loading} required />
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="login-submit" type="submit" disabled={busy || !session || loading}>{busy ? 'Updating…' : 'Update password'}</button>
        {!loading && !session && <p className="login-hint"><a href="/forgot-password">Request another reset link</a></p>}
      </form>
    </AuthShell>
  );
}
