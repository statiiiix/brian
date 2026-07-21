import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon, msym } from '../../components/Icon';
import { api } from '../api';
import { useCachedQuery } from '../useCachedQuery';
import StatusBadge from '../components/StatusBadge';
import './SkillDetail.css';

const lines = (arr) => (arr || []).join('\n');
const unlines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

function toForm(s) {
  return {
    name: s.name,
    trigger: s.trigger,
    procedure: s.procedure,
    inputs: lines(s.inputs),
    principles: lines(s.principles),
    quality_checks: lines(s.quality_checks),
    hard_rules: lines(s.hard_rules),
    tools: lines(s.tools),
    guardrails: lines(s.guardrails),
    escalation_target: s.escalation_target || '',
    owner: s.owner || '',
    examples: s.examples || [],
  };
}

export default function SkillDetail() {
  const { id } = useParams();
  const { data: skill, error, setError, refresh: refreshSkill } = useCachedQuery(`/api/skills/${id}`);
  const { data: versionList, refresh: refreshVersions } = useCachedQuery(`/api/skills/${id}/versions`);
  const { data: evidenceList } = useCachedQuery(
    `/api/skills/${id}/evidence`,
    () => api(`/api/skills/${id}/evidence`).catch(() => [])
  );
  const versions = versionList || [];
  const evidence = evidenceList || [];
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // Seed the editable form once per skill. Background revalidation must not
  // wipe out edits in progress, so only a fresh id (or an explicit reload
  // after saving) rebuilds it.
  const formSkillId = useRef(null);
  useEffect(() => {
    if (!skill || formSkillId.current === skill.id) return;
    formSkillId.current = skill.id;
    setForm(toForm(skill));
  }, [skill]);

  const load = useCallback(async () => {
    const [fresh] = await Promise.all([refreshSkill(), refreshVersions()]);
    if (fresh) setForm(toForm(fresh));
  }, [refreshSkill, refreshVersions]);

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
          principles: unlines(form.principles),
          quality_checks: unlines(form.quality_checks),
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
  if (!skill || !form) {
    return (
      <div className="dash-skeleton" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="dash-skeleton-row">
            <span className="dash-skeleton-bar" style={{ width: `${60 - i * 10}%` }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="skill-detail">
      <header className="dash-head">
        <div>
          <p className="dash-back">
            <Link to="/app/skills">
              <Icon path={msym.back} size={14} />
              Skills
            </Link>
          </p>
          <h1 className="dash-title">{skill.name}</h1>
          <p className="dash-subtitle skill-detail-meta">
            <StatusBadge status={skill.status} />
            <span className="dash-mono">v{skill.version}</span>
            {skill.owner && <span>owned by {skill.owner}</span>}
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
      {notice && <p className="dash-notice" role="status">{notice}</p>}

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
            <label htmlFor="sd-principles">Principles and methodology (one per line)</label>
            <textarea id="sd-principles" className="dash-textarea" rows={4} value={form.principles} onChange={(e) => set('principles', e.target.value)} />
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
          <div className="dash-field">
            <label htmlFor="sd-quality">Quality checks (one per line)</label>
            <textarea id="sd-quality" className="dash-textarea" rows={3} value={form.quality_checks} onChange={(e) => set('quality_checks', e.target.value)} />
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
          {skill.sources?.length > 0 && (
            <section className="dash-card skill-detail-provenance">
              <h2 className="dash-h2">Skill sources</h2>
              <ul className="skill-detail-prov-list">
                {skill.sources.map((source, index) => (
                  <li key={`${source.url || source.title}-${index}`}>
                    {source.url ? (
                      <a className="skill-detail-prov-link" href={source.url} target="_blank" rel="noreferrer">
                        {source.title}
                      </a>
                    ) : source.title}
                    <span className="dash-mono"> {source.origin}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {evidence.length > 0 && (
            <section className="dash-card skill-detail-provenance">
              <h2 className="dash-h2">Sourced from connectors</h2>
              <p className="skill-detail-prov-note">
                Drafted from {evidence.length} piece{evidence.length > 1 ? 's' : ''} of evidence.
              </p>
              <ul className="skill-detail-prov-list">
                {evidence.map((e) => (
                  <li key={e.id}>
                    <p className="skill-detail-prov-summary">{e.summary}</p>
                    {e.source_ref?.permalink && (
                      <a
                        className="skill-detail-prov-link"
                        href={e.source_ref.permalink}
                        target="_blank"
                        rel="noreferrer"
                      >
                        source ↗
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="dash-card">
            <h2 className="dash-h2">Version history</h2>
            {versions.length === 0 && <p className="skill-detail-noversions">No prior versions.</p>}
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
