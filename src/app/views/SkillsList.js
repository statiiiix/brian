import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { msym } from '../../components/Icon';
import { useCachedQuery } from '../useCachedQuery';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import TableSkeleton from '../components/TableSkeleton';
import './SkillsList.css';

const FILTERS = ['all', 'active', 'draft', 'needs_review', 'retired'];

function fmtDate(iso) {
  return iso
    ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
}

export default function SkillsList() {
  const { data: skills, error } = useCachedQuery('/api/skills');
  const [filter, setFilter] = useState('all');

  const counts = useMemo(() => {
    const c = { all: skills?.length || 0 };
    for (const s of skills || []) c[s.status] = (c[s.status] || 0) + 1;
    return c;
  }, [skills]);

  const visible = useMemo(
    () => (skills || []).filter((s) => filter === 'all' || s.status === filter),
    [skills, filter]
  );

  return (
    <div className="skills-list">
      <header className="dash-head">
        <div>
          <h1 className="dash-title">Skills</h1>
          <p className="dash-subtitle">The governed procedures your agents retrieve before they act.</p>
        </div>
        <Link to="/app/build" className="dash-btn dash-btn--primary">
          Build a skill
        </Link>
      </header>

      <div className="dash-chips" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={`dash-chip ${filter === f ? 'is-active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f.replace('_', ' ')}
            {skills !== null && (
              <span className="skills-chip-count">{counts[f] || 0}</span>
            )}
          </button>
        ))}
      </div>

      {error && <p className="dash-error" role="alert">{error}</p>}
      {!error && skills === null && <TableSkeleton rows={6} />}

      {skills !== null && visible.length === 0 && (
        <EmptyState
          icon={msym.skills}
          title={filter === 'all' ? 'No skills yet' : `No ${filter.replace('_', ' ')} skills`}
          action={
            filter === 'all' ? (
              <Link to="/app/build" className="dash-btn dash-btn--primary">
                Build a skill
              </Link>
            ) : null
          }
        >
          {filter === 'all'
            ? 'Run an interview or capture a process to teach Brian its first skill.'
            : 'Try a different filter — nothing matches this status right now.'}
        </EmptyState>
      )}

      {skills !== null && visible.length > 0 && (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Version</th>
                <th>Last reviewed</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.id}>
                  <td className="skills-name-cell">
                    <Link to={`/app/skills/${s.id}`}>{s.name}</Link>
                    {s.trigger && <span className="skills-trigger-hint">{s.trigger}</span>}
                  </td>
                  <td>{s.owner || '—'}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td className="dash-mono">v{s.version}</td>
                  <td className="dash-mono">{fmtDate(s.last_reviewed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
