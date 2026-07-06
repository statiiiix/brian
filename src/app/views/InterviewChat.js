import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon, icons } from '../../components/Icon';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge';
import './InterviewChat.css';

const COVERAGE_FIELDS = [
  ['trigger', 'Trigger'],
  ['inputs', 'Inputs'],
  ['procedure', 'Procedure'],
  ['hard_rules', 'Hard rules'],
  ['guardrails', 'Guardrails'],
  ['escalation_target', 'Escalation'],
  ['examples', 'Examples'],
];

export default function InterviewChat() {
  const { id } = useParams();
  const [iv, setIv] = useState(null);
  const [answer, setAnswer] = useState('');
  const [pendingAnswer, setPendingAnswer] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const threadRef = useRef(null);

  useEffect(() => {
    api(`/api/interviews/${id}`).then(setIv).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [iv, busy]);

  async function sendContent(content) {
    setBusy(true);
    setError('');
    try {
      const updated = await api(`/api/interviews/${id}/messages`, {
        method: 'POST',
        body: { content },
      });
      setIv(updated);
      setPendingAnswer(null);
      setAnswer('');
    } catch (e) {
      setPendingAnswer(content);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function send(e) {
    e.preventDefault();
    if (!answer.trim() || busy) return;
    sendContent(answer.trim());
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(e);
    }
  }

  async function approve(activate) {
    setBusy(true);
    setError('');
    try {
      const res = await api(`/api/interviews/${id}/approve`, {
        method: 'POST',
        body: { activate },
      });
      setIv(res.interview);
      setResult({ skill: res.skill, activated: activate });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function abandon() {
    if (!window.confirm('Abandon this interview? The conversation is kept but Brian stops asking.')) return;
    try {
      setIv(await api(`/api/interviews/${id}/abandon`, { method: 'POST' }));
    } catch (e) {
      setError(e.message);
    }
  }

  async function resume() {
    setError('');
    try {
      setIv(await api(`/api/interviews/${id}/resume`, { method: 'POST' }));
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && !iv) return <p className="dash-error" role="alert">{error}</p>;
  if (!iv) {
    return (
      <div className="dash-skeleton" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="dash-skeleton-row">
            <span className="dash-skeleton-bar" style={{ width: `${55 - i * 12}%` }} />
          </div>
        ))}
      </div>
    );
  }

  const covered = COVERAGE_FIELDS.filter(([k]) => iv.coverage[k]).length;
  const pct = Math.round((covered / COVERAGE_FIELDS.length) * 100);
  const draft = iv.draft;

  return (
    <div className="ivc">
      <header className="dash-head">
        <div>
          <p className="dash-back">
            <Link to="/app/interviews">
              <Icon path={icons.arrowLeft} size={14} />
              Interviews
            </Link>
          </p>
          <h1 className="dash-title">{iv.topic}</h1>
          <p className="dash-subtitle ivc-meta">
            <StatusBadge status={iv.status} />
            {iv.owner && <span>expert: {iv.owner}</span>}
          </p>
        </div>
        {iv.status === 'active' && (
          <button type="button" className="dash-btn dash-btn--ghost" onClick={abandon}>
            Abandon
          </button>
        )}
        {iv.status === 'abandoned' && (
          <button type="button" className="dash-btn dash-btn--primary" onClick={resume}>
            Resume
          </button>
        )}
      </header>

      <div className="ivc-grid">
        <section className="ivc-chat dash-card">
          <div className="ivc-thread" ref={threadRef}>
            {iv.messages.map((m, i) => (
              <div key={i} className={`ivc-msg ivc-msg--${m.role}`}>
                <span className="ivc-msg-who">
                  {m.role === 'brian' && (
                    <span className="ivc-msg-avatar" aria-hidden="true">
                      <Icon path={icons.bolt} size={9} />
                    </span>
                  )}
                  {m.role === 'brian' ? 'Brian' : 'You'}
                </span>
                <p>{m.content}</p>
              </div>
            ))}
            {busy && (
              <div className="ivc-msg ivc-msg--brian">
                <span className="ivc-msg-who">
                  <span className="ivc-msg-avatar" aria-hidden="true">
                    <Icon path={icons.bolt} size={9} />
                  </span>
                  Brian
                </span>
                <p className="ivc-typing" aria-label="Brian is thinking">
                  <span /><span /><span />
                </p>
              </div>
            )}
          </div>

          {error && iv.status === 'active' && (
            <div className="dash-error ivc-retry" role="alert">
              <span>{error}</span>
              {pendingAnswer && (
                <button
                  type="button"
                  className="dash-btn dash-btn--ghost"
                  onClick={() => sendContent(pendingAnswer)}
                  disabled={busy}
                >
                  Retry
                </button>
              )}
            </div>
          )}

          {iv.status === 'active' && (
            <form className="ivc-input" onSubmit={send}>
              <label htmlFor="ivc-answer" className="sr-only">Your answer</label>
              <textarea
                id="ivc-answer"
                className="dash-textarea"
                rows={2}
                placeholder="Answer in plain language — Brian asks the follow-ups."
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={busy}
              />
              <button
                type="submit"
                className="dash-btn dash-btn--primary ivc-send"
                disabled={busy || !answer.trim()}
                aria-label="Send answer"
              >
                <Icon path={icons.send} size={16} />
              </button>
            </form>
          )}

          {iv.status === 'ready' && draft && !result && (
            <div className="ivc-ready" role="status">
              Brian has everything it needs — review the draft on the right and approve it.
            </div>
          )}

          {result && (
            <div className="ivc-done" role="status">
              {result.activated
                ? 'Skill is live. Agents can retrieve and run it now. '
                : 'Saved as a draft in the review queue. '}
              <Link to={`/app/skills/${result.skill.id}`}>View skill →</Link>
            </div>
          )}
        </section>

        <aside className="ivc-rail">
          <section className="dash-card">
            <div className="ivc-coverage-head">
              <h2 className="dash-h2">Coverage</h2>
              <span className="ivc-progress dash-mono">{covered}/{COVERAGE_FIELDS.length}</span>
            </div>
            <div
              className="ivc-progress-track"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Interview coverage"
            >
              <span className="ivc-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <ul className="ivc-coverage">
              {COVERAGE_FIELDS.map(([key, label]) => (
                <li key={key} className={iv.coverage[key] ? 'is-covered' : ''}>
                  <span className="ivc-check" aria-hidden="true">
                    {iv.coverage[key] && <Icon path={icons.check} size={11} />}
                  </span>
                  {label}
                  <span className="sr-only">{iv.coverage[key] ? ' covered' : ' not yet covered'}</span>
                </li>
              ))}
            </ul>
          </section>

          {draft && (iv.status === 'ready' || iv.status === 'completed') && (
            <section className="dash-card ivc-draft">
              <h2 className="dash-h2">Drafted skill</h2>
              <dl>
                <dt>Name</dt>
                <dd>{draft.name}</dd>
                <dt>Trigger</dt>
                <dd>{draft.trigger}</dd>
                <dt>Procedure</dt>
                <dd className="ivc-pre">{draft.procedure}</dd>
                {draft.hard_rules?.length > 0 && (
                  <>
                    <dt>Hard rules</dt>
                    <dd><ul>{draft.hard_rules.map((r, i) => <li key={i}>{r}</li>)}</ul></dd>
                  </>
                )}
                {draft.guardrails?.length > 0 && (
                  <>
                    <dt>Guardrails</dt>
                    <dd><ul>{draft.guardrails.map((g, i) => <li key={i}>{g}</li>)}</ul></dd>
                  </>
                )}
                {draft.escalation_target && (
                  <>
                    <dt>Escalates to</dt>
                    <dd>{draft.escalation_target}</dd>
                  </>
                )}
              </dl>
              {iv.status === 'ready' && !result && (
                <div className="ivc-draft-actions">
                  <button type="button" className="dash-btn dash-btn--ghost" onClick={() => approve(false)} disabled={busy}>
                    Save as draft
                  </button>
                  <button type="button" className="dash-btn dash-btn--primary" onClick={() => approve(true)} disabled={busy}>
                    Approve &amp; activate
                  </button>
                </div>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
