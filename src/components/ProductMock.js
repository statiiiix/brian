import './ProductMock.css';

/**
 * A static, pixel-accurate mock of Brian's app surface: the skills list with
 * the refund-handling skill open in the detail pane. Pure HTML/CSS so it
 * stays crisp at every size. Decorative — hidden from assistive tech, with
 * a text alternative on the wrapper.
 */

const skills = [
  { name: 'refund-handling', v: 'v4', status: 'live', owner: 'SA', run: '12m ago', active: true },
  { name: 'pricing-exception', v: 'v2', status: 'draft', owner: 'MK', run: '—' },
  { name: 'sev2-incident-response', v: 'v7', status: 'live', owner: 'JD', run: '3h ago' },
  { name: 'churn-save-offer', v: 'v3', status: 'live', owner: 'SA', run: '1d ago' },
  { name: 'vendor-invoice-approval', v: 'v1', status: 'flagged', owner: 'MK', run: '6d ago' },
];

export default function ProductMock() {
  return (
    <div
      className="mock"
      role="img"
      aria-label="Brian's app: a list of company skills with the refund-handling skill open, showing its trigger, hard rules, guardrails, and recent executions"
    >
      <div className="mock-chrome" aria-hidden="true">
        <div className="mock-chrome-dots">
          <span />
          <span />
          <span />
        </div>
        <div className="mock-chrome-url">app.brian.dev/skills</div>
      </div>

      <div className="mock-app" aria-hidden="true">
        {/* Sidebar */}
        <aside className="mock-side">
          <div className="mock-side-ws">
            <span className="mock-avatar mock-avatar--ws">A</span>
            <span className="mock-side-ws-name">Acme Inc</span>
          </div>
          <div className="mock-search">
            <span>Search</span>
            <kbd>⌘K</kbd>
          </div>
          <nav className="mock-nav">
            <span className="mock-nav-item mock-nav-item--active">
              Skills <em>24</em>
            </span>
            <span className="mock-nav-item">
              Context <em>61</em>
            </span>
            <span className="mock-nav-item">
              Review queue <em className="mock-badge">3</em>
            </span>
            <span className="mock-nav-item">Execution log</span>
            <span className="mock-nav-item">Escalations</span>
            <span className="mock-nav-item">Settings</span>
          </nav>
        </aside>

        {/* Skill list */}
        <div className="mock-list">
          <div className="mock-list-head">
            <span className="mock-list-title">Skills</span>
            <span className="mock-btn-new">+ New skill</span>
          </div>
          {skills.map((s) => (
            <div
              key={s.name}
              className={`mock-row ${s.active ? 'mock-row--active' : ''}`}
            >
              <div className="mock-row-main">
                <span className="mock-row-name">{s.name}</span>
                <span className="mock-row-meta">
                  {s.v} · last run {s.run}
                </span>
              </div>
              <span className={`mock-pill mock-pill--${s.status}`}>
                {s.status}
              </span>
              <span className="mock-avatar">{s.owner}</span>
            </div>
          ))}
        </div>

        {/* Detail pane */}
        <div className="mock-detail">
          <div className="mock-detail-head">
            <div>
              <div className="mock-detail-title">
                refund-handling
                <span className="mock-pill mock-pill--live">live</span>
              </div>
              <div className="mock-detail-sub">
                v4 · owned by Sara · last executed 12m ago
              </div>
            </div>
          </div>
          <div className="mock-tabs">
            <span className="mock-tab mock-tab--active">Overview</span>
            <span className="mock-tab">Executions · 128</span>
            <span className="mock-tab">Versions · 4</span>
          </div>

          <div className="mock-field">
            <span className="mock-label">Trigger</span>
            <p>Customer requests a refund on an order.</p>
          </div>

          <div className="mock-field">
            <span className="mock-label">Hard rules</span>
            <ul>
              <li>Max refund $200 without approval</li>
              <li>90-day window from delivery date</li>
            </ul>
          </div>

          <div className="mock-field">
            <span className="mock-label">Guardrails</span>
            <div className="mock-guardrail">
              <span className="mock-guardrail-if">amount &gt; $200</span>
              <span className="mock-guardrail-then">STOP → escalate to finance</span>
            </div>
            <div className="mock-guardrail">
              <span className="mock-guardrail-if">suspected fraud</span>
              <span className="mock-guardrail-then">STOP → escalate to finance</span>
            </div>
          </div>

          <div className="mock-field">
            <span className="mock-label">Recent executions</span>
            <div className="mock-exec">
              <span className="mock-exec-dot mock-exec-dot--ok" />
              ORD-1 · $120 refunded · logged · 12m ago
            </div>
            <div className="mock-exec">
              <span className="mock-exec-dot mock-exec-dot--stop" />
              ORD-2 · $350 stopped → escalated · 2h ago
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
