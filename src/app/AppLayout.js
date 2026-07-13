import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon, msym } from '../components/Icon';
import brianWordmark from '../assets/brian-wordmark.webp';
import { api } from './api';
import { useAuth } from './auth';
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
  {
    label: 'Settings',
    items: [
      { to: '/app/settings/agents', label: 'Agents', icon: msym.agents },
      { to: '/app/settings/privacy', label: 'Privacy', icon: msym.settings },
    ],
  },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, profileError, signOut } = useAuth();
  const [reviewCount, setReviewCount] = useState(0);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [layoutError, setLayoutError] = useState('');

  useEffect(() => {
    Promise.all([api('/api/skills?status=draft'), api('/api/skills?status=needs_review')])
      .then(([drafts, flagged]) => setReviewCount(drafts.length + flagged.length))
      .catch(() => {});
  }, [location.pathname]);

  async function logout() {
    setLogoutBusy(true);
    setLayoutError('');
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (error) {
      setLayoutError(error.message || 'Unable to log out.');
      setLogoutBusy(false);
    }
  }

  const currentTenant = profile?.currentTenant || profile?.current_tenant;
  const email = profile?.user?.email || user?.email || '';
  const membership = useMemo(() => {
    const tenantId = currentTenant?.id;
    return profile?.currentMembership || (profile?.memberships || []).find((item) =>
      (item.tenant_id || item.tenantId || item.tenant?.id) === tenantId
    );
  }, [currentTenant?.id, profile]);
  const initial = (email || '?').charAt(0).toUpperCase();

  return (
    <div className="dash">
      <aside className="dash-sidebar">
        <a href="/" className="dash-logo"><img className="dash-logo-wordmark" src={brianWordmark} alt="Brian" /></a>
        <nav className="dash-nav" aria-label="Dashboard">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="dash-nav-group">
              <span className="dash-nav-label">{group.label}</span>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === '/app'} className={({ isActive }) => `dash-nav-item ${isActive ? 'is-active' : ''}`}>
                  <span className="dash-nav-icon" aria-hidden="true"><Icon path={item.icon} size={16} /></span>
                  {item.label}
                  {item.badge === 'review' && reviewCount > 0 && <span className="dash-nav-badge">{reviewCount}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="dash-sidebar-foot">
          <div className="dash-user">
            <span className="dash-user-avatar" aria-hidden="true">{initial}</span>
            <span className="dash-user-meta">
              <span className="dash-user-email" title={email}>{email || '…'}</span>
              <span className="dash-user-note">{currentTenant?.name || 'Loading company…'}{membership?.role ? ` · ${membership.role}` : ''}</span>
            </span>
          </div>
          <button type="button" className="dash-logout" onClick={logout} disabled={logoutBusy}><Icon path={msym.logout} size={15} />{logoutBusy ? 'Logging out…' : 'Log out'}</button>
        </div>
      </aside>
      <main className="dash-main">
        {(profileError || layoutError) && <p className="dash-error" role="alert">{layoutError || profileError}</p>}
        <div className="dash-page" key={location.pathname}><Outlet /></div>
      </main>
    </div>
  );
}
