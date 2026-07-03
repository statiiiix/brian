import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge';
import './SkillDetail.css';

const lines = (arr) => (arr || []).join('\n');
const unlines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

export default function SkillDetail() {
  const { id } = useParams();
  const [skill, setSkill] = useState(null);
  const [versions, setVersions] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api(`/api/skills/${id}`);
      setSkill(s);
      setForm({
        name: s.name,
        trigger: s.trigger,
        procedure: s.procedure,
        inputs: lines(s.inputs),
        hard_rules: lines(s.hard_rules),
        tools: lines(s.tools),
        guardrails: lines(s.guardrails),
        escalation_target: s.escalation_target || '',
        owner: s.owner || '',
        examples: s.examples || [],
      });
      setVersions(await api(`/api/skills/${id}/versions`));
    } catch (e) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function setExample(i, key, value) {
    setForm((f) => {
      const examples = f.examples.map((ex, j) => (j === i ? { ...ex, [key]: value } : ex));
      return { ...f, examples };
    });
  }

  async function save() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/skills/${id}`, {
        method: 'PUT',
        body: {
          name: form.name,
          trigger: form.trigger,
          procedure: form.procedure,
          inputs: unlines(form.inputs),
          hard_rules: unlines(form.hard_rules),
          tools: unlines(form.tools),
          guardrails: unlines(form.guardrails),
          escalation_target: form.escalation_target || null,
          owner: form.owner || null,
          examples: form.examples.filter((ex) => ex.scenario || ex.correct_action),
        },
      });
      setNotice('Saved. Version bumped.');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(action) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api(`/api/skills/${id}/${action}`, { method: 'POST' });
      setNotice(action === 'activate' ? 'Skill is now active.' : 'Skill retired.');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !skill) return <p className="dash-error" role="alert">{error}</p>;
  if (!skill || !form) return <p className="dash-loading">Loading skill…</p>;

  return (
    <div className="skill-detail">
      <header className="dash-head">
        <div>
          <p className="skill-detail-back">
            <Link to="/app/skills">← Skills</Link>
          </p>
          <h1 className="dash-title">{skill.name}</h1>
          <p className="dash-subtitle">
            <StatusBadge status={skill.status} />
            <span className="dash-mono"> v{skill.version}</span>
            {skill.owner && <span> · owned by {skill.owner}</span>}
          </p>
        </div>
        <div className="skill-detail-actions">
          {skill.status !== 'active' && (
            <button type="button" className="dash-btn dash-btn--primary" onClick={() => setStatus('activate')} disabled={busy}>
              Activate
            </button>
          )}
          {skill.status !== 'retired' && (
            <button type="button" className="dash-btn dash-btn--danger" onClick={() => setStatus('retire')} disabled={busy}>
              Retire
            </button>
          )}
        </div>
      </header>

      {error && <p className="dash-error" role="alert">{error}</p>}
      {notice && <p className="skill-detail-notice" role="status">{notice}</p>}

      <div className="skill-detail-grid">
        <section className="dash-card">
          <div className="dash-field">
            <label htmlFor="sd-name">Name</label>
            <input id="sd-name" className="dash-input" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="dash-field">
            <label htmlFor="sd-trigger">Trigger — when does this skill apply?</label>
            <textarea id="sd-trigger" className="dash-textarea" rows={2} value={form.trigger} onChange={(e) => set('trigger', e.target.value)} />
          </div>
          <div className="dash-field">
            <label htmlFor="sd-procedure">Procedure — the step-by-step decision logic</label>
            <textarea id="sd-procedure" className="dash-textarea" rows={8} value={form.procedure} onChange={(e) => set('procedure', e.target.value)} />
          </div>
          <div className="dash-field">
            <label htmlFor="sd-inputs">Inputs (one per line)</label>
            <textarea id="sd-inputs" className="dash-textarea" rows={3} value={form.inputs} onChange={(e) => set('inputs', e.target.value)} />
          </div>
          <div className="dash-field">
            <label htmlFor="sd-rules">Hard rules (one per line)</label>
            <textarea id="sd-rules" className="dash-textarea" rows={3} value={form.hard_rules} onChange={(e) => set('hard_rules', e.target.value)} />
          </div>
          <div className="dash-field">
            <label htmlFor="sd-guardrails">Guardrails — when to STOP and escalate (one per line)</label>
            <textarea id="sd-guardrails" className="dash-textarea" rows={3} value={form.guardrails} onChange={(e) => set('guardrails', e.target.value)} />
          </div>
          <div className="dash-field">
            <label htmlFor="sd-tools">Tools (one per line)</label>
            <textarea id="sd-tools" className="dash-textarea" rows={2} value={form.tools} onChange={(e) => set('tools', e.target.value)} />
          </div>
          <div className="skill-detail-row">
            <div className="dash-field">
              <label htmlFor="sd-escalation">Escalation target</label>
              <input id="sd-escalation" className="dash-input" value={form.escalation_target} onChange={(e) => set('escalation_target', e.target.value)} />
            </div>
            <div className="dash-field">
              <label htmlFor="sd-owner">Owner</label>
              <input id="sd-owner" className="dash-input" value={form.owner} onChange={(e) => set('owner', e.target.value)} />
            </div>
          </div>

          <fieldset className="skill-detail-examples">
            <legend>Worked examples</legend>
            {form.examples.map((ex, i) => (
              <div key={i} className="skill-detail-example">
                <div className="dash-field">
                  <label htmlFor={`sd-ex-s-${i}`}>Scenario</label>
                  <textarea id={`sd-ex-s-${i}`} className="dash-textarea" rows={2} value={ex.scenario} onChange={(e) => setExample(i, 'scenario', e.target.value)} />
                </div>
                <div className="dash-field">
                  <label htmlFor={`sd-ex-a-${i}`}>Correct action</label>
                  <textarea id={`sd-ex-a-${i}`} className="dash-textarea" rows={2} value={ex.correct_action} onChange={(e) => setExample(i, 'correct_action', e.target.value)} />
                </div>
                <button
                  type="button"
                  className="dash-btn dash-btn--ghost skill-detail-example-remove"
                  onClick={() => set('examples', form.examples.filter((_, j) => j !== i))}
                >
                  Remove example
                </button>
              </div>
            ))}
            <button
              type="button"
              className="dash-btn dash-btn--ghost"
              onClick={() => set('examples', [...form.examples, { scenario: '', correct_action: '' }])}
            >
              Add example
            </button>
          </fieldset>

          <div className="skill-detail-save">
            <button type="button" className="dash-btn dash-btn--primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </section>

        <aside>
          <section className="dash-card">
            <h2 className="skill-detail-h2">Version history</h2>
            {versions.length === 0 && <p className="dash-empty">No prior versions.</p>}
            <ul className="skill-detail-versions">
              {versions.map((v) => (
                <li key={v.id}>
                  <span className="dash-mono">v{v.version}</span>
                  <span>{v.changed_by || 'unknown'}</span>
                  <span className="dash-mono">{new Date(v.created_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
