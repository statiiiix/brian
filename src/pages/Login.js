import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, icons } from '../components/Icon';
import { api } from '../app/api';
import { setToken } from '../app/auth';
import './Login.css';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Supabase Auth when configured (hosted deployment); the access token goes
  // in the same Authorization header — the API guard validates it against the
  // auth server. Falls back to the legacy /api/auth/login (bcrypt+JWT) so
  // nothing breaks before auth users are provisioned.
  async function supabaseLogin() {
    const url = process.env.REACT_APP_SUPABASE_URL;
    const key = process.env.REACT_APP_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token ?? null;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      let token = await supabaseLogin();
      if (!token) {
        ({ token } = await api('/api/auth/login', {
          method: 'POST',
          body: { email, password },
        }));
      }
      setToken(token);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err.message === 'invalid credentials' ? 'Wrong email or password.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <a href="/" className="login-logo">
        <span className="login-logo-mark" aria-hidden="true">
          <Icon path={icons.bolt} size={14} />
        </span>
        Brian
      </a>
      <form className="login-card" onSubmit={onSubmit}>
        <h1>Log in</h1>
        <p className="login-sub">Your company brain is waiting.</p>
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="login-error" role="alert">{error}</p>}
        <button type="submit" className="login-submit" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
        <p className="login-hint">
          No account? <a href="/#cta">Get a demo</a> — we set up your team after a call.
        </p>
      </form>
    </div>
  );
}
