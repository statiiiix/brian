import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon, icons } from '../components/Icon';
import { api } from './api';
import { clearToken } from './auth';
import './AppLayout.css';

const NAV_GROUPS = [
  {
    label: 'Library',
    items: [
      { to: '/app/skills', label: 'Skills', icon: icons.rules },
      { to: '/app/review', label: 'Review', icon: icons.shield, badge: 'review' },
      { to: '/app/interviews', label: 'Interviews', icon: icons.review },
    ],
  },
  {
    label: 'Activity',
    items: [
      { to: '/app/capture', label: 'Capture', icon: icons.capture },
      { to: '/app/connectors', label: 'Connectors', icon: icons.inbox },
      { to: '/app/executions', label: 'Executions', icon: icons.log },
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
          <span className="dash-logo-mark" aria-hidden="true">
            <Icon path={icons.bolt} size={14} />
          </span>
          <span className="dash-logo-name">Brian</span>
        </a>

        <nav className="dash-nav" aria-label="Dashboard">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="dash-nav-group">
              <span className="dash-nav-label">{group.label}</span>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
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
            <Icon path={icons.logout} size={15} />
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
