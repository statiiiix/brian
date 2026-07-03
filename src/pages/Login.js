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

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { token } = await api('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
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
