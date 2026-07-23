import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import brianMark from '../../assets/brian-b-mark.svg';
import { Icon, msym } from '../../components/Icon';
import { api } from '../api';
import { readCache, writeCache } from '../queryCache';
import InterviewComposer, { SourceChip } from '../components/InterviewComposer';
import RichText from '../components/RichText';
import StatusBadge from '../components/StatusBadge';
import { interviewBrief, interviewTitle } from '../interviewTopic';
import './InterviewChat.css';

const COVERAGE_FIELDS = [
  ['trigger', 'Trigger'],
  ['inputs', 'Inputs'],
  ['principles', 'Principles'],
  ['procedure', 'Procedure'],
  ['tools', 'Tools'],
  ['hard_rules', 'Hard rules'],
  ['guardrails', 'Guardrails'],
  ['escalation_target', 'Escalation'],
  ['quality_checks', 'Quality checks'],
  ['examples', 'Examples'],
];

export default function InterviewChat() {
  const { id } = useParams();
  const [iv, setIv] = useState(() => readCache(`/api/interviews/${id}`) ?? null);
  const [answer, setAnswer] = useState('');
  const [pendingAnswer, setPendingAnswer] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [sources, setSources] = useState(() => readCache(`/api/interviews/${id}/sources`) ?? []);
  const threadRef = useRef(null);
  const answerRef = useRef(null);

  useEffect(() => {
    setIv(readCache(`/api/interviews/${id}`) ?? null);
    setSources(readCache(`/api/interviews/${id}/sources`) ?? []);
    Promise.all([
      api(`/api/interviews/${id}`),
      api(`/api/interviews/${id}/sources`).catch(() => []),
    ]).then(([interview, interviewSources]) => {
      setIv(writeCache(`/api/interviews/${id}`, interview));
      setSources(writeCache(`/api/interviews/${id}/sources`, interviewSources));
    }).catch((e) => setError(e.message));
  }, [id]);

  // Mutations invalidate the cached interview; write the response back so
  // returning to this thread does not start from an empty screen.
  function applyInterview(interview) {
    setIv(writeCache(`/api/interviews/${id}`, interview));
  }

  const scrollToEnd = useCallback(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => { scrollToEnd(); }, [iv, busy, pendingAnswer, scrollToEnd]);

  // Only a message that arrives while you are watching is revealed as it is
  // written; reopening a thread shows its history immediately.
  const [revealIndex, setRevealIndex] = useState(-1);
  const seenMessages = useRef(null);
  useEffect(() => {
    const count = iv?.messages.length ?? 0;
    if (seenMessages.current !== null && count > seenMessages.current) {
      setRevealIndex(iv.messages[count - 1].role === 'brian' ? count - 1 : -1);
    }
    seenMessages.current = count;
  }, [iv]);

  // Grow the composer with its content instead of exposing a drag handle.
  useEffect(() => {
    const el = answerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [answer]);

  async function sendContent(content) {
    // Paint the answer into the thread before the round trip — otherwise Brian
    // appears to start typing before you can see what you sent.
    setPendingAnswer(content);
    setAnswer('');
    setBusy(true);
    setError('');
    try {
      const updated = await api(`/api/interviews/${id}/messages`, {
        method: 'POST',
        body: { content },
      });
      applyInterview(updated);
      setPendingAnswer(null);
    } catch (e) {
      // Keep the optimistic bubble so the answer is not lost; Retry re-sends it.
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function send(e) {
    e?.preventDefault();
    if (!answer.trim() || busy) return;
    sendContent(answer.trim());
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(e);
    }
  }

  async function finish() {
    setBusy(true);
    setError('');
    try {
      applyInterview(await api(`/api/interviews/${id}/finish`, { method: 'POST' }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
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
      applyInterview(res.interview);
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
      applyInterview(await api(`/api/interviews/${id}/abandon`, { method: 'POST' }));
    } catch (e) {
      setError(e.message);
    }
  }

  async function resume() {
    setError('');
    try {
      applyInterview(await api(`/api/interviews/${id}/resume`, { method: 'POST' }));
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

  const componentCoverage = iv.component_coverage || Object.fromEntries(
    COVERAGE_FIELDS.map(([key]) => [key, {
      status: iv.coverage[key] ? 'defined' : 'missing', summary: null, reason: null,
    }]),
  );
  const covered = COVERAGE_FIELDS.filter(([key]) => componentCoverage[key]?.status !== 'missing').length;
  const pct = Math.round((covered / COVERAGE_FIELDS.length) * 100);
  const draft = iv.draft;
  const brief = interviewBrief(iv.topic);
  // Every component resolved (defined or explicitly not applicable). Brian may
  // still ask follow-ups, so this offers to finish rather than forcing it.
  const allCovered = iv.status === 'active'
    && COVERAGE_FIELDS.every(([key]) => componentCoverage[key]?.status !== 'missing');

  return (
    <div className="ivc">
      <header className="dash-head">
        <div>
          <p className="dash-back">
            <Link to="/app/interviews">
              <Icon path={msym.back} size={14} />
              Interviews
            </Link>
          </p>
          <h1 className="dash-title ivc-title">{interviewTitle(iv.topic)}</h1>
          <p className="dash-subtitle ivc-meta">
            <StatusBadge status={iv.status} />
            {iv.owner && <span>expert: {iv.owner}</span>}
            {iv.source_context?.documents?.length > 0 && (
              <span className="ivc-source">
                grounded in {iv.source_context.source_type}:{' '}
                {iv.source_context.documents.map((doc, index) => (
                  <span key={doc.url || index}>
                    {index > 0 && ', '}
                    {doc.url ? <a href={doc.url} target="_blank" rel="noreferrer">{doc.title}</a> : doc.title}
                  </span>
                ))}
              </span>
            )}
          </p>
          {brief.length > 0 && (
            <details className="ivc-brief">
              <summary>Interview brief</summary>
              {brief.map((line, i) => <p key={i}>{line}</p>)}
            </details>
          )}
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

      {iv.status !== 'active' && sources.length > 0 && (
        <ul className="ivc-chips ivc-chips--readonly" aria-label="Sources Brian read">
          {sources.map((source) => <SourceChip key={source.id} source={source} />)}
        </ul>
      )}

      <div className="ivc-grid">
        <section className="ivc-chat dash-card">
          <div className="ivc-thread" ref={threadRef}>
            {iv.messages.map((m, i) => (
              <div key={i} className={`ivc-msg ivc-msg--${m.role}`}>
                <span className="ivc-msg-who">
                  {m.role === 'brian' ? (
                    <>
                      <img className="ivc-msg-avatar" src={brianMark} alt="" />
                      <span>Brian</span>
                    </>
                  ) : (
                    'You'
                  )}
                </span>
                {m.role === 'brian' ? (
                  <RichText
                    className="ivc-bubble"
                    text={m.content}
                    reveal={i === revealIndex}
                    onReveal={scrollToEnd}
                  />
                ) : (
                  <p className="ivc-bubble">{m.content}</p>
                )}
              </div>
            ))}
            {pendingAnswer && (
              <div className={`ivc-msg ivc-msg--expert${busy ? ' is-sending' : ' is-failed'}`}>
                <span className="ivc-msg-who">You</span>
                <p className="ivc-bubble">{pendingAnswer}</p>
              </div>
            )}
            {busy && (
              <div className="ivc-msg ivc-msg--brian ivc-msg--thinking">
                <span className="ivc-msg-who">
                  <img className="ivc-msg-avatar" src={brianMark} alt="" />
                  <span>Brian</span>
                </span>
                <p className="ivc-bubble ivc-typing" aria-label="Brian is thinking">
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
            <InterviewComposer
              interviewId={id}
              sources={sources}
              onSourcesChange={setSources}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={onKeyDown}
              onSend={() => send()}
              canSend={!!answer.trim() && !busy}
              busy={busy}
              textareaRef={answerRef}
              onFinish={finish}
              finishDisabled={busy}
            />
          )}

          {allCovered && !result && (
            <div className="ivc-ready ivc-ready--finish" role="status">
              <span>Everything is covered ({covered}/{COVERAGE_FIELDS.length}). Keep going to refine, or wrap up now.</span>
              <button
                type="button"
                className="dash-btn dash-btn--primary"
                onClick={finish}
                disabled={busy}
              >
                Finish &amp; build the skill
              </button>
            </div>
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
                <li key={key} className={componentCoverage[key]?.status === 'not_applicable' ? 'is-na' : (componentCoverage[key]?.status === 'defined' ? 'is-covered' : '')}>
                  <span className="ivc-check" aria-hidden="true">
                    {componentCoverage[key]?.status === 'defined' && <Icon path={msym.check} size={11} />}
                    {componentCoverage[key]?.status === 'not_applicable' && '–'}
                  </span>
                  {label}
                  <span className="sr-only"> {componentCoverage[key]?.status || 'missing'}</span>
                </li>
              ))}
            </ul>
          </section>

          {draft && (
            <section className="dash-card ivc-draft">
              <h2 className="dash-h2">{iv.status === 'active' ? 'Living draft' : 'Drafted skill'}</h2>
              <dl>
                {draft.name && <><dt>Name</dt><dd>{draft.name}</dd></>}
                {draft.trigger && <><dt>Trigger</dt><dd>{draft.trigger}</dd></>}
                {draft.principles?.length > 0 && <><dt>Principles</dt><dd><ul>{draft.principles.map((principle, i) => <li key={i}>{principle}</li>)}</ul></dd></>}
                {draft.procedure && <><dt>Procedure</dt><dd><RichText text={draft.procedure} /></dd></>}
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
                {draft.quality_checks?.length > 0 && <><dt>Quality checks</dt><dd><ul>{draft.quality_checks.map((check, i) => <li key={i}>{check}</li>)}</ul></dd></>}
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

          {(iv.assumptions?.length > 0 || iv.warnings?.length > 0 || draft?.sources?.length > 0) && (
            <section className="dash-card ivc-evidence">
              <details>
                <summary>Evidence and open questions</summary>
                {draft?.sources?.length > 0 && <><h3>Sources</h3><ul>{draft.sources.map((source, i) => <li key={`${source.url || source.title}-${i}`}>{source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : source.title} <small>{source.origin}</small></li>)}</ul></>}
                {iv.assumptions?.length > 0 && <><h3>Assumptions</h3><ul>{iv.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
                {iv.warnings?.length > 0 && <><h3>Warnings</h3><ul>{iv.warnings.map((item, i) => <li key={i}>{item}</li>)}</ul></>}
              </details>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
