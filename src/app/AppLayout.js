import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Icon, icons } from '../components/Icon';
import { api } from './api';
import { clearToken } from './auth';
import './AppLayout.css';

const NAV = [
  { to: '/app/skills', label: 'Skills', icon: icons.rules },
  { to: '/app/review', label: 'Review', icon: icons.shield },
  { to: '/app/interviews', label: 'Interviews', icon: icons.review },
  { to: '/app/capture', label: 'Capture', icon: icons.capture },
  { to: '/app/executions', label: 'Executions', icon: icons.log },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);

  useEffect(() => {
    api('/api/auth/me').then(setMe).catch(() => {});
  }, []);

  function logout() {
    clearToken();
    navigate('/login', { replace: true });
  }

  return (
    <div className="dash">
      <aside className="dash-sidebar">
        <a href="/" className="dash-logo">
          <span className="dash-logo-mark" aria-hidden="true">
            <Icon path={icons.bolt} size={13} />
          </span>
          Brian
        </a>
        <nav className="dash-nav" aria-label="Dashboard">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `dash-nav-item ${isActive ? 'is-active' : ''}`}
            >
              <Icon path={item.icon} size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="dash-sidebar-foot">
          {me && <span className="dash-user" title={me.email}>{me.email}</span>}
          <button type="button" className="dash-logout" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="dash-main">
        <Outlet />
      </main>
    </div>
  );
}
