import ProductMock from '../components/ProductMock';
import { useReveal } from '../hooks/useReveal';
import './TopFold.css';

export default function TopFold() {
  const revealRef = useReveal();
  return (
    <header className="hero" id="top">
      <div className="hero-glow" aria-hidden="true" />
      <div className="hero-inner reveal" ref={revealRef}>
        <div className="hero-copy">
          <p className="hero-eyebrow">
            <span className="hero-eyebrow-dot" aria-hidden="true" />
            Now onboarding design partners
          </p>
          <h1 className="hero-title">
            AI agents that follow
            <br />
            your company's rules.
          </h1>
          <p className="hero-sub">
            Brian turns your processes into executable skills agents follow —
            and stops and escalates to a human when they shouldn't act. One MCP
            server; every agent gets your company's judgment.
          </p>
          <div className="hero-ctas">
            <a href="#cta" className="btn btn--primary">
              Get a demo
            </a>
            <a href="#how-it-works" className="btn btn--ghost">
              How it works
            </a>
          </div>
        </div>
        <div className="hero-mock stagger" style={{ '--i': 2 }}>
          <ProductMock />
        </div>
      </div>
    </header>
  );
}
