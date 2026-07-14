import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../app/auth';
import { api } from '../app/api';
import { DEFAULT_AGENT_PERMISSIONS, permissionDetails } from '../app/permissions';
import { supabase } from '../lib/supabase';
import { authorizationReturnTo, withReturnTo } from '../lib/returnTo';
import AuthShell from './AuthShell';
import './OAuthConsent.css';

function tenantIdFor(membership) {
  return membership.tenant_id || membership.tenantId || membership.tenant?.id || '';
}

function tenantNameFor(membership) {
  return membership.tenant?.name || membership.tenant_name || membership.tenantName || 'Company';
}

function redirectDetails(uri) {
  try {
    const url = new URL(uri);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return {
      label: url.host || uri,
      loopback,
      safe: !url.username
        && !url.password
        && !url.hash
        && (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)),
    };
  } catch {
    return { label: 'Registered application callback', loopback: false, safe: false };
  }
}

const OPTIONAL_AGENT_PERMISSIONS = ['knowledge:write', 'actions:execute'];

export default function OAuthConsent() {
  const location = useLocation();
  const { session, loading: authLoading, profile, profileLoading, profileError } = useAuth();
  const authorizationId = new URLSearchParams(location.search).get('authorization_id') || '';
  const continuation = authorizationReturnTo(authorizationId);
  const [details, setDetails] = useState(null);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [optionalPermissions, setOptionalPermissions] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (!session || !continuation) return;
    let active = true;
    setError('');
    supabase.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error: detailsError }) => {
      if (!active) return;
      if (detailsError) {
        setError('This authorization request is invalid or expired. Return to your agent and click Connect again.');
        return;
      }
      if (data?.redirect_url) {
        window.location.assign(data.redirect_url);
        return;
      }
      setOptionalPermissions([]);
      setDetails(data);
    });
    return () => { active = false; };
  }, [authorizationId, continuation, session]);

  const memberships = useMemo(() => {
    const rows = Array.isArray(profile?.memberships) ? profile.memberships : [];
    return rows.filter((membership) => !membership.status || membership.status === 'active');
  }, [profile]);

  useEffect(() => {
    if (memberships.length === 1) setSelectedTenantId(tenantIdFor(memberships[0]));
  }, [memberships]);

  const selectedMembership = memberships.find((membership) => tenantIdFor(membership) === selectedTenantId);
  const permissions = useMemo(
    () => [...DEFAULT_AGENT_PERMISSIONS, ...optionalPermissions],
    [optionalPermissions],
  );
  const displayPermissions = useMemo(() => permissionDetails(DEFAULT_AGENT_PERMISSIONS), []);
  const optionalPermissionDetails = useMemo(() => permissionDetails(OPTIONAL_AGENT_PERMISSIONS), []);
  const redirect = useMemo(() => redirectDetails(details?.redirect_uri), [details]);
  const mcpEnabled = profile?.featureFlags?.mcpOAuth !== false && profile?.featureFlags?.MCP_OAUTH_ENABLED !== false;
  const approvalsEnabled = profile?.featureFlags?.mcpOAuthApprovals === true
    || profile?.featureFlags?.MCP_OAUTH_APPROVALS_ENABLED === true;
  const newConnectionsEnabled = mcpEnabled && approvalsEnabled;
  const canApprove = Boolean(selectedMembership)
    && selectedMembership.role !== 'viewer'
    && redirect.safe
    && newConnectionsEnabled;

  function togglePermission(permission, checked) {
    setOptionalPermissions((current) => checked
      ? [...current, permission]
      : current.filter((candidate) => candidate !== permission));
  }

  if (authLoading) {
    return <AuthShell><section className="login-card"><h1>Opening authorization…</h1><p className="login-sub">Checking your Brian session.</p></section></AuthShell>;
  }
  if (!session) {
    const returnTo = continuation || '/oauth/consent';
    return <Navigate to={withReturnTo('/login', returnTo)} replace />;
  }
  if (!continuation) {
    return <AuthShell><section className="login-card"><h1>Authorization expired</h1><p className="login-error">Return to your agent and click Connect again.</p></section></AuthShell>;
  }

  async function prepareGrant() {
    const response = await api('/api/oauth/grants/prepare', {
      method: 'POST',
      body: {
        authorizationId,
        tenantId: selectedTenantId,
        permissions,
      },
    });
    if (!response?.grant?.id) throw new Error('Brian could not prepare this agent connection.');
    return response.grant;
  }

  async function approve() {
    if (!canApprove || !details) return;
    setBusy('approve');
    setError('');
    let grant;
    try {
      grant = await prepareGrant();
      const { data, error: approvalError } = await supabase.auth.oauth.approveAuthorization(
        authorizationId,
        { skipBrowserRedirect: true }
      );
      if (approvalError) throw approvalError;
      if (!data?.redirect_url) throw new Error('The authorization server did not return a safe redirect.');
      window.location.assign(data.redirect_url);
    } catch (approvalError) {
      if (grant?.id) {
        await api(`/api/oauth/grants/${grant.id}/deny`, {
          method: 'POST',
          body: { tenantId: selectedTenantId },
        }).catch(() => {});
      }
      setError(approvalError.message || 'Unable to approve this connection.');
      setBusy('');
    }
  }

  async function deny() {
    if (!details) return;
    setBusy('deny');
    setError('');
    try {
      // Audit the verified authorization request before Supabase consumes it.
      // This endpoint never prepares or mutates an agent connection.
      await api('/api/oauth/authorizations/deny', {
        method: 'POST',
        body: {
          authorizationId,
          ...(selectedTenantId ? { tenantId: selectedTenantId } : {}),
        },
      });
      const { data, error: denialError } = await supabase.auth.oauth.denyAuthorization(
        authorizationId,
        { skipBrowserRedirect: true }
      );
      if (denialError) throw denialError;
      if (!data?.redirect_url) throw new Error('The authorization server did not return a safe redirect.');
      window.location.assign(data.redirect_url);
    } catch (denialError) {
      setError(denialError.message || 'Unable to deny this request. Return to your agent and cancel the connection.');
      setBusy('');
    }
  }

  return (
    <AuthShell>
      <section className="login-card consent-card">
        <p className="auth-kicker">Agent authorization</p>
        <h1>{details ? `Connect ${details.client.name || 'this agent'}?` : 'Loading request…'}</h1>
        {details && (
          <>
            <p className="login-sub auth-copy">This creates a separate, revocable connection. Your browser login alone never gives an agent access.</p>
            <dl className="consent-client">
              <div><dt>Client</dt><dd>{details.client.name || 'Unnamed OAuth client'}</dd></div>
              <div><dt>Website</dt><dd>{details.client.uri || 'Not provided'}</dd></div>
              <div><dt>Returns to</dt><dd>{redirect.label}</dd></div>
            </dl>
            {redirect.loopback && <p className="consent-loopback">This agent will return through a local callback on this device.</p>}
            {!redirect.safe && <p className="login-error">This callback is not safe to approve. Return to your agent and cancel the connection.</p>}
            <label htmlFor="consent-company">Company</label>
            {profileLoading ? (
              <p className="login-notice">Loading your companies…</p>
            ) : memberships.length > 1 ? (
              <select id="consent-company" className="consent-select" value={selectedTenantId} onChange={(event) => setSelectedTenantId(event.target.value)}>
                <option value="">Choose a company</option>
                {memberships.map((membership) => <option key={tenantIdFor(membership)} value={tenantIdFor(membership)}>{tenantNameFor(membership)} · {membership.role}</option>)}
              </select>
            ) : memberships.length === 1 ? (
              <div className="consent-company"><strong>{tenantNameFor(memberships[0])}</strong><span>{memberships[0].role}</span></div>
            ) : (
              <p className="login-error">Your account has no active Brian company membership.</p>
            )}
            <div className="consent-permissions">
              <h2>This agent will be able to</h2>
              {displayPermissions.map((permission) => (
                <article key={permission.id} className={permission.highRisk ? 'is-sensitive' : ''}>
                  <span aria-hidden="true">{permission.highRisk ? '!' : '✓'}</span>
                  <div><strong>{permission.title}</strong><p>{permission.description}</p></div>
                  <small>Required</small>
                </article>
              ))}
              <h2>Optional access</h2>
              {optionalPermissionDetails
                .filter((permission) => permission.id !== 'actions:execute'
                  || selectedMembership?.role === 'owner'
                  || selectedMembership?.role === 'admin')
                .map((permission) => (
                  <label key={permission.id} className={`consent-permission-option${permission.highRisk ? ' is-sensitive' : ''}`}>
                    <input
                      type="checkbox"
                      aria-label={permission.title}
                      checked={optionalPermissions.includes(permission.id)}
                      onChange={(event) => togglePermission(permission.id, event.target.checked)}
                    />
                    <div><strong>{permission.title}</strong><p>{permission.description}</p></div>
                  </label>
                ))}
            </div>
            {selectedMembership?.role === 'viewer' && <p className="login-error">Viewers cannot connect agents. Ask a company admin to change your role.</p>}
            {!newConnectionsEnabled && <p className="login-error">New agent connections are temporarily paused.</p>}
            {profileError && <p className="login-error">{profileError}</p>}
            {error && <p className="login-error" role="alert">{error}</p>}
            <div className="consent-actions">
              <button type="button" className="login-secondary" onClick={deny} disabled={Boolean(busy)}>{busy === 'deny' ? 'Denying…' : 'Deny'}</button>
              <button type="button" className="login-submit" onClick={approve} disabled={Boolean(busy) || !canApprove}>{busy === 'approve' ? 'Approving…' : 'Approve connection'}</button>
            </div>
          </>
        )}
        {!details && !error && <p className="login-notice" role="status">Retrieving verified client details…</p>}
        {error && !details && <p className="login-error" role="alert">{error}</p>}
      </section>
    </AuthShell>
  );
}
