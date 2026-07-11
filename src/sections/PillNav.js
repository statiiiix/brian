import { useEffect, useState } from 'react';
import brianWordmark from '../assets/brian-wordmark.webp';
import { Icon } from '../components/Icon';
import './PillNav.css';

const navItems = [
  { label: 'Why Brian', href: '#agent-guardrails', icon: 'verified_user' },
  { label: 'Pricing', href: '#pricing', icon: 'sell' },
  { label: 'FAQ', href: '#faq', icon: 'help' },
];

export default function PillNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const closeMenu = () => setOpen(false);

  return (
    <nav
      className={`pnav ${scrolled ? 'pnav--scrolled' : ''} ${open ? 'pnav--open' : ''}`}
      aria-label="Main"
    >
      {open && <button className="pnav-backdrop" type="button" onClick={closeMenu} aria-label="Close menu" />}

      <div className="pnav-pill">
        <div className="pnav-bar">
          <span className="pnav-balance" aria-hidden="true" />
          <a href="#top" className="pnav-logo" onClick={closeMenu}>
            <img className="pnav-logo-wordmark" src={brianWordmark} alt="Brian" />
          </a>
          <button
            className="pnav-menu-toggle"
            type="button"
            aria-expanded={open}
            aria-controls="pnav-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((current) => !current)}
          >
            <span />
            <span />
          </button>
        </div>

        <div className="pnav-menu" id="pnav-menu" aria-hidden={!open}>
          <div className="pnav-menu-inner">
            <div className="pnav-menu-links">
              {navItems.map((item) => (
                <a key={item.href} href={item.href} onClick={closeMenu} tabIndex={open ? 0 : -1}>
                  <span className="pnav-menu-label">
                    <Icon path={item.icon} size={19} />
                    {item.label}
                  </span>
                  <Icon path="north_east" size={18} />
                </a>
              ))}
            </div>

            <div className="pnav-menu-actions">
              <a href="#cta" className="pnav-cta" onClick={closeMenu} tabIndex={open ? 0 : -1}>
                <span>Join waitlist</span>
                <Icon path="arrow_forward" size={20} />
              </a>
              <a href="/login" className="pnav-login" tabIndex={open ? 0 : -1}>
                <span className="pnav-menu-label">
                  <Icon path="login" size={19} />
                  Log in
                </span>
                <Icon path="north_east" size={18} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
