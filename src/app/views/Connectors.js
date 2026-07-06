import { useEffect, useState } from 'react';
import { Icon, icons } from '../../components/Icon';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge';
import TableSkeleton from '../components/TableSkeleton';
import './Connectors.css';

const SOURCES = [
  {
    type: 'gmail',
    label: 'Gmail',
    icon: icons.gmail,
    blurb: 'Mine email threads for recurring processes and decisions. Uses the server’s Google OAuth (GMAIL_* / npm run gmail:auth).',
    needsToken: false,
  },
  {
    type: 'slack',
    label: 'Slack',
    icon: icons.slack,
    blurb: 'Mine channels the bot is invited to. Paste a bot token with channels:history, groups:history, users:read.',
    needsToken: true,
  },
];

export default function Connectors() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [tokens, setTokens] = useState({});
  const [results, setResults] = useState({});

  function load() {
    api('/api/connectors').then(setRows).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  const byType = Object.fromEntries((rows || []).map((r) => [r.type, r]));

  async function act(type, run) {
    setBusy(type);
    setError('');
    try {
      await run();
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  const connect = (type, credentials) =>
    act(type, () => api(`/api/connectors/${type}/connect`, { method: 'POST', body: { credentials } }));
  const disable = (type) => act(type, () => api(`/api/connectors/${type}/disable`, { method: 'POST' }));
  const sync = (type) =>
    act(type, async () => {
      const s = await api(`/api/connectors/${type}/sync`, { method: 'POST' });
      setResults((r) => ({ ...r, [type]: s }));
    });

  return (
    <div className="connectors">
      <header className="dash-head">
        <div>
          <h1 className="dash-title">Connectors</h1>
          <p className="dash-subtitle">
            Let Brian read your real Gmail &amp; Slack, filter the noise, and draft skills into the
            review queue — nothing goes live unread.
          </p>
        </div>
      </header>

      {error && <p className="dash-error" role="alert">{error}</p>}
      {rows === null && !error && <TableSkeleton rows={2} />}

      {rows !== null && (
        <div className="connectors-grid">
          {SOURCES.map((src) => {
            const row = byType[src.type];
            const connected = row?.status === 'connected';
            const acting = busy === src.type;
            const result = results[src.type];
            const tokenReady = !src.needsToken || (tokens[src.type] || '').trim().length > 0;
            return (
              <section key={src.type} className="dash-card connectors-card">
                <div className="connectors-card-head">
                  <span className="connectors-icon" aria-hidden="true">
                    <Icon path={src.icon} size={18} />
                  </span>
                  <h2 className="dash-h2">{src.label}</h2>
                  <StatusBadge status={row?.status || 'disabled'} />
                </div>

                <p className="connectors-blurb">{src.blurb}</p>
                {row?.last_synced_at && (
                  <p className="connectors-meta dash-mono">
                    Last synced {new Date(row.last_synced_at).toLocaleString()}
                  </p>
                )}

                {src.needsToken && !connected && (
                  <input
                    className="dash-input connectors-token"
                    placeholder="xoxb-… bot token"
                    value={tokens[src.type] || ''}
                    onChange={(e) => setTokens((t) => ({ ...t, [src.type]: e.target.value }))}
                  />
                )}

                <div className="connectors-actions">
                  {!connected && (
                    <button
                      type="button"
                      className="dash-btn dash-btn--primary"
                      disabled={acting || !tokenReady}
                      onClick={() =>
                        connect(src.type, src.needsToken ? { bot_token: (tokens[src.type] || '').trim() } : {})
                      }
                    >
                      {acting ? 'Connecting…' : 'Connect'}
                    </button>
                  )}
                  {connected && (
                    <>
                      <button
                        type="button"
                        className="dash-btn dash-btn--primary"
                        disabled={acting}
                        onClick={() => sync(src.type)}
                      >
                        {acting ? 'Syncing…' : 'Sync now'}
                      </button>
                      <button
                        type="button"
                        className="dash-btn dash-btn--ghost"
                        disabled={acting}
                        onClick={() => disable(src.type)}
                      >
                        Disable
                      </button>
                    </>
                  )}
                </div>

                {result && (
                  <p className="connectors-result" role="status">
                    Fetched {result.fetched} · kept {result.kept} · evidence {result.evidence} · drafts{' '}
                    {result.drafts}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
