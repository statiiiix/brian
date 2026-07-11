import { useState } from 'react';
import { useReveal } from '../hooks/useReveal';
import './Pricing.css';

const WAITLIST_URL = process.env.REACT_APP_WAITLIST_URL;

export default function Pricing() {
  const ref = useReveal();
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    if (data.get('website')) return;

    if (!WAITLIST_URL) {
      setStatus('error');
      setMessage('Signups are being connected. Please try again shortly.');
      return;
    }

    setStatus('submitting');
    setMessage('');

    try {
      await fetch(WAITLIST_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          name: data.get('name'),
          email: data.get('email'),
          company: data.get('company'),
          source: window.location.href,
        }),
      });

      form.reset();
      setStatus('success');
      setMessage("You're on the list. We'll be in touch soon.");
    } catch (error) {
      setStatus('error');
      setMessage('Something went wrong. Please try again.');
    }
  }

  return (
    <section className="section" id="pricing">
      <div className="section-inner reveal" ref={ref}>
        <p className="kicker">Coming soon</p>
        <div className="pricing-coming-soon">
          <div className="pricing-copy">
            <h2 className="section-title">Brian is coming soon.</h2>
            <p>
              Join the list to be among the first to bring governed skills,
              guardrails, and company judgment to your AI agents.
            </p>
          </div>

          <form className="waitlist-form" onSubmit={handleSubmit}>
            <div className="waitlist-field">
              <label htmlFor="waitlist-name">Name</label>
              <input
                id="waitlist-name"
                name="name"
                type="text"
                autoComplete="name"
                placeholder="Your name"
                required
              />
            </div>
            <div className="waitlist-field">
              <label htmlFor="waitlist-email">Email</label>
              <input
                id="waitlist-email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                required
              />
            </div>
            <div className="waitlist-field">
              <label htmlFor="waitlist-company">Company</label>
              <input
                id="waitlist-company"
                name="company"
                type="text"
                autoComplete="organization"
                placeholder="Company name"
                required
              />
            </div>
            <div className="waitlist-honeypot" aria-hidden="true">
              <label htmlFor="waitlist-website">Website</label>
              <input
                id="waitlist-website"
                name="website"
                type="text"
                tabIndex="-1"
                autoComplete="off"
              />
            </div>
            <button
              type="submit"
              className="btn btn--primary waitlist-submit"
              disabled={status === 'submitting'}
            >
              {status === 'submitting' ? 'Joining…' : 'Join the waitlist'}
            </button>
            <p
              className={`waitlist-message waitlist-message--${status}`}
              role="status"
              aria-live="polite"
            >
              {message}
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
