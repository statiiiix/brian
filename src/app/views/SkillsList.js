import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { icons } from '../../components/Icon';
import { api } from '../api';
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
  const [skills, setSkills] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/skills').then(setSkills).catch((e) => setError(e.message));
  }, []);

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
          <p className="dash-subtitle">Every process Brian knows how to run.</p>
        </div>
        <Link to="/app/interviews" className="dash-btn dash-btn--primary">
          New interview
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
          icon={icons.rules}
          title={filter === 'all' ? 'No skills yet' : `No ${filter.replace('_', ' ')} skills`}
          action={
            filter === 'all' ? (
              <Link to="/app/interviews" className="dash-btn dash-btn--primary">
                Start an interview
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
                  <td><Link to={`/app/skills/${s.id}`}>{s.name}</Link></td>
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
