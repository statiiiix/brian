import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { authCallbackUrl, authReturnToFromSearch, withReturnTo } from '../lib/returnTo';
import { api } from '../app/api';
import AuthShell from './AuthShell';
import Turnstile, { TURNSTILE_SITE_KEY } from '../components/Turnstile';
import './Signup.css';

function hasUnsafeDisplayCharacters(value) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return character === '<' || character === '>' || code < 32 || code === 127;
  });
}

function isInvitationContinuation(returnTo) {
  return /^\/invite\/[A-Za-z0-9_-]{20,512}(?:[?#]|$)/.test(returnTo);
}

function invitationTokenFromContinuation(returnTo) {
  return /^\/invite\/([A-Za-z0-9_-]{20,512})(?:[?#]|$)/.exec(returnTo)?.[1] || '';
}

function validateSignup({ fullName, email, password, companyName, acceptedTerms }, invitationSignup) {
  const name = fullName.trim();
  const company = companyName.trim();
  if (name.length < 2 || name.length > 100 || hasUnsafeDisplayCharacters(name)) {
    return 'Enter your full name using 2–100 normal characters.';
  }
  if (!invitationSignup && (company.length < 2 || company.length > 120 || hasUnsafeDisplayCharacters(company))) {
    return 'Enter a company name using 2–120 normal characters.';
  }
  if (email.trim().length > 254) return 'Enter a valid work email address.';
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return 'Use at least 10 characters, including a letter and a number.';
  }
  if (!acceptedTerms) return 'Accept the Terms and Privacy Policy to continue.';
  return '';
}

function signupErrorMessage(error) {
  const message = error?.message || 'Signup failed';
  if (/already registered|already exists/i.test(message)) {
    return 'An account already exists for this email. Log in or reset your password.';
  }
  if (/rate|too many/i.test(message)) return 'Too many signup attempts. Please wait and try again.';
  return message;
}

function isProvisioningFailure(error) {
  return /database error (?:saving|creating) new user|company provisioning|provisioning failed/i
    .test(error?.message || '');
}

export default function Signup() {
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = authReturnToFromSearch(location.search, '/onboarding');
  const invitationSignup = isInvitationContinuation(returnTo);
  const [signupAvailability, setSignupAvailability] = useState(invitationSignup ? 'enabled' : 'checking');
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    companyName: '',
    acceptedTerms: false,
  });
  const [state, setState] = useState('initial');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);
  const onCaptchaToken = useCallback((token) => setCaptchaToken(token), []);

  useEffect(() => {
    if (invitationSignup) {
      setSignupAvailability('enabled');
      return undefined;
    }
    let active = true;
    setSignupAvailability('checking');
    api('/api/public/config', { redirectOnUnauthorized: false })
      .then((config) => {
        if (active) setSignupAvailability(config?.publicSignup === true ? 'enabled' : 'disabled');
      })
      .catch(() => {
        if (active) setSignupAvailability('disabled');
      });
    return () => { active = false; };
  }, [invitationSignup]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (!invitationSignup && signupAvailability !== 'enabled') {
      setError('Public company signup is not available.');
      return;
    }
    const validationError = validateSignup(form, invitationSignup);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (TURNSTILE_SITE_KEY && !captchaToken) {
      setError('Complete the bot-protection challenge to continue.');
      return;
    }
    setState('submitting');
    setError('');
    try {
      if (!isSupabaseConfigured) throw new Error('Supabase Auth is not configured for this deployment.');
      const email = form.email.trim();
      if (invitationSignup) {
        const validation = await api('/api/public/invitations/validate', {
          method: 'POST',
          body: { email, token: invitationTokenFromContinuation(returnTo) },
          redirectOnUnauthorized: false,
        });
        if (validation?.valid !== true) {
          setState('invitation-invalid');
          return;
        }
      }
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: {
          emailRedirectTo: authCallbackUrl(returnTo),
          data: {
            full_name: form.fullName.trim(),
            ...(invitationSignup
              ? { brian_invitation_signup: true }
              : { company_name: form.companyName.trim() }),
          },
          ...(captchaToken ? { captchaToken } : {}),
        },
      });
      if (authError) throw authError;
      if (data.session) {
        navigate(returnTo, { replace: true });
        return;
      }
      setState(data.user?.identities?.length === 0 ? 'already-registered' : 'check-email');
    } catch (authError) {
      if (isProvisioningFailure(authError)) {
        setError('');
        setState('provisioning-failed');
      } else {
        setError(signupErrorMessage(authError));
        setState('initial');
      }
      setCaptchaToken('');
      setCaptchaReset((value) => value + 1);
    }
  }

  async function resend() {
    setError('');
    setNotice('');
    setState('submitting');
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: form.email.trim(),
        options: { emailRedirectTo: authCallbackUrl(returnTo) },
      });
      if (resendError) throw resendError;
      setNotice('A fresh confirmation email is on its way.');
      setState('check-email');
    } catch (resendError) {
      setError(signupErrorMessage(resendError));
      setState('check-email');
    }
  }

  if (state === 'check-email' || state === 'already-registered') {
    return (
      <AuthShell>
        <section className="login-card" aria-live="polite">
          <p className="auth-kicker">One more step</p>
          <h1>Check your email</h1>
          <p className="login-sub auth-copy">
            We sent a secure confirmation link to <strong>{form.email.trim()}</strong>. Open it in this browser to continue.
          </p>
          {state === 'already-registered' && (
            <p className="login-notice">If you already confirmed this address, log in instead.</p>
          )}
          {error && <p className="login-error" role="alert">{error}</p>}
          {notice && <p className="login-success" role="status">{notice}</p>}
          <button type="button" className="login-submit" onClick={resend}>Resend confirmation</button>
          <p className="login-hint"><a href={withReturnTo('/login', returnTo)}>Return to login</a></p>
        </section>
      </AuthShell>
    );
  }

  if (state === 'provisioning-failed') {
    return (
      <AuthShell>
        <section className="login-card" aria-live="polite">
          <p className="auth-kicker">Company setup</p>
          <h1>Company setup was not completed</h1>
          <p className="login-sub auth-copy">
            Your signup did not finish, so it is safe to retry with the same details. Brian will not create a duplicate company.
          </p>
          <button type="button" className="login-submit" onClick={() => setState('initial')}>Retry signup</button>
          <p className="login-hint"><a href={withReturnTo('/login', returnTo)}>Log in if your account already exists</a></p>
        </section>
      </AuthShell>
    );
  }

  if (state === 'invitation-invalid') {
    return (
      <AuthShell>
        <section className="login-card" aria-live="polite">
          <p className="auth-kicker">Invitation</p>
          <h1>Invitation unavailable</h1>
          <p className="login-sub auth-copy">
            This invitation is invalid, expired, already used, or belongs to a different email address. Ask the company owner for a new link.
          </p>
          <p className="login-hint"><a href="/login">Return to login</a></p>
        </section>
      </AuthShell>
    );
  }

  if (!invitationSignup && signupAvailability !== 'enabled') {
    return (
      <AuthShell>
        <section className="login-card" aria-live="polite">
          <p className="auth-kicker">Company signup</p>
          <h1>{signupAvailability === 'checking' ? 'Checking availability…' : 'Public signup is not open yet'}</h1>
          <p className="login-sub auth-copy">
            {signupAvailability === 'checking'
              ? 'Brian is confirming that new company provisioning is available.'
              : 'New companies remain release-gated. If you received an invitation, use the exact invitation link instead.'}
          </p>
          {signupAvailability === 'disabled' && (
            <p className="login-hint"><a href={withReturnTo('/login', returnTo)}>Return to login</a></p>
          )}
        </section>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <form className="login-card login-card--wide" onSubmit={onSubmit}>
        <h1>{invitationSignup ? 'Create your account to join' : 'Create your company brain'}</h1>
        <p className="login-sub">{invitationSignup
          ? 'Your invitation determines the company and role after you verify your email.'
          : 'Start with one company. You can invite teammates after setup.'}</p>
        <div className="signup-grid">
          <div>
            <label htmlFor="signup-name">Full name</label>
            <input id="signup-name" autoComplete="name" value={form.fullName} onChange={(event) => update('fullName', event.target.value)} maxLength={100} required />
          </div>
          {!invitationSignup && <div>
            <label htmlFor="signup-company">Company name</label>
            <input id="signup-company" autoComplete="organization" value={form.companyName} onChange={(event) => update('companyName', event.target.value)} maxLength={120} required />
          </div>}
        </div>
        <label htmlFor="signup-email">Work email</label>
        <input id="signup-email" type="email" autoComplete="email" value={form.email} onChange={(event) => update('email', event.target.value)} maxLength={254} required />
        <label htmlFor="signup-password">Password</label>
        <input id="signup-password" type="password" autoComplete="new-password" value={form.password} onChange={(event) => update('password', event.target.value)} minLength={10} required />
        <p className="signup-requirement">At least 10 characters, with a letter and a number.</p>
        <label className="signup-terms" htmlFor="signup-terms">
          <input id="signup-terms" type="checkbox" checked={form.acceptedTerms} onChange={(event) => update('acceptedTerms', event.target.checked)} />
          <span>I agree to Brian’s <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</span>
        </label>
        <Turnstile onToken={onCaptchaToken} resetKey={captchaReset} />
        {error && <p className="login-error" role="alert">{error}</p>}
        <button type="submit" className="login-submit" disabled={state === 'submitting'}>
          {state === 'submitting'
            ? (invitationSignup ? 'Creating your account…' : 'Creating your company…')
            : (invitationSignup ? 'Create account & join' : 'Create account')}
        </button>
        <p className="login-hint">Already have an account? <a href={withReturnTo('/login', returnTo)}>Log in</a></p>
      </form>
    </AuthShell>
  );
}
