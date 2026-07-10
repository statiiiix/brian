import { useEffect, useState } from 'react';
import brianWordmark from '../assets/brian-wordmark.webp';
import './PillNav.css';

export default function PillNav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className={`pnav ${scrolled ? 'pnav--scrolled' : ''}`} aria-label="Main">
      <div className="pnav-pill">
        <a href="#top" className="pnav-logo">
          <img className="pnav-logo-wordmark" src={brianWordmark} alt="Brian" />
        </a>
        <div className="pnav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#refusal">The refusal</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </div>
        <div className="pnav-actions">
          <a href="/login" className="pnav-login">
            Log in
          </a>
          <a href="#cta" className="pnav-cta">
            Get a demo
          </a>
        </div>
      </div>
    </nav>
  );
}
