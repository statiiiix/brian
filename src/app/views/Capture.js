import { useState } from 'react';
import { Link } from 'react-router-dom';
import { msym } from '../../components/Icon';
import { api } from '../api';
import CaptureDecisionModal from '../components/CaptureDecisionModal';
import EmptyState from '../components/EmptyState';
import VoiceRecorder from '../components/VoiceRecorder';
import './Capture.css';
import '../components/CaptureDecisionModal.css';
import '../components/VoiceRecorder.css';

const ACTION_LABELS = {
  created_active: 'Saved and activated',
  updated_active: 'Updated existing (active)',
  created_draft: 'Draft — waiting in review',
  proposed_draft: 'Proposed update — waiting in review',
};

// Skills the brain could not place on its own. Everything else — context, and
// skills that clearly match or clearly do not — is filed without asking.
function decisionsFrom(proposals) {
  return proposals
    .map((proposal, index) => ({ proposal, index }))
    .filter(({ proposal }) => proposal.kind === 'skill' && proposal.route?.kind === 'ask')
    .map(({ proposal, index }) => ({ proposal, index, candidates: proposal.route.candidates }));
}

export default function Capture() {
  const [text, setText] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);

  async function commit(proposals, choices) {
    setBusy(true);
    setPending(null);
    try {
      const res = await api('/api/capture/commit', { method: 'POST', body: { proposals, choices } });
      setItems(res.items);
      setText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setItems(null);
    try {
      const { proposals } = await api('/api/capture/propose', { method: 'POST', body: { text } });
      const decisions = decisionsFrom(proposals);
      if (decisions.length === 0) {
        await commit(proposals, {});
        return;
      }
      setPending({ proposals, decisions });
      setBusy(false);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="capture">
      <header className="dash-head">
        <div>
          <h1 className="dash-title">Capture</h1>
          <p className="dash-subtitle">Paste notes, a decision, or a thread — Brian files the durable rules and drops the noise.</p>
        </div>
      </header>

      <form className="dash-card capture-card" onSubmit={submit}>
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
          <VoiceRecorder
            disabled={busy}
            // Spoken notes land in the box rather than submitting themselves —
            // people re-read and edit before filing.
            onTranscript={(spoken) => setText((prev) => (prev ? `${prev.trimEnd()} ${spoken}` : spoken))}
          />
          <span className="capture-hint">Filed skills wait in review — nothing goes live on its own.</span>
          <button type="submit" className="dash-btn dash-btn--primary" disabled={busy || !text.trim()}>
            {busy ? 'Capturing…' : 'Capture'}
          </button>
        </div>
      </form>

      {error && <p className="dash-error" role="alert">{error}</p>}

      {pending && (
        <CaptureDecisionModal
          decisions={pending.decisions}
          onResolve={(choices) => commit(pending.proposals, choices)}
          // Walking away files the undecided skills the way capture always has:
          // as drafts in the review queue. Nothing is lost by not choosing.
          onDismiss={() => commit(pending.proposals, {})}
        />
      )}

      {items !== null && (
        <section className="capture-results" aria-label="Capture results">
          <h2 className="dash-h2">Filed {items.length} item{items.length === 1 ? '' : 's'}</h2>
          {items.length === 0 && (
            <EmptyState icon={msym.capture} title="Nothing durable found">
              Brian read the text but found no rules or context worth keeping.
            </EmptyState>
          )}
          {items.map((item, i) => (
            <div key={i} className="dash-card capture-item" style={{ animationDelay: `${i * 45}ms` }}>
              <span className={`capture-kind capture-kind--${item.kind}`}>{item.kind}</span>
              <span className="capture-action">{ACTION_LABELS[item.action] || item.action}</span>
              <span className="capture-conf" title="Confidence">
                <span className="capture-conf-track" aria-hidden="true">
                  <span className="capture-conf-fill" style={{ width: `${Math.round(item.confidence * 100)}%` }} />
                </span>
                <span className="dash-mono">{Math.round(item.confidence * 100)}%</span>
              </span>
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
