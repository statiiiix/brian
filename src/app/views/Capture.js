import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import './Capture.css';

const ACTION_LABELS = {
  created_active: 'Saved and activated',
  updated_active: 'Updated existing (active)',
  created_draft: 'Draft — waiting in review',
  proposed_draft: 'Proposed update — waiting in review',
};

export default function Capture() {
  const [text, setText] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setItems(null);
    try {
      const res = await api('/api/capture', { method: 'POST', body: { text } });
      setItems(res.items);
      setText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="capture">
      <header className="dash-head">
        <div>
          <h1 className="dash-title">Capture</h1>
          <p className="dash-subtitle">
            Paste anything — meeting notes, a Slack thread, a process doc. Brian files it as
            skills and context.
          </p>
        </div>
      </header>

      <form className="dash-card" onSubmit={submit}>
        <div className="dash-field">
          <label htmlFor="capture-text">Knowledge to capture</label>
          <textarea
            id="capture-text"
            className="dash-textarea capture-textarea"
            rows={10}
            placeholder={'e.g. "From today\'s support sync: we now refund up to $250 without approval, but never past 90 days…"'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            required
          />
        </div>
        <div className="capture-submit">
          <button type="submit" className="dash-btn dash-btn--primary" disabled={busy || !text.trim()}>
            {busy ? 'Capturing…' : 'Capture'}
          </button>
        </div>
      </form>

      {error && <p className="dash-error" role="alert">{error}</p>}

      {items !== null && (
        <section className="capture-results" aria-label="Capture results">
          <h2 className="capture-h2">Filed {items.length} item{items.length === 1 ? '' : 's'}</h2>
          {items.length === 0 && (
            <div className="dash-card dash-empty">Brian found nothing durable to keep from that text.</div>
          )}
          {items.map((item, i) => (
            <div key={i} className="dash-card capture-item">
              <span className={`capture-kind capture-kind--${item.kind}`}>{item.kind}</span>
              <span className="capture-action">{ACTION_LABELS[item.action] || item.action}</span>
              <span className="dash-mono capture-conf">{Math.round(item.confidence * 100)}%</span>
              {item.kind === 'skill' && (
                <Link className="capture-link" to={`/app/skills/${item.id}`}>View skill →</Link>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
