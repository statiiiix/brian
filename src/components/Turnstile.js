import { useEffect, useRef } from 'react';

const SCRIPT_ID = 'brian-cloudflare-turnstile';
let loader = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID);
    const script = existing || document.createElement('script');
    const ready = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Bot-protection challenge did not load.'));
    };
    script.addEventListener('load', ready, { once: true });
    script.addEventListener('error', () => reject(new Error('Bot-protection challenge did not load.')), { once: true });
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return loader;
}

export const TURNSTILE_SITE_KEY = process.env.REACT_APP_TURNSTILE_SITE_KEY || '';

export default function Turnstile({ onToken, resetKey = 0 }) {
  const container = useRef(null);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !container.current) return undefined;
    let active = true;
    let widgetId = null;
    loadTurnstile()
      .then((turnstile) => {
        if (!active || !container.current) return;
        widgetId = turnstile.render(container.current, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        });
      })
      .catch(() => onToken(''));
    return () => {
      active = false;
      if (widgetId !== null && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onToken, resetKey]);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={container} className="signup-captcha" aria-label="Bot protection" />;
}
