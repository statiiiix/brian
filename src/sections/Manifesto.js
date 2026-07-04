import { useReveal } from '../hooks/useReveal';
import './Manifesto.css';

export default function Manifesto() {
  const ref = useReveal();
  return (
    <section className="section manifesto" id="manifesto">
      <div className="manifesto-inner reveal" ref={ref}>
        <p className="kicker">Why we're building this</p>
        <blockquote className="manifesto-text">
          Agents got good enough to do real work in 2025. What didn't exist was
          the thing that makes delegation safe — a place where a company's
          judgment lives: its procedures, its limits, its "stop and ask a
          human" lines. Every team we talked to had rebuilt a worse version of
          it in system prompts. So we built it once, properly: versioned,
          reviewed, enforced, shared by every agent you run.
        </blockquote>
        <div className="manifesto-sig">
          <span className="manifesto-sig-avatar" aria-hidden="true">
            A
          </span>
          <div>
            <span className="manifesto-sig-name">Ahmad</span>
            <span className="manifesto-sig-role">Founder, Brian</span>
          </div>
        </div>
      </div>
    </section>
  );
}
