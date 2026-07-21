import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { msym } from '../../components/Icon';
import { useCachedQuery } from '../useCachedQuery';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import TableSkeleton from '../components/TableSkeleton';
import './Executions.css';

const OUTCOME_FILTERS = ['all', 'completed', 'escalated', 'failed'];

function fmtWhen(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function Executions() {
  const { data: executions, error } = useCachedQuery('/api/executions');
  const { data: skills } = useCachedQuery('/api/skills');
  const [filter, setFilter] = useState('all');

  const skillNames = useMemo(() => {
    const map = {};
    for (const s of skills || []) map[s.id] = s.name;
    return map;
  }, [skills]);

  const counts = useMemo(() => {
    const c = { all: executions?.length || 0 };
    for (const ex of executions || []) c[ex.outcome] = (c[ex.outcome] || 0) + 1;
    return c;
  }, [executions]);

  const visible = useMemo(
    () => (executions || []).filter((ex) => filter === 'all' || ex.outcome === filter),
    [executions, filter]
  );

  return (
    <div className="executions">
      <header className="dash-head">
        <div>
          <h1 className="dash-title">Runs</h1>
          <p className="dash-subtitle">Every governed execution an agent makes through Brian — including safe refusals and escalations.</p>
        </div>
      </header>

      {error && <p className="dash-error" role="alert">{error}</p>}
      {!error && executions === null && <TableSkeleton rows={6} />}

      {executions !== null && executions.length > 0 && (
        <div className="dash-chips" role="group" aria-label="Filter by outcome">
          {OUTCOME_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              className={`dash-chip executions-chip ${filter === f ? 'is-active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'All' : f}
              <span className="executions-chip-count">{counts[f] || 0}</span>
            </button>
          ))}
        </div>
      )}

      {executions !== null && executions.length === 0 && (
        <EmptyState icon={msym.executions} title="No runs yet">
          Once an agent runs a skill through Brian's MCP server, every run lands here with its
          outcome.
        </EmptyState>
      )}

      {executions !== null && executions.length > 0 && visible.length === 0 && (
        <EmptyState icon={msym.executions} title={`No ${filter} runs`}>
          Try a different outcome filter — nothing matches right now.
        </EmptyState>
      )}

      {visible.length > 0 && (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Outcome</th>
                <th>Override</th>
                <th>Version</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((ex) => (
                <tr key={ex.id}>
                  <td>
                    {ex.skill_id ? (
                      skillNames[ex.skill_id] ? (
                        <Link to={`/app/skills/${ex.skill_id}`}>{skillNames[ex.skill_id]}</Link>
                      ) : (
                        <Link to={`/app/skills/${ex.skill_id}`} className="dash-mono">
                          {ex.skill_id.slice(0, 8)}…
                        </Link>
                      )
                    ) : (
                      <span className="executions-unmatched">Unmatched task</span>
                    )}
                  </td>
                  <td>{ex.outcome ? <StatusBadge status={ex.outcome} /> : '—'}</td>
                  <td>
                    {ex.human_override ? (
                      <span className="executions-override">Human override</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="dash-mono">{ex.skill_version ? `v${ex.skill_version}` : '—'}</td>
                  <td className="dash-mono">{fmtWhen(ex.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
