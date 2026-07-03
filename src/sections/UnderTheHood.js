import { useReveal } from '../hooks/useReveal';
import './UnderTheHood.css';

const tools = [
  'find_skill',
  'find_context',
  'get_skill',
  'capture',
  'log_execution',
  'get_order',
  'issue_refund',
  'create_email_draft',
  'send_email',
];

const skillJson = `{
  "name": "refund-handling",
  "version": 4,
  "trigger": "customer requests a refund",
  "procedure": ["verify order", "check window", "..."],
  "hard_rules": [
    "max refund $200 without approval",
    "90-day window from delivery"
  ],
  "guardrails": [
    "amount > $200  -> STOP, escalate",
    "suspected fraud -> STOP, escalate"
  ],
  "escalation_target": "finance@company.com",
  "owner": "sara",
  "examples": [/* worked examples */]
}`;

export default function UnderTheHood() {
  const ref = useReveal();
  return (
    <section className="section hood" id="under-the-hood">
      <div className="section-inner reveal" ref={ref}>
        <p className="kicker">Under the hood</p>
        <h2 className="section-title">For the engineer in the room.</h2>
        <p className="section-lede">
          A Node/TypeScript backend — Fastify, Supabase Postgres with pgvector —
          exposing an MCP server over stdio locally and Streamable HTTP with
          bearer tokens hosted. Any MCP-capable agent gets your company's
          judgment.
        </p>
        <div className="hood-grid">
          <div className="code-card stagger" style={{ '--i': 0 }}>
            <div className="terminal-bar">
              <span className="terminal-dot" />
              <span className="terminal-dot" />
              <span className="terminal-dot" />
              <span className="terminal-title">skill · refund-handling.json</span>
            </div>
            <pre className="code-body">
              <code>{skillJson}</code>
            </pre>
          </div>
          <div className="hood-side">
            <div className="hood-block stagger" style={{ '--i': 1 }}>
              <h3>Nine tools, one MCP server</h3>
              <div className="tool-chips">
                {tools.map((t) => (
                  <span className="chip" key={t}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="hood-block stagger" style={{ '--i': 2 }}>
              <h3>Benchmarked retrieval</h3>
              <p>
                Brian-bench: 85% top-1 skill retrieval across a 120-skill
                corpus with adversarial near-duplicates, on HNSW-indexed
                pgvector embeddings.
              </p>
            </div>
            <div className="hood-block stagger" style={{ '--i': 3 }}>
              <h3>Two knowledge types</h3>
              <p>
                <strong>Skills</strong> — executable procedures with hard
                rules, guardrails, owners, and version history.{' '}
                <strong>Context</strong> — durable facts and decisions ("demo
                days are Wednesday").
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
