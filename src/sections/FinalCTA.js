import { useReveal } from '../hooks/useReveal';
import './FinalCTA.css';

export default function FinalCTA() {
  const ref = useReveal();
  return (
    <section className="section cta" id="cta">
      <div className="cta-inner reveal" ref={ref}>
        <h2>Stop pasting SOPs into system prompts.</h2>
        <p>
          Give every agent at your company the same judgment: procedures, hard
          rules, and guardrails — with escalation when they hit a limit.
        </p>
        <div className="cta-actions">
          <a href="mailto:a7madinquiries@gmail.com" className="btn btn--primary">
            Get a demo
          </a>
          <a href="#under-the-hood" className="btn btn--ghost">
            Read the technical bits
          </a>
        </div>
        <p className="cta-note">
          Live demo against a real database — including the part where the
          agent tells the founder no.
        </p>
      </div>
    </section>
  );
}
