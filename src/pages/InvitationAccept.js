import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../app/auth';
import { api } from '../app/api';
import { withReturnTo } from '../lib/returnTo';
import AuthShell from './AuthShell';

export default function InvitationAccept() {
  const { token = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { session, loading, refreshProfile } = useAuth();
  const started = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session || started.current) return;
    started.current = true;
    api('/api/invitations/accept', { method: 'POST', body: { token } })
      .then(() => refreshProfile())
      .then(() => navigate('/onboarding', { replace: true }))
      .catch((acceptError) => setError(acceptError.message || 'This invitation is invalid or expired.'));
  }, [navigate, refreshProfile, session, token]);

  if (loading) {
    return <AuthShell><section className="login-card"><h1>Opening invitation…</h1></section></AuthShell>;
  }
  if (!session) {
    return <Navigate to={withReturnTo('/login', `${location.pathname}${location.search}`)} replace />;
  }
  return (
    <AuthShell>
      <section className="login-card" aria-live="polite">
        <h1>{error ? 'Invitation unavailable' : 'Joining your company…'}</h1>
        <p className={error ? 'login-error' : 'login-sub'}>{error || 'Validating the one-time invitation and your signed-in email.'}</p>
        {error && <a className="login-submit login-submit--link" href="/app">Return to Brian</a>}
      </section>
    </AuthShell>
  );
}
