import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge';
import './Executions.css';

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
          <p className="dash-subtitle">
            Every time an agent ran a skill — including when it refused and escalated.
          </p>
        </div>
      </header>

      {error && <p className="dash-error" role="alert">{error}</p>}
      {!error && executions === null && <p className="dash-loading">Loading executions…</p>}
      {executions !== null && executions.length === 0 && (
        <div className="dash-card dash-empty">
          No executions logged yet. Once an agent runs a skill through Brian's MCP server,
          every run lands here.
        </div>
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
                  <td className="dash-mono">{new Date(ex.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
