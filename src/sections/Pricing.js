import { useReveal } from '../hooks/useReveal';
import './Pricing.css';

export default function Pricing() {
  const ref = useReveal();
  return (
    <section className="section" id="pricing">
      <div className="section-inner reveal" ref={ref}>
        <p className="kicker">Pricing</p>
        <h2 className="section-title">Simple while we're early.</h2>
        <div className="pricing-grid">
          <div className="pricing-card stagger" style={{ '--i': 0 }}>
            <h3>Early access</h3>
            <p className="pricing-price">
              Free <span>while in beta</span>
            </p>
            <ul>
              <li>The full MCP server — all nine tools</li>
              <li>Unlimited skills and context entries</li>
              <li>Execution log and escalations</li>
              <li>Works with Claude Desktop, Claude Code, or your own agent</li>
            </ul>
            <a href="#cta" className="btn btn--ghost">
              Join early access
            </a>
          </div>
          <div className="pricing-card pricing-card--partner stagger" style={{ '--i': 1 }}>
            <h3>
              Design partner <span className="pill pill--stop">5 spots</span>
            </h3>
            <p className="pricing-price">
              Let's talk <span>hands-on onboarding</span>
            </p>
            <ul>
              <li>We author your first 10 skills with you</li>
              <li>Guardrail and escalation design for your real processes</li>
              <li>Direct line to the founder</li>
              <li>Locked-in pricing when we charge</li>
            </ul>
            <a href="mailto:a7madinquiries@gmail.com" className="btn btn--primary">
              Become a partner
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
