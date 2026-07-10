import { useReveal } from '../hooks/useReveal';
import './FinalCTA.css';

export default function FinalCTA() {
  const ref = useReveal();
  return (
    <section className="section cta" id="cta">
      <div className="cta-inner reveal" ref={ref}>
        <h2>Delegate the work. Keep the judgment.</h2>
        <p>
          Brian gives every agent the procedures, hard rules, and escalation
          paths behind your company’s difficult decisions.
        </p>
        <div className="cta-actions">
          <a href="mailto:a7madinquiries@gmail.com" className="btn btn--primary">
            Build your first governed skill
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
