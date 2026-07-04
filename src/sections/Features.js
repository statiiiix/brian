import { Icon, icons } from '../components/Icon';
import { useReveal } from '../hooks/useReveal';
import './Features.css';

const features = [
  {
    icon: icons.shield,
    title: 'Graduated autonomy',
    body: 'Captured knowledge only goes live when the classifier is confident and every tool it touches is reversible. Otherwise, it parks as a draft.',
  },
  {
    icon: icons.review,
    title: 'Human review where it counts',
    body: 'Anything touching an irreversible tool — like send_email — waits for a human. Auto-extracted skills never go live unreviewed.',
  },
  {
    icon: icons.log,
    title: 'Execution log',
    body: 'Every run is logged: what the agent did, which skill version it followed, every human override along the way.',
  },
  {
    icon: icons.refresh,
    title: 'Self-updating knowledge',
    body: 'Repeated corrections revise skills instead of duplicating them. Stale or override-heavy skills get flagged to their owner.',
  },
  {
    icon: icons.escalate,
    title: 'Escalation built in',
    body: 'Every skill names its escalation target. When a guardrail trips, the handoff has somewhere real to go.',
  },
  {
    icon: icons.versions,
    title: 'Versioned, owned skills',
    body: 'Skills carry owners, version history, and staleness detection — process knowledge with an accountable human attached.',
  },
];

export default function Features() {
  const ref = useReveal();
  return (
    <section className="section" id="features">
      <div className="section-inner reveal" ref={ref}>
        <p className="kicker">What you get</p>
        <h2 className="section-title">
          The rulebook and memory every agent shares.
        </h2>
        <div className="hairline-grid feature-grid">
          {features.map((f, i) => (
            <div className="feature stagger" style={{ '--i': i }} key={f.title}>
              <span className="feature-icon">
                <Icon path={f.icon} size={18} />
              </span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
