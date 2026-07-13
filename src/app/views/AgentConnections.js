import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { BRIAN_MCP_URL, supabase } from '../../lib/supabase';
import { useAuth } from '../auth';
import { api } from '../api';
import { AGENT_PERMISSION_DEFINITIONS } from '../permissions';
import './AgentConnections.css';

function connectionName(connection) {
  return connection.displayName || connection.name || connection.client_name || connection.clientName || 'Unnamed agent';
}

function connectionId(connection) {
  return connection.id || connection.connection_id || connection.connectionId;
}

function formatTimestamp(value, empty = 'Never') {
  if (!value) return empty;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? empty : date.toLocaleString();
}

export default function AgentConnections() {
  const { profile } = useAuth();
  const [connections, setConnections] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [editingId, setEditingId] = useState('');
  const [draftName, setDraftName] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await api('/api/agent-connections');
      setConnections(Array.isArray(payload) ? payload : payload.connections || []);
    } catch (loadError) {
      setError(loadError.message || 'Unable to load agent connections.');
      setConnections([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const currentTenant = profile?.currentTenant || profile?.current_tenant;
  const currentMembership = useMemo(() => {
    if (profile?.currentMembership) return profile.currentMembership;
    const tenantId = currentTenant?.id;
    return (profile?.memberships || []).find((membership) =>
      (membership.tenant_id || membership.tenantId || membership.tenant?.id) === tenantId
    );
  }, [currentTenant?.id, profile]);
  const role = currentMembership?.role || profile?.user?.role;
  const canManage = role !== 'viewer';
  const featureEnabled = profile?.featureFlags?.agentConnectionsUi !== false && profile?.featureFlags?.AGENT_CONNECTIONS_UI_ENABLED !== false;

  async function copy(value, label) {
    setNotice('');
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setNotice(`Copy failed. Select the ${label.toLowerCase()} below.`);
    }
  }

  function beginRename(connection) {
    setEditingId(connectionId(connection));
    setDraftName(connectionName(connection));
  }

  async function rename(connection) {
    const id = connectionId(connection);
    const name = draftName.trim();
    if (!name || name.length > 120) {
      setError('Connection names must use 1–120 characters.');
      return;
    }
    setBusy(id);
    setError('');
    try {
      await api(`/api/agent-connections/${id}`, { method: 'PATCH', body: { name } });
      setEditingId('');
      setNotice('Connection renamed.');
      await load();
    } catch (renameError) {
      setError(renameError.message || 'Unable to rename this connection.');
    } finally {
      setBusy('');
    }
  }

  async function revoke(connection) {
    const id = connectionId(connection);
    if (!window.confirm(`Revoke ${connectionName(connection)}? Its next Brian request will be blocked.`)) return;
    setBusy(id);
    setError('');
    try {
      await api(`/api/agent-connections/${id}/revoke`, { method: 'POST' });
      const approvingUserId = connection.userId || connection.user_id;
      const oauthClientId = connection.oauthClientId || connection.oauth_client_id;
      let providerRevoked = false;
      if (oauthClientId && approvingUserId === profile?.user?.id) {
        const { error: providerError } = await supabase.auth.oauth.revokeGrant({ clientId: oauthClientId });
        providerRevoked = !providerError;
      }
      setNotice(providerRevoked
        ? `${connectionName(connection)} was revoked, including its OAuth refresh sessions.`
        : `${connectionName(connection)} was revoked at Brian. Its next Brian request will be blocked.`);
      await load();
    } catch (revokeError) {
      setError(revokeError.message || 'Unable to revoke this connection.');
    } finally {
      setBusy('');
    }
  }

  if (!featureEnabled) {
    return <section><header className="dash-head"><div><h1 className="dash-title">Agents & connections</h1></div></header><p className="dash-notice">Agent connection management is temporarily unavailable.</p></section>;
  }

  return (
    <div className="agents-page">
      <header className="dash-head">
        <div><p className="agents-kicker">Settings</p><h1 className="dash-title">Agents & connections</h1><p className="dash-subtitle">Connect clients with browser OAuth, review their exact permissions, and revoke access immediately.</p></div>
      </header>

      {error && <p className="dash-error" role="alert">{error}</p>}
      {notice && <p className="dash-notice" role="status">{notice}</p>}

      <section className="dash-card agents-connect-card">
        <div className="agents-connect-copy"><span><Icon path="add_link" size={20} /></span><div><h2>Connect another agent</h2><p>Use the canonical MCP URL in an OAuth-capable client, or let the Brian CLI configure supported clients safely.</p></div></div>
        <div className="agents-copy-row"><code>{BRIAN_MCP_URL}</code><button type="button" onClick={() => copy(BRIAN_MCP_URL, 'MCP URL')}>Copy URL</button></div>
        <div className="agents-copy-row"><code>npx @brianthebrain/cli connect</code><button type="button" onClick={() => copy('npx @brianthebrain/cli connect', 'CLI command')}>Copy command</button></div>
        {!canManage && <p className="agents-warning">Your viewer role cannot approve a new agent connection.</p>}
      </section>

      <div className="agents-section-head"><h2>Connected clients</h2><span>{currentTenant?.name || 'Current company'}</span></div>

      {connections === null && <p role="status">Loading connections…</p>}
      {connections?.length === 0 && <div className="dash-card agents-empty"><Icon path="smart_toy" size={24} /><h3>No agent connections yet</h3><p>Add the MCP URL to your client. Brian will open a browser consent screen before granting access.</p></div>}

      {connections?.length > 0 && (
        <div className="agents-list">
          {connections.map((connection) => {
            const id = connectionId(connection);
            const permissions = Array.isArray(connection.permissions) ? connection.permissions : [];
            const active = connection.status === 'active';
            const approvingUserId = connection.userId || connection.user_id;
            const approvedBy = connection.approved_by_email
              || connection.user_email
              || connection.approvedBy
              || (approvingUserId === profile?.user?.id ? profile?.user?.email : approvingUserId)
              || 'Company member';
            return (
              <article className="dash-card agent-card" key={id}>
                <div className="agent-card-head">
                  <span className="agent-card-icon"><Icon path="smart_toy" size={19} /></span>
                  <div className="agent-card-title">
                    {editingId === id ? (
                      <div className="agent-rename"><input aria-label={`Rename ${connectionName(connection)}`} value={draftName} maxLength={120} onChange={(event) => setDraftName(event.target.value)} /><button type="button" disabled={busy === id} onClick={() => rename(connection)}>Save</button><button type="button" onClick={() => setEditingId('')}>Cancel</button></div>
                    ) : <h3>{connectionName(connection)}</h3>}
                    <span>{connection.oauth_client_id || connection.oauthClientId || 'OAuth client'}</span>
                  </div>
                  <span className={`agent-status agent-status--${connection.status || 'unknown'}`}>{connection.status || 'unknown'}</span>
                </div>
                <dl className="agent-meta">
                  <div><dt>Approved by</dt><dd>{approvedBy}</dd></div>
                  <div><dt>Created</dt><dd>{formatTimestamp(connection.approvedAt || connection.approved_at || connection.createdAt || connection.created_at, 'Unknown')}</dd></div>
                  <div><dt>Last used</dt><dd>{formatTimestamp(connection.lastUsedAt || connection.last_used_at)}</dd></div>
                </dl>
                <div className="agent-permissions" aria-label="Granted permissions">
                  {permissions.map((permission) => <span key={permission} title={AGENT_PERMISSION_DEFINITIONS[permission]?.description}>{AGENT_PERMISSION_DEFINITIONS[permission]?.title || permission}</span>)}
                </div>
                <div className="agent-actions">
                  {canManage && active && <button type="button" className="dash-btn dash-btn--ghost" onClick={() => beginRename(connection)}>Rename</button>}
                  {canManage && active && <button type="button" className="dash-btn dash-btn--danger" disabled={busy === id} onClick={() => revoke(connection)}>{busy === id ? 'Revoking…' : 'Revoke'}</button>}
                  {!active && <p>Reconnect from the agent to create a new authorization grant.</p>}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {(profile?.featureFlags?.legacyAgentTokens || profile?.featureFlags?.LEGACY_AGENT_TOKENS_ENABLED) && (
        <section className="dash-card agents-legacy"><h2>Legacy token installations</h2><p>Older installations may still use a static Brian bearer token. Reconnect them with OAuth, then revoke the legacy credential. Brian never displays token values here.</p></section>
      )}
    </div>
  );
}
