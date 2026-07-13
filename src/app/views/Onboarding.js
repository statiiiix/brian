import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { BRIAN_MCP_URL } from '../../lib/supabase';
import { useAuth } from '../auth';
import { api } from '../api';
import './Onboarding.css';

const STEPS = [
  { id: 'company', label: 'Company' },
  { id: 'skill', label: 'First skill' },
  { id: 'sources', label: 'Sources' },
  { id: 'agent', label: 'Agent' },
  { id: 'verify', label: 'Verify' },
];

function normalizeOnboarding(payload) {
  const state = payload?.onboarding || payload || {};
  const completedSteps = state.completedSteps || state.completed_steps || [];
  const rawCurrentStep = state.currentStep || state.current_step;
  const currentStep = typeof rawCurrentStep === 'number'
    ? STEPS[Math.max(0, Math.min(STEPS.length - 1, rawCurrentStep - 1))].id
    : rawCurrentStep || STEPS.find((step) => !completedSteps.includes(step.id))?.id || 'verify';
  return {
    ...state,
    currentStep,
    completedSteps,
    completed: Boolean(state.completed),
    firstMcpCallAt: state.firstMcpCallAt || state.first_mcp_call_at || null,
  };
}

export default function Onboarding() {
  const { profile } = useAuth();
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const payload = await api('/api/onboarding');
      const normalized = normalizeOnboarding(payload);
      setState(normalized);
      return normalized;
    } catch (loadError) {
      setError(loadError.message || 'Unable to load onboarding progress.');
      return null;
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeIndex = useMemo(() => {
    if (!state) return 0;
    const index = STEPS.findIndex((step) => step.id === state.currentStep);
    return index < 0 ? 0 : index;
  }, [state]);

  const currentTenant = profile?.currentTenant || profile?.current_tenant;

  async function saveProgress(stepId, { completed = false } = {}) {
    if (!state) return;
    setBusy(true);
    setError('');
    const completedSteps = [...new Set([...state.completedSteps, stepId])];
    const nextStep = STEPS.find((step) => !completedSteps.includes(step.id))?.id || 'verify';
    const nextStepNumber = STEPS.findIndex((item) => item.id === nextStep) + 1;
    const patch = { currentStep: nextStepNumber, completedSteps, completed };
    try {
      const payload = await api('/api/onboarding', { method: 'PATCH', body: patch });
      const saved = normalizeOnboarding(payload?.onboarding ? payload : {
        ...state,
        ...patch,
        currentStep: nextStep,
      });
      setState({ ...saved, firstMcpCallAt: saved.firstMcpCallAt || state.firstMcpCallAt });
    } catch (saveError) {
      setError(saveError.message || 'Unable to save onboarding progress.');
    } finally {
      setBusy(false);
    }
  }

  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyNotice(`${label} copied.`);
    } catch {
      setCopyNotice(`Copy failed. Select the ${label.toLowerCase()} below.`);
    }
  }

  async function checkFirstCall() {
    setBusy(true);
    const refreshed = await load();
    setBusy(false);
    if (!refreshed?.firstMcpCallAt) setCopyNotice('No find_skill call yet. Return to your agent and try again.');
  }

  if (!state) {
    return (
      <div className="dash onboarding-shell">
        <main className="onboarding-main"><p role="status">{error || 'Loading your setup…'}</p></main>
      </div>
    );
  }

  const step = STEPS[activeIndex];

  return (
    <div className="dash onboarding-shell">
      <header className="onboarding-header">
        <a href="/" className="onboarding-brand">Brian</a>
        <Link to="/app" className="dash-btn dash-btn--ghost">Go to dashboard</Link>
      </header>
      <main className="onboarding-main">
        <p className="onboarding-kicker">Company setup</p>
        <h1>Give your agent the judgment to do real work.</h1>
        <p className="onboarding-intro">Your progress is saved to your company. You can leave and continue on another device.</p>

        <ol className="onboarding-progress" aria-label="Onboarding progress">
          {STEPS.map((item, index) => (
            <li key={item.id} className={`${state.completedSteps.includes(item.id) ? 'is-complete' : ''} ${item.id === step.id ? 'is-active' : ''}`}>
              <span>{state.completedSteps.includes(item.id) ? '✓' : index + 1}</span>{item.label}
            </li>
          ))}
        </ol>

        {error && <p className="dash-error" role="alert">{error}</p>}
        {copyNotice && <p className="dash-notice" role="status">{copyNotice}</p>}

        <section className="dash-card onboarding-card">
          {step.id === 'company' && (
            <>
              <span className="onboarding-icon"><Icon path="domain" size={22} /></span>
              <p className="onboarding-step">Step 1 of 5</p>
              <h2>Confirm your company</h2>
              <p>Brian keeps every skill, source, run, and agent connection inside this company boundary.</p>
              <div className="onboarding-company"><strong>{currentTenant?.name || 'Your company'}</strong><span>{profile?.user?.email || ''}</span></div>
              <button className="dash-btn dash-btn--primary" type="button" disabled={busy} onClick={() => saveProgress('company')}>This is correct</button>
            </>
          )}
          {step.id === 'skill' && (
            <>
              <span className="onboarding-icon"><Icon path="menu_book" size={22} /></span>
              <p className="onboarding-step">Step 2 of 5</p>
              <h2>Create the first governed skill</h2>
              <p>Teach Brian one decision your agent should never improvise. The existing interview will turn it into a reviewable procedure.</p>
              <div className="onboarding-actions">
                <Link className="dash-btn dash-btn--primary" to="/app/build">Build a skill</Link>
                <button className="dash-btn dash-btn--ghost" type="button" disabled={busy} onClick={() => saveProgress('skill')}>I created the skill</button>
              </div>
            </>
          )}
          {step.id === 'sources' && (
            <>
              <span className="onboarding-icon"><Icon path="hub" size={22} /></span>
              <p className="onboarding-step">Step 3 of 5 · optional</p>
              <h2>Connect a focused source</h2>
              <p>Give Brian evidence from the systems where this process lives. You can skip sources and connect them later.</p>
              <div className="onboarding-actions">
                <Link className="dash-btn dash-btn--primary" to="/app/connectors">Choose a source</Link>
                <button className="dash-btn dash-btn--ghost" type="button" disabled={busy} onClick={() => saveProgress('sources')}>Skip for now</button>
              </div>
            </>
          )}
          {step.id === 'agent' && (
            <>
              <span className="onboarding-icon"><Icon path="smart_toy" size={22} /></span>
              <p className="onboarding-step">Step 4 of 5</p>
              <h2>Connect your AI agent</h2>
              <p>Add Brian’s canonical MCP resource to your agent. OAuth-capable clients open the browser and ask for your approval; no static bearer token is written.</p>
              <div className="onboarding-code-row"><code>{BRIAN_MCP_URL}</code><button type="button" onClick={() => copy(BRIAN_MCP_URL, 'MCP URL')}>Copy</button></div>
              <div className="onboarding-code-row"><code>npx @brianthebrain/cli connect</code><button type="button" onClick={() => copy('npx @brianthebrain/cli connect', 'CLI command')}>Copy</button></div>
              <div className="onboarding-actions">
                <Link className="dash-btn dash-btn--ghost" to="/app/settings/agents">Open connection settings</Link>
                <button className="dash-btn dash-btn--primary" type="button" disabled={busy} onClick={() => saveProgress('agent')}>Agent configured</button>
              </div>
            </>
          )}
          {step.id === 'verify' && (
            <>
              <span className="onboarding-icon"><Icon path="verified" size={22} /></span>
              <p className="onboarding-step">Step 5 of 5</p>
              <h2>Verify the first governed call</h2>
              {state.completed ? (
                <>
                  <p className="onboarding-verified">Setup complete. Brian is ready for governed agent work.</p>
                  <Link className="dash-btn dash-btn--primary" to="/app">Open Brian</Link>
                </>
              ) : state.firstMcpCallAt ? (
                <>
                  <p className="onboarding-verified">Brian saw your agent call <code>find_skill</code>. The company boundary and agent grant are working.</p>
                  <button className="dash-btn dash-btn--primary" type="button" disabled={busy} onClick={() => saveProgress('verify', { completed: true })}>Finish setup</button>
                </>
              ) : (
                <>
                  <p>Ask your connected agent to find a skill in Brian, then check again. A tenant with zero active skills may return no result; the authenticated call still verifies the connection.</p>
                  <div className="onboarding-actions">
                    <button className="dash-btn dash-btn--primary" type="button" disabled={busy} onClick={checkFirstCall}>{busy ? 'Checking…' : 'Check connection'}</button>
                    <Link className="dash-btn dash-btn--ghost" to="/app">Continue in dashboard</Link>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
