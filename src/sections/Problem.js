import { useReveal } from '../hooks/useReveal';
import './Problem.css';

const pains = [
  {
    n: '01',
    title: 'System prompts are duct tape',
    body: 'Hand-written prompts, CLAUDE.md files, SOPs pasted into chats — per agent, per tool. No versioning, no review, no enforcement.',
  },
  {
    n: '02',
    title: 'Agents don’t know your rules',
    body: 'Support replies, refunds, triage — agents can do the work. But nothing binds them to this company’s limits, exceptions, and approvals.',
  },
  {
    n: '03',
    title: 'So nobody actually delegates',
    body: 'Without guardrails, escalation, and an audit trail, “let the agent handle it” is a risk no operator signs off on.',
  },
];

export default function Problem() {
  const ref = useReveal();
  return (
    <section className="section problem">
      <div className="section-inner reveal" ref={ref}>
        <p className="kicker">The problem</p>
        <h2 className="section-title">
          Every company is duct-taping this today.
        </h2>
        <div className="problem-grid">
          {pains.map((p, i) => (
            <div className="problem-item stagger" style={{ '--i': i }} key={p.n}>
              <span className="problem-num">{p.n}</span>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
