import { Icon, icons } from '../components/Icon';
import { useReveal } from '../hooks/useReveal';
import './HowItWorks.css';

const steps = [
  {
    icon: icons.capture,
    step: '01',
    title: 'Capture',
    body: 'Brian files decisions and corrections from any session. Repeated corrections revise existing knowledge instead of duplicating it — the brain stays current, it doesn’t rot like a wiki.',
  },
  {
    icon: icons.search,
    step: '02',
    title: 'Retrieve',
    body: 'The agent calls find_skill and find_context — semantic search over your skills and durable facts, served from your Postgres.',
  },
  {
    icon: icons.rules,
    step: '03',
    title: 'Execute within hard rules',
    body: 'The agent follows the procedure step by step. Hard rules are non-negotiable — baked into the skill, not suggested in a prompt.',
  },
  {
    icon: icons.escalate,
    step: '04',
    title: 'Escalate & log',
    body: 'Hit a guardrail? The agent stops and hands off to the named escalation target. Every run — including human overrides — lands in the execution log.',
  },
];

export default function HowItWorks() {
  const ref = useReveal();
  return (
    <section className="section" id="how-it-works">
      <div className="section-inner reveal" ref={ref}>
        <p className="kicker">How it works</p>
        <h2 className="section-title">
          One loop, from tacit knowledge to{' '}
          <span className="gradient-text">safe execution.</span>
        </h2>
        <div className="steps">
          {steps.map((s, i) => (
            <div className="step stagger" style={{ '--i': i }} key={s.step}>
              <div className="step-head">
                <span className="step-icon">
                  <Icon path={s.icon} />
                </span>
                <span className="step-num">{s.step}</span>
              </div>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
