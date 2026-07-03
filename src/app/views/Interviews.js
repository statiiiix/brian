import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge';
import './Interviews.css';

export default function Interviews() {
  const navigate = useNavigate();
  const [interviews, setInterviews] = useState(null);
  const [topic, setTopic] = useState('');
  const [owner, setOwner] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/interviews').then(setInterviews).catch((e) => setError(e.message));
  }, []);

  async function start(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const iv = await api('/api/interviews', {
        method: 'POST',
        body: { topic, ...(owner ? { owner } : {}) },
      });
      navigate(`/app/interviews/${iv.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="interviews">
      <header className="dash-head">
        <div>
          <h1 className="dash-title">Interviews</h1>
          <p className="dash-subtitle">
            Brian interviews the person who owns a process and turns their answers into a skill.
          </p>
        </div>
      </header>

      <form className="dash-card interviews-new" onSubmit={start}>
        <div className="interviews-new-fields">
          <div className="dash-field">
            <label htmlFor="iv-topic">What process should Brian learn?</label>
            <input
              id="iv-topic"
              className="dash-input"
              placeholder="e.g. How we handle refund requests"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              required
            />
          </div>
          <div className="dash-field">
            <label htmlFor="iv-owner">Process owner (optional)</label>
            <input
              id="iv-owner"
              className="dash-input"
              placeholder="e.g. Sarah — Support lead"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
          </div>
        </div>
        <button type="submit" className="dash-btn dash-btn--primary" disabled={busy || !topic.trim()}>
          {busy ? 'Starting…' : 'Start interview'}
        </button>
      </form>

      {error && <p className="dash-error" role="alert">{error}</p>}
      {!error && interviews === null && <p className="dash-loading">Loading interviews…</p>}
      {interviews !== null && interviews.length === 0 && (
        <div className="dash-card dash-empty">
          No interviews yet. Start one above — it takes about five minutes.
        </div>
      )}
      {interviews !== null && interviews.length > 0 && (
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Questions</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {interviews.map((iv) => (
                <tr key={iv.id}>
                  <td><Link to={`/app/interviews/${iv.id}`}>{iv.topic}</Link></td>
                  <td>{iv.owner || '—'}</td>
                  <td><StatusBadge status={iv.status} /></td>
                  <td className="dash-mono">
                    {iv.messages.filter((m) => m.role === 'brian').length}
                  </td>
                  <td className="dash-mono">{new Date(iv.updated_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
