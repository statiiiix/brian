import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon, msym } from '../components/Icon';
import brianWordmark from '../assets/brian-wordmark.webp';
import { api } from './api';
import { clearToken } from './auth';
import './AppLayout.css';

const NAV_GROUPS = [
  {
    label: 'Workspace',
    items: [
      { to: '/app', label: 'Overview', icon: msym.home },
      { to: '/app/build', label: 'Build a skill', icon: msym.build },
      { to: '/app/skills', label: 'Skills', icon: msym.skills },
      { to: '/app/review', label: 'Review', icon: msym.review, badge: 'review' },
    ],
  },
  {
    label: 'Signals',
    items: [
      { to: '/app/connectors', label: 'Sources', icon: msym.connectors },
      { to: '/app/capture', label: 'Quick capture', icon: msym.capture },
      { to: '/app/executions', label: 'Runs', icon: msym.executions },
    ],
  },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState(null);
  const [reviewCount, setReviewCount] = useState(0);

  useEffect(() => {
    api('/api/auth/me').then(setMe).catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([api('/api/skills?status=draft'), api('/api/skills?status=needs_review')])
      .then(([drafts, flagged]) => setReviewCount(drafts.length + flagged.length))
      .catch(() => {});
  }, [location.pathname]);

  function logout() {
    clearToken();
    navigate('/login', { replace: true });
  }

  const initial = (me?.email || '?').charAt(0).toUpperCase();

  return (
    <div className="dash">
      <aside className="dash-sidebar">
        <a href="/" className="dash-logo">
          <img className="dash-logo-wordmark" src={brianWordmark} alt="Brian" />
        </a>

        <nav className="dash-nav" aria-label="Dashboard">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="dash-nav-group">
              <span className="dash-nav-label">{group.label}</span>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/app'}
                  className={({ isActive }) => `dash-nav-item ${isActive ? 'is-active' : ''}`}
                >
                  <span className="dash-nav-icon" aria-hidden="true">
                    <Icon path={item.icon} size={16} />
                  </span>
                  {item.label}
                  {item.badge === 'review' && reviewCount > 0 && (
                    <span className="dash-nav-badge">{reviewCount}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="dash-sidebar-foot">
          <div className="dash-user">
            <span className="dash-user-avatar" aria-hidden="true">{initial}</span>
            <span className="dash-user-meta">
              <span className="dash-user-email" title={me?.email}>{me?.email || '…'}</span>
              <span className="dash-user-note">Signed in</span>
            </span>
          </div>
          <button type="button" className="dash-logout" onClick={logout}>
            <Icon path={msym.logout} size={15} />
            Log out
          </button>
        </div>
      </aside>

      <main className="dash-main">
        <div className="dash-page" key={location.pathname}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
