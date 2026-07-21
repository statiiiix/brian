import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, icons, msym } from '../../components/Icon';
import { api } from '../api';
import './BuildSkill.css';

const MODES = [
  { id: 'high-stakes', title: 'High-stakes decisions', description: 'Finance approvals, access changes, legal/compliance, or anything with real downside.', icon: icons.shield },
  { id: 'incidents', title: 'Incidents & operations', description: 'Production changes, outages, vendor actions, or escalation-heavy runbooks.', icon: icons.escalate },
  { id: 'team-process', title: 'Team process', description: 'Hiring, onboarding, handoffs, approvals, and recurring work with many exceptions.', icon: icons.rules },
  { id: 'customer', title: 'Customer decisions', description: 'Support, refunds, discounts, account changes, and other customer-facing actions.', icon: icons.review },
];

const GUARDRAIL_PROMPTS = {
  'high-stakes': 'Ask about money, authority limits, required evidence, approval owners, and what must never happen automatically.',
  incidents: 'Ask about blast radius, rollback conditions, incident severity, communication rules, and when to wake a human.',
  'team-process': 'Ask about exceptions, ownership, deadlines, sensitive information, and the handoff point to a human.',
  customer: 'Ask about promises, refunds or credits, account permissions, tone, and cases that require escalation.',
};

export default function BuildSkill() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('high-stakes');
  const [goal, setGoal] = useState('');
  const [owner, setOwner] = useState('');
  const [context, setContext] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = MODES.find((item) => item.id === mode);

  async function start(e) {
    e.preventDefault();
    if (!goal.trim()) return;
    setBusy(true);
    setError('');
    // First line is the human-readable title; the rest is the brief that steers
    // the interview engine. See src/app/interviewTopic.js.
    const topic = [
      goal.trim(),
      `Risk profile: ${selected.title}.`,
      `Interview emphasis: ${GUARDRAIL_PROMPTS[mode]}`,
      context.trim() ? `Existing notes or source context: ${context.trim()}` : '',
    ].filter(Boolean).join('\n');

    try {
      const interview = await api('/api/interviews', { method: 'POST', body: { topic, ...(owner.trim() ? { owner: owner.trim() } : {}) } });
      navigate(`/app/interviews/${interview.id}`);
    } catch (e2) {
      setError(e2.message);
      setBusy(false);
    }
  }

  return (
    <div className="build-skill">
      <div className="dash-back"><Link to="/app"><Icon path={msym.back} size={15} /> Back to overview</Link></div>
      <header className="dash-head build-skill-head">
        <div>
          <h1 className="dash-title">Build a skill</h1>
          <p className="dash-subtitle">Tell Brian what's at stake — it interviews the owner and drafts the governed procedure.</p>
        </div>
      </header>

      {error && <p className="dash-error" role="alert">{error}</p>}

      <form className="build-skill-layout" onSubmit={start}>
        <div className="build-skill-form">
          <section className="dash-card build-step">
            <div className="build-step-number">01</div>
            <div className="build-step-content">
              <h2>What could go wrong if an agent guessed?</h2>
              <div className="build-mode-grid">
                {MODES.map((item) => (
                  <button type="button" key={item.id} className={`build-mode ${mode === item.id ? 'is-selected' : ''}`} onClick={() => setMode(item.id)} aria-pressed={mode === item.id}>
                    <span className="build-mode-icon"><Icon path={item.icon} size={18} /></span>
                    <span><strong>{item.title}</strong><small>{item.description}</small></span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="dash-card build-step">
            <div className="build-step-number">02</div>
            <div className="build-step-content">
              <h2>What should Brian help an agent navigate?</h2>
              <div className="dash-field">
                <label htmlFor="build-goal">Process or decision</label>
                <input id="build-goal" className="dash-input" placeholder="e.g. Approve production access requests without creating a security gap" value={goal} onChange={(e) => setGoal(e.target.value)} required />
              </div>
              <div className="build-two-fields">
                <div className="dash-field">
                  <label htmlFor="build-owner">Who owns the judgment?</label>
                  <input id="build-owner" className="dash-input" placeholder="e.g. Maya — Head of Security" value={owner} onChange={(e) => setOwner(e.target.value)} />
                </div>
                <div className="dash-field">
                  <label htmlFor="build-context">Existing notes (optional)</label>
                  <input id="build-context" className="dash-input" placeholder="Paste a policy, rule, or constraint" value={context} onChange={(e) => setContext(e.target.value)} />
                </div>
              </div>
            </div>
          </section>

          <button type="submit" className="dash-btn dash-btn--primary build-submit" disabled={busy || !goal.trim()}>
            <Icon path={msym.build} size={16} />
            {busy ? 'Preparing interview…' : 'Start the guarded interview'}
          </button>
        </div>

        <aside className="dash-card build-skill-preview">
          <div className="build-preview-icon"><Icon path={icons.shield} size={22} /></div>
          <h2>Skill output</h2>
          <div className="build-preview-list">
            <div><Icon path={msym.check} size={15} /> Inputs and required evidence</div>
            <div><Icon path={msym.check} size={15} /> Step-by-step decision procedure</div>
            <div><Icon path={msym.check} size={15} /> Hard rules and tool permissions</div>
            <div><Icon path={msym.check} size={15} /> Stop conditions and escalation target</div>
            <div><Icon path={msym.check} size={15} /> Worked examples and version history</div>
          </div>
          <p className="build-preview-note"><strong>Nothing goes live on its own.</strong> Every drafted skill waits in the review queue until a human approves it.</p>
        </aside>
      </form>
    </div>
  );
}
