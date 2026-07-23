import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, icons, msym } from '../../components/Icon';
import ProviderLogo from '../components/ProviderLogo';
import { api, apiForm } from '../api';
import { SOURCES, ACCEPT, MAX_FILES, MAX_BYTES, sourceError } from '../sources';
import './BuildSkill.css';

const OTHER_EXPERT = '__other__';
// A skill that isn't tied to one person's judgment; Brian still drafts it but
// records no single owner to interview or escalate to.
const ANYONE = 'Anyone';

// The picker shows a person, not a membership id: whichever of name or email
// the directory has, plus the role so two people with one name stay distinct.
function memberLabel(member) {
  return member.display_name || member.email || `Member ${String(member.user_id || '').slice(0, 8)}`;
}

export default function BuildSkill() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [expert, setExpert] = useState('');
  const [otherExpert, setOtherExpert] = useState('');
  const [members, setMembers] = useState([]);
  const [connectors, setConnectors] = useState([]);
  const [chosen, setChosen] = useState([]);
  const [notionBoundaries, setNotionBoundaries] = useState(null);
  const [notionSelection, setNotionSelection] = useState({ selected_page_ids: [], selected_data_source_ids: [] });
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // A failed attach leaves a prepared interview behind; reuse it on retry
  // instead of stacking up abandoned ones.
  const interviewRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    api('/api/members').then((rows) => setMembers(rows.filter((m) => m.status === 'active'))).catch(() => {});
    api('/api/connectors')
      .then((rows) => setConnectors(rows.filter((row) => row.status === 'connected' && SOURCES[row.type])))
      .catch(() => {});
  }, []);

  const expertName = expert === OTHER_EXPERT ? otherExpert.trim() : expert;
  const notionRow = connectors.find((row) => row.type === 'notion');
  const notionChosen = chosen.includes('notion');
  const notionNeedsPages = notionChosen && notionRow?.selection_ready === false;
  const notionCount = notionSelection.selected_page_ids.length + notionSelection.selected_data_source_ids.length;

  async function toggleSource(type) {
    setError('');
    const next = chosen.includes(type) ? chosen.filter((t) => t !== type) : [...chosen, type];
    setChosen(next);
    if (type === 'notion' && next.includes('notion') && !notionBoundaries
        && connectors.find((row) => row.type === 'notion')?.selection_ready === false) {
      try {
        const result = await api('/api/connectors/notion/boundaries');
        setNotionBoundaries(result.boundaries || []);
      } catch (e) {
        setError(e.message);
      }
    }
  }

  function toggleBoundary(boundary) {
    const key = boundary.kind === 'page' ? 'selected_page_ids' : 'selected_data_source_ids';
    setNotionSelection((current) => ({
      ...current,
      [key]: current[key].includes(boundary.id)
        ? current[key].filter((id) => id !== boundary.id)
        : [...current[key], boundary.id],
    }));
  }

  function chooseFiles(event) {
    const picked = [...event.target.files];
    event.target.value = '';
    if (files.length + picked.length > MAX_FILES) {
      return setError(`Attach up to ${MAX_FILES} files.`);
    }
    const oversized = picked.find((file) => file.size > MAX_BYTES);
    if (oversized) return setError(`${oversized.name} is larger than 10 MB.`);
    setError('');
    setFiles([...files, ...picked]);
  }

  async function start(e) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    if (notionNeedsPages && !notionCount) return setError('Choose at least one Notion page.');
    setBusy(true);
    setError('');
    // "Anyone" means the skill has no single owner, so it steers the brief and
    // the interview as no owner at all — only a real person is written down.
    const namedOwner = expertName && expertName !== ANYONE ? expertName : '';
    // First line is the human-readable title; the rest is the brief that steers
    // the interview engine. See src/app/interviewTopic.js.
    const topic = [
      name.trim(),
      purpose.trim() ? `What this skill is for: ${purpose.trim()}` : '',
      namedOwner ? `Owner of the judgment: ${namedOwner}` : '',
    ].filter(Boolean).join('\n');

    try {
      if (!interviewRef.current) {
        const created = await api('/api/interviews', {
          method: 'POST',
          body: { topic, ...(namedOwner ? { owner: namedOwner } : {}), defer_start: true },
        });
        interviewRef.current = created.id;
      }
      const id = interviewRef.current;
      for (const type of chosen) {
        await api(`/api/interviews/${id}/sources/connector`, {
          method: 'POST',
          body: { connector: type, ...(type === 'notion' && notionCount ? { selection: notionSelection } : {}) },
        });
      }
      for (const file of files) {
        const form = new FormData();
        form.set('file', file);
        await apiForm(`/api/interviews/${id}/sources/upload`, form);
      }
      await api(`/api/interviews/${id}/start`, { method: 'POST' });
      navigate(`/app/interviews/${id}`);
    } catch (e2) {
      setError(sourceError(e2.message));
      setBusy(false);
    }
  }

  return (
    <div className="build-skill">
      <header className="dash-head build-skill-head">
        <div>
          <h1 className="dash-title">Build a skill</h1>
          <p className="dash-subtitle">Name the skill, pick the expert who owns it, and choose what Brian should read before it starts the interview.</p>
        </div>
      </header>

      {error && <p className="dash-error" role="alert">{error}</p>}

      <form className="build-skill-layout" onSubmit={start}>
        <div className="build-skill-form">
          <section className="dash-card build-step">
            <div className="build-step-number">01</div>
            <div className="build-step-content">
              <h2>What is this skill, and whose judgment is it?</h2>
              <div className="dash-field">
                <label htmlFor="build-name">Skill name</label>
                <input id="build-name" className="dash-input" placeholder="e.g. Approve production access requests" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="dash-field">
                <label htmlFor="build-purpose">What is it for?</label>
                <input id="build-purpose" className="dash-input" placeholder="e.g. Decide who gets production access without creating a security gap" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
              </div>
              <div className="dash-field">
                <label htmlFor="build-expert">Who owns it?</label>
                <select id="build-expert" className="dash-input" value={expert} onChange={(e) => setExpert(e.target.value)}>
                  <option value="">Choose a person</option>
                  <option value={ANYONE}>Anyone</option>
                  {members.map((member) => (
                    <option key={member.id} value={memberLabel(member)}>
                      {memberLabel(member)} · {member.role}
                    </option>
                  ))}
                  <option value={OTHER_EXPERT}>Someone else…</option>
                </select>
                {expert === OTHER_EXPERT && (
                  <input className="dash-input build-expert-other" placeholder="e.g. Maya — Head of Security" value={otherExpert} onChange={(e) => setOtherExpert(e.target.value)} aria-label="Expert name" />
                )}
                <p className="build-field-hint">
                  {expert === ANYONE
                    ? 'This skill isn’t tied to one person — Brian drafts it with no single owner to escalate to.'
                    : 'Brian interviews this person and escalates to them when a guardrail trips.'}
                </p>
              </div>
            </div>
          </section>

          <section className="dash-card build-step">
            <div className="build-step-number">02</div>
            <div className="build-step-content">
              <h2>What should Brian read first?</h2>
              <p className="build-step-lede">Everything you pick here is read before the first question, so the interview starts from what your company already wrote down.</p>
              {connectors.length > 0 ? (
                <div className="build-source-grid">
                  {connectors.map((row) => (
                    <button
                      type="button"
                      key={row.id}
                      className={`build-source ${chosen.includes(row.type) ? 'is-selected' : ''}`}
                      onClick={() => toggleSource(row.type)}
                      aria-pressed={chosen.includes(row.type)}
                    >
                      <span className="build-source-logo">
                        <ProviderLogo provider={SOURCES[row.type].logo} label={SOURCES[row.type].label} size={18} />
                      </span>
                      <span>
                        <strong>{SOURCES[row.type].label}</strong>
                        <small>{SOURCES[row.type].hint}</small>
                      </span>
                      {chosen.includes(row.type) && <Icon path={msym.check} size={15} />}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="build-source-empty">
                  No sources are connected yet. <Link to="/app/connectors">Connect one</Link> or attach files below — the interview works either way.
                </p>
              )}

              {notionNeedsPages && (
                <div className="build-notion">
                  <p>Choose the Notion pages Brian may read for this skill.</p>
                  {notionBoundaries === null ? <p className="build-field-hint">Loading pages…</p> : (
                    <div className="build-notion-options">
                      {notionBoundaries.map((boundary) => {
                        const key = boundary.kind === 'page' ? 'selected_page_ids' : 'selected_data_source_ids';
                        return (
                          <label key={boundary.id}>
                            <input type="checkbox" checked={notionSelection[key].includes(boundary.id)} onChange={() => toggleBoundary(boundary)} />
                            <span>{boundary.title}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="build-uploads">
                <button type="button" className="dash-btn dash-btn--ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                  <Icon path={msym.upload} size={15} /> Attach files
                </button>
                <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={chooseFiles} />
                <small>PDF, Word, or images — up to {MAX_FILES} files.</small>
                {files.length > 0 && (
                  <ul className="build-upload-list">
                    {files.map((file) => (
                      <li key={`${file.name}-${file.size}`}>
                        <span>{file.name}</span>
                        <button type="button" onClick={() => setFiles(files.filter((f) => f !== file))} aria-label={`Remove ${file.name}`}>×</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>

          <button type="submit" className="dash-btn dash-btn--primary build-submit" disabled={busy || !name.trim()}>
            <Icon path={msym.build} size={16} />
            {busy ? 'Preparing interview…' : 'Start the guarded interview'}
          </button>
        </div>

        <aside className="dash-card build-skill-preview">
          <div className="build-preview-icon"><Icon path={icons.shield} size={16} /></div>
          <h2>Skill output</h2>
          <div className="build-preview-list">
            <div><Icon path={msym.check} size={13} /> Inputs and required evidence</div>
            <div><Icon path={msym.check} size={13} /> Step-by-step decision procedure</div>
            <div><Icon path={msym.check} size={13} /> Hard rules and tool permissions</div>
            <div><Icon path={msym.check} size={13} /> Stop conditions and escalation target</div>
            <div><Icon path={msym.check} size={13} /> Worked examples and version history</div>
          </div>
          <p className="build-preview-note"><strong>Nothing goes live on its own.</strong> Every drafted skill waits in the review queue until a human approves it.</p>
        </aside>
      </form>
    </div>
  );
}
