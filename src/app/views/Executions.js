import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { msym } from '../../components/Icon';
import { api } from '../api';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import TableSkeleton from '../components/TableSkeleton';
import './Executions.css';

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
  const [executions, setExecutions] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/executions').then(setExecutions).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="executions">
      <header className="dash-head">
        <div>
          <h1 className="dash-title">Executions</h1>
        </div>
      </header>

      {error && <p className="dash-error" role="alert">{error}</p>}
      {!error && executions === null && <TableSkeleton rows={6} />}

      {executions !== null && executions.length === 0 && (
        <EmptyState icon={msym.executions} title="No executions yet">
          Once an agent runs a skill through Brian's MCP server, every run lands here with its
          outcome.
        </EmptyState>
      )}

      {executions !== null && executions.length > 0 && (
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
              {executions.map((ex) => (
                <tr key={ex.id}>
                  <td>
                    {ex.skill_id ? (
                      <Link to={`/app/skills/${ex.skill_id}`} className="dash-mono">
                        {ex.skill_id.slice(0, 8)}…
                      </Link>
                    ) : (
                      '—'
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
