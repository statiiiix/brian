import { useReveal } from '../hooks/useReveal';
import './FAQ.css';

const faqs = [
  {
    q: 'How is this different from Mem0, Zep, or built-in agent memory?',
    a: 'Those store what an agent remembers. Brian governs what an agent is allowed to do. Skills carry hard rules, guardrails, and escalation targets — enforcement and audit, not just recall. Memory is a feature here; safe delegation is the product.',
  },
  {
    q: 'What happens when a skill is wrong or goes stale?',
    a: 'Corrections captured from any session revise the existing skill instead of duplicating it, and every revision is versioned. Skills that get overridden repeatedly, or haven’t been touched while the company changed around them, are flagged to their owner for review.',
  },
  {
    q: 'Can auto-extracted knowledge go live without review?',
    a: 'No. Captured knowledge goes live automatically only when the classifier is confident and every tool the skill uses is registered as reversible. Anything touching an irreversible tool — like sending email — parks as a draft until a human approves it.',
  },
  {
    q: 'Why build on MCP?',
    a: 'MCP standardized how agents connect to tools. That means one Brian server — stdio locally, Streamable HTTP with bearer tokens hosted — works with Claude Desktop, Claude Code, Cursor, or your own agent, with no per-agent integration work.',
  },
  {
    q: 'What does the agent actually see at runtime?',
    a: 'It calls find_skill and find_context — semantic search over pgvector embeddings in your Postgres. It gets back the procedure, hard rules, and guardrails for the matching skill, executes within them, and writes the run to the execution log.',
  },
  {
    q: 'Is this "chat with your docs"?',
    a: 'No. Brian is not RAG over documents and not a knowledge base with a chat window. It stores executable procedures with decision logic — built so an agent can do the work, not summarize how the work is done.',
  },
];

export default function FAQ() {
  const ref = useReveal();
  return (
    <section className="section" id="faq">
      <div className="section-inner reveal" ref={ref}>
        <p className="kicker">FAQ</p>
        <h2 className="section-title">The questions we always get.</h2>
        <div className="faq-list">
          {faqs.map((f, i) => (
            <details className="faq-item stagger" style={{ '--i': i }} key={f.q}>
              <summary>
                {f.q}
                <span className="faq-plus" aria-hidden="true" />
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
