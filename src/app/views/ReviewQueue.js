import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { msym } from '../../components/Icon';
import { api } from '../api';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import TableSkeleton from '../components/TableSkeleton';
import './ReviewQueue.css';

export default function ReviewQueue() {
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [drafts, needsReview] = await Promise.all([
        api('/api/skills?status=draft'),
        api('/api/skills?status=needs_review'),
      ]);
      const merged = [...drafts, ...needsReview].sort(
        (a, b) => new Date(b.updated_at) - new Date(a.updated_at)
      );
      setItems(merged);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function act(id, action) {
    if (action === 'retire' && !window.confirm('Reject this skill? It will be retired and agents will never run it.')) {
      return;
    }
    setBusyId(id);
    setError('');
    try {
      await api(`/api/skills/${id}/${action}`, { method: 'POST' });
      setItems((list) => list.filter((s) => s.id !== id));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="review-queue">
      <header className="dash-head">
        <div>
          <h1 className="dash-title">Review queue</h1>
        </div>
        {items !== null && items.length > 0 && (
          <span className="review-count dash-mono">
            {items.length} pending
          </span>
        )}
      </header>

      {error && <p className="dash-error" role="alert">{error}</p>}
      {!error && items === null && <TableSkeleton rows={3} cols={3} />}

      {items !== null && items.length === 0 && (
        <EmptyState icon={msym.clear} title="Queue is clear">
          New drafts from interviews, capture, or staleness checks will land here for your sign-off.
        </EmptyState>
      )}

      {items !== null && items.map((s) => (
        <article key={s.id} className="dash-card review-item">
          <div className="review-item-head">
            <div>
              <h2 className="review-item-name">
                <Link to={`/app/skills/${s.id}`}>{s.name}</Link>
              </h2>
              <p className="review-item-meta">
                <StatusBadge status={s.status} />
                <span className="dash-mono">v{s.version}</span>
                {s.owner && <span>{s.owner}</span>}
              </p>
            </div>
            <div className="review-item-actions">
              <button
                type="button"
                className="dash-btn dash-btn--ghost"
                onClick={() => setOpen(open === s.id ? null : s.id)}
                aria-expanded={open === s.id}
              >
                {open === s.id ? 'Hide details' : 'Details'}
              </button>
              <button
                type="button"
                className="dash-btn dash-btn--danger"
                onClick={() => act(s.id, 'retire')}
                disabled={busyId === s.id}
              >
                Reject
              </button>
              <button
                type="button"
                className="dash-btn dash-btn--primary"
                onClick={() => act(s.id, 'activate')}
                disabled={busyId === s.id}
              >
                {busyId === s.id ? 'Working…' : 'Approve'}
              </button>
            </div>
          </div>

          {open === s.id && (
            <dl className="review-item-detail">
              <dt>Trigger</dt>
              <dd>{s.trigger}</dd>
              <dt>Procedure</dt>
              <dd className="review-item-pre">{s.procedure}</dd>
              {s.hard_rules?.length > 0 && (
                <>
                  <dt>Hard rules</dt>
                  <dd><ul>{s.hard_rules.map((r, i) => <li key={i}>{r}</li>)}</ul></dd>
                </>
              )}
              {s.guardrails?.length > 0 && (
                <>
                  <dt>Guardrails</dt>
                  <dd><ul>{s.guardrails.map((g, i) => <li key={i}>{g}</li>)}</ul></dd>
                </>
              )}
              {s.tools?.length > 0 && (
                <>
                  <dt>Tools</dt>
                  <dd className="dash-mono">{s.tools.join(', ')}</dd>
                </>
              )}
              {s.escalation_target && (
                <>
                  <dt>Escalates to</dt>
                  <dd>{s.escalation_target}</dd>
                </>
              )}
            </dl>
          )}
        </article>
      ))}
    </div>
  );
}
