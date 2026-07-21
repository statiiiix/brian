import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { msym } from '../../components/Icon';
import { api, apiForm } from '../api';
import { useCachedQuery } from '../useCachedQuery';
import InterviewSources from '../components/InterviewSources';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import TableSkeleton from '../components/TableSkeleton';
import { interviewTitle } from '../interviewTopic';
import './Interviews.css';

export default function Interviews() {
  const navigate = useNavigate();
  const {
    data: interviews,
    setData: setInterviews,
    error,
    setError,
  } = useCachedQuery('/api/interviews');
  const [topic, setTopic] = useState('');
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [notionSelection, setNotionSelection] = useState(null);

  async function start(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const hasSources = pendingFiles.length > 0 || notionSelection;
      const iv = await api('/api/interviews', {
        method: 'POST',
        body: {
          topic,
          ...(owner ? { owner } : {}),
          ...(hasSources ? { defer_start: true } : {}),
          ...(notionSelection ? { source: { connector: 'notion', selection: notionSelection } } : {}),
        },
      });
      if (hasSources) {
        for (const file of pendingFiles) {
          const form = new FormData();
          form.set('file', file);
          await apiForm(`/api/interviews/${iv.id}/sources/upload`, form);
        }
        await api(`/api/interviews/${iv.id}/start`, { method: 'POST' });
      }
      navigate(`/app/interviews/${iv.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function resume(id) {
    setError('');
    try {
      const updated = await api(`/api/interviews/${id}/resume`, { method: 'POST' });
      setInterviews((list) => (list || []).map((iv) => (iv.id === id ? updated : iv)));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="interviews">
      <header className="dash-head">
        <div>
          <h1 className="dash-title">Interviews</h1>
          <p className="dash-subtitle">Five minutes of questions turns tribal knowledge into a reviewable, runnable skill.</p>
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
        <div className="interviews-source-row">
          <InterviewSources
            pendingFiles={pendingFiles}
            onPendingFilesChange={setPendingFiles}
            notionSelection={notionSelection}
            onNotionSelectionChange={setNotionSelection}
            disabled={busy}
          />
        </div>
        <button type="submit" className="dash-btn dash-btn--primary" disabled={busy || !topic.trim()}>
          {busy ? 'Starting…' : 'Start interview'}
        </button>
      </form>

      {error && <p className="dash-error" role="alert">{error}</p>}
      {!error && interviews === null && <TableSkeleton rows={4} />}

      {interviews !== null && interviews.length === 0 && (
        <EmptyState icon={msym.interviews} title="No interviews yet">
          Start one above — five minutes of questions turns tribal knowledge into a runnable skill.
        </EmptyState>
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
                  <td><Link to={`/app/interviews/${iv.id}`}>{interviewTitle(iv.topic)}</Link></td>
                  <td>{iv.owner || '—'}</td>
                  <td>
                    <StatusBadge status={iv.status} />
                    {iv.status === 'abandoned' && (
                      <button
                        type="button"
                        className="dash-btn dash-btn--ghost interviews-resume"
                        onClick={() => resume(iv.id)}
                      >
                        Resume
                      </button>
                    )}
                  </td>
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
