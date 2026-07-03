import { useEffect, useState } from 'react';
import { Icon, icons } from '../components/Icon';
import './Nav.css';

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <nav className={`nav ${scrolled ? 'nav--scrolled' : ''}`}>
      <div className="nav-inner">
        <a href="#top" className="nav-logo">
          <span className="nav-logo-mark" aria-hidden="true">
            <Icon path={icons.bolt} size={13} />
          </span>
          Brian
        </a>
        <div className="nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#refusal">The refusal</a>
          <a href="#under-the-hood">Under the hood</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </div>
        <div className="nav-actions">
          <a href="/login" className="nav-login">
            Log in
          </a>
          <a href="#cta" className="btn btn--primary btn--sm">
            Get a demo
          </a>
        </div>
      </div>
    </nav>
  );
}
