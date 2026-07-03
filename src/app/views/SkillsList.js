import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge';
import './SkillsList.css';

const FILTERS = ['all', 'active', 'draft', 'needs_review', 'retired'];

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

export default function SkillsList() {
  const [skills, setSkills] = useState(null);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');

  useEffect(() => {
    const q = filter === 'all' ? '' : `?status=${filter}`;
    setSkills(null);
    api(`/api/skills${q}`).then(setSkills).catch((e) => setError(e.message));
  }, [filter]);

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
          </button>
        ))}
      </div>

      {error && <p className="dash-error" role="alert">{error}</p>}
      {!error && skills === null && <p className="dash-loading">Loading skills…</p>}
      {skills !== null && skills.length === 0 && (
        <div className="dash-card dash-empty">
          No skills here yet. Run an interview or capture a process to teach Brian.
        </div>
      )}
      {skills !== null && skills.length > 0 && (
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
              {skills.map((s) => (
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
