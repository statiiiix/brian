import { useReveal } from '../hooks/useReveal';
import './Problem.css';

const pains = [
  {
    n: '01',
    title: 'Your knowledge is scattered',
    body: 'Refunds, deploys, vendor payments, hiring — scattered across prompts, CLAUDE.md files, and pasted-in SOPs. One copy per agent. No versioning. No review.',
  },
  {
    n: '02',
    title: 'Agents don’t know your company',
    body: 'They can draft the refund, ship the deploy, pay the invoice — nothing stops them at your limits, or tells them when to ask a human first.',
  },
  {
    n: '03',
    title: 'So the real work never gets delegated',
    body: 'No shared judgment. No guardrails. No audit trail. “Let the agent handle it” is a bet you only make once.',
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
