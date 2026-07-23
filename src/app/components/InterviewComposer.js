import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, msym } from '../../components/Icon';
import { api, apiForm } from '../api';
import { SOURCES, ACCEPT, MAX_FILES, MAX_BYTES, sourceError } from '../sources';
import ProviderLogo from './ProviderLogo';
import './InterviewComposer.css';

// The two glyphs are Material Symbols 960 paths (from the product spec). They
// paint with `currentColor` so Brian's tokens — not a baked-in hex — decide the
// tint in light and dark.
function SourceGlyph({ size = 20 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" height={size} width={size} viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
      <path d="M155-75q-35-35-35-85t35-85q35-35 85-35 14 0 26 3t23 8l57-71q-28-31-39-70t-5-78l-81-27q-17 25-43 40t-58 15q-50 0-85-35T0-580q0-50 35-85t85-35q50 0 85 35t35 85v8l81 28q20-36 53.5-61t75.5-32v-87q-39-11-64.5-42.5T360-840q0-50 35-85t85-35q50 0 85 35t35 85q0 42-26 73.5T510-724v87q42 7 75.5 32t53.5 61l81-28v-8q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35q-32 0-58.5-15T739-515l-81 27q6 39-5 77.5T614-340l57 70q11-5 23-7.5t26-2.5q50 0 85 35t35 85q0 50-35 85t-85 35q-50 0-85-35t-35-85q0-20 6.5-38.5T624-232l-57-71q-41 23-87.5 23T392-303l-56 71q11 15 17.5 33.5T360-160q0 50-35 85t-85 35q-50 0-85-35Zm35-465q17 0 28.5-11.5T160-580q0-17-11.5-28.5T120-620q-17 0-28.5 11.5T80-580q0 17 11.5 28.5T120-540Zm148.5 408.5Q280-143 280-160t-11.5-28.5Q257-200 240-200t-28.5 11.5Q200-177 200-160t11.5 28.5Q223-120 240-120t28.5-11.5Zm240-680Q520-823 520-840t-11.5-28.5Q497-880 480-880t-28.5 11.5Q440-857 440-840t11.5 28.5Q463-800 480-800t28.5-11.5ZM480-360q42 0 71-29t29-71q0-42-29-71t-71-29q-42 0-71 29t-29 71q0 42 29 71t71 29Zm268.5 228.5Q760-143 760-160t-11.5-28.5Q737-200 720-200t-28.5 11.5Q680-177 680-160t11.5 28.5Q703-120 720-120t28.5-11.5Zm120-420Q880-563 880-580t-11.5-28.5Q857-620 840-620t-28.5 11.5Q800-597 800-580t11.5 28.5Q823-540 840-540t28.5-11.5ZM480-840ZM120-580Zm360 120Zm360-120ZM240-160Zm480 0Z" />
    </svg>
  );
}

function AttachGlyph({ size = 20 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" height={size} width={size} viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
      <path d="M330-240q-104 0-177-73T80-490q0-104 73-177t177-73h370q75 0 127.5 52.5T880-560q0 75-52.5 127.5T700-380H350q-46 0-78-32t-32-78q0-46 32-78t78-32h370v80H350q-13 0-21.5 8.5T320-490q0 13 8.5 21.5T350-460h350q42-1 71-29.5t29-70.5q0-42-29-71t-71-29H330q-71-1-120.5 49T160-490q0 70 49.5 119T330-320h390v80H330Z" />
    </svg>
  );
}

const EMPTY_SELECTION = { selected_page_ids: [], selected_data_source_ids: [] };

// The composer for an active interview: a floating field that also carries the
// source controls. The "source" button lists every connected source and lets
// the expert pick exactly what Brian may read (Notion drills to pages, the rest
// ground on their recent window); "attach" uploads files. Attached sources ride
// as chips above the input.
export default function InterviewComposer({
  interviewId,
  sources,
  onSourcesChange,
  value,
  onChange,
  onKeyDown,
  onSend,
  canSend,
  busy,
  textareaRef,
  onFinish,
  finishDisabled,
}) {
  const [connectors, setConnectors] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inNotion, setInNotion] = useState(false);
  const [boundaries, setBoundaries] = useState(null);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const pickerRef = useRef(null);
  const sourceBtnRef = useRef(null);

  useEffect(() => {
    api('/api/connectors')
      .then((rows) => setConnectors(rows.filter((row) => row.status === 'connected' && SOURCES[row.type])))
      .catch(() => {});
  }, []);

  function closePicker() {
    setPickerOpen(false);
    setInNotion(false);
    setError('');
  }

  // Dismiss the popover on an outside click or Escape so it behaves like a menu.
  useEffect(() => {
    if (!pickerOpen) return undefined;
    function onDown(e) {
      if (pickerRef.current?.contains(e.target) || sourceBtnRef.current?.contains(e.target)) return;
      closePicker();
    }
    function onKey(e) { if (e.key === 'Escape') closePicker(); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  const attachedTypes = new Set(
    sources.filter((source) => source.kind === 'connector').map((source) => source.source_type),
  );
  const uploadCount = sources.filter((source) => source.kind === 'upload').length;
  const selectionCount = selection.selected_page_ids.length + selection.selected_data_source_ids.length;

  async function openNotion() {
    setInNotion(true);
    setError('');
    if (boundaries !== null) return;
    setAdding(true);
    try {
      const result = await api('/api/connectors/notion/boundaries');
      setBoundaries(result.boundaries || []);
    } catch (e) {
      setError(e.message === 'Notion is not connected' ? 'Connect Notion first, then choose a page.' : e.message);
    } finally {
      setAdding(false);
    }
  }

  async function postConnector(type, sel) {
    setAdding(true);
    setError('');
    try {
      const next = await api(`/api/interviews/${interviewId}/sources/connector`, {
        method: 'POST',
        body: { connector: type, ...(sel ? { selection: sel } : {}) },
      });
      onSourcesChange(next);
      setSelection(EMPTY_SELECTION);
      closePicker();
    } catch (e) {
      setError(sourceError(e.message));
    } finally {
      setAdding(false);
    }
  }

  function pickConnector(type) {
    if (attachedTypes.has(type) || adding) return;
    // Notion is the one source with page-level boundaries — drill in so the
    // expert says exactly which pages. Everything else grounds on its recent
    // window, so one tap attaches it.
    if (type === 'notion') return openNotion();
    return postConnector(type);
  }

  function toggleBoundary(boundary) {
    const key = boundary.kind === 'page' ? 'selected_page_ids' : 'selected_data_source_ids';
    setSelection((current) => ({
      ...current,
      [key]: current[key].includes(boundary.id)
        ? current[key].filter((id) => id !== boundary.id)
        : [...current[key], boundary.id],
    }));
  }

  function addNotion() {
    if (!selectionCount) return setError('Choose at least one Notion page.');
    return postConnector('notion', selection);
  }

  async function chooseFiles(event) {
    const picked = [...event.target.files];
    event.target.value = '';
    if (uploadCount + picked.length > MAX_FILES) {
      return setError(`Attach up to ${MAX_FILES} files.`);
    }
    const oversized = picked.find((file) => file.size > MAX_BYTES);
    if (oversized) return setError(`${oversized.name} is larger than 10 MB.`);
    setError('');
    setAdding(true);
    try {
      let next = [...sources];
      for (const file of picked) {
        const form = new FormData();
        form.set('file', file);
        const uploaded = await apiForm(`/api/interviews/${interviewId}/sources/upload`, form);
        next = [...next.filter((source) => source.id !== uploaded.id), uploaded];
        onSourcesChange(next);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
    return undefined;
  }

  return (
    <div className="ivc-composer2">
      {sources.length > 0 && (
        <ul className="ivc-chips" aria-label="Attached sources">
          {sources.map((source) => (
            <SourceChip key={source.id} source={source} />
          ))}
        </ul>
      )}

      <div className="ivc-field2">
        <div className="ivc-field2-tools">
          <button
            type="button"
            ref={sourceBtnRef}
            className={`ivc-tool ${pickerOpen ? 'is-open' : ''}`}
            onClick={() => (pickerOpen ? closePicker() : setPickerOpen(true))}
            disabled={busy}
            aria-label="Add a source"
            aria-expanded={pickerOpen}
            title="Add a source Brian should read"
          >
            <SourceGlyph size={20} />
          </button>
          <button
            type="button"
            className="ivc-tool"
            onClick={() => fileRef.current?.click()}
            disabled={busy || adding}
            aria-label="Attach files"
            title="Attach files (PDF, Word, images)"
          >
            <AttachGlyph size={20} />
          </button>
          <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={chooseFiles} />
        </div>

        <textarea
          id="ivc-answer"
          ref={textareaRef}
          className="ivc-textarea2"
          rows={1}
          placeholder="Answer in plain language — Brian asks the follow-ups."
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          disabled={busy}
        />

        <button
          type="button"
          className="ivc-send2"
          onClick={onSend}
          disabled={!canSend}
          aria-label="Send answer"
        >
          <Icon path={msym.send} size={16} />
        </button>

        {pickerOpen && (
          <div className="ivc-picker" ref={pickerRef} role="menu">
            {!inNotion ? (
              <>
                <div className="ivc-picker-head">
                  Ground this interview in a connected source
                </div>
                {connectors.length === 0 ? (
                  <p className="ivc-picker-empty">
                    No sources connected. <Link to="/app/connectors">Connect one</Link> or attach a file.
                  </p>
                ) : (
                  <div className="ivc-picker-list">
                    {connectors.map((row) => {
                      const added = attachedTypes.has(row.type);
                      return (
                        <button
                          type="button"
                          key={row.id}
                          className="ivc-picker-item"
                          onClick={() => pickConnector(row.type)}
                          disabled={adding || added}
                        >
                          <span className="ivc-picker-logo">
                            <ProviderLogo provider={SOURCES[row.type].logo} label={SOURCES[row.type].label} size={17} />
                          </span>
                          <span className="ivc-picker-label">
                            <strong>{SOURCES[row.type].label}</strong>
                            <small>{SOURCES[row.type].hint}</small>
                          </span>
                          {added ? (
                            <span className="ivc-picker-added"><Icon path={msym.check} size={13} /></span>
                          ) : row.type === 'notion' ? (
                            <span className="ivc-picker-more" aria-hidden="true">›</span>
                          ) : (
                            <span className="ivc-picker-more" aria-hidden="true">+</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="ivc-notion">
                <button type="button" className="ivc-notion-back" onClick={() => setInNotion(false)}>
                  <Icon path={msym.back} size={13} /> Sources
                </button>
                <div className="ivc-picker-head">Choose the Notion pages Brian may read</div>
                {boundaries === null ? (
                  <p className="ivc-picker-empty">Loading pages…</p>
                ) : boundaries.length === 0 ? (
                  <p className="ivc-picker-empty">No pages are shared with Brian yet.</p>
                ) : (
                  <div className="ivc-notion-list">
                    {boundaries.map((boundary) => {
                      const key = boundary.kind === 'page' ? 'selected_page_ids' : 'selected_data_source_ids';
                      return (
                        <label key={boundary.id} className="ivc-notion-option">
                          <input
                            type="checkbox"
                            checked={selection[key].includes(boundary.id)}
                            onChange={() => toggleBoundary(boundary)}
                          />
                          <span>{boundary.title}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                <button
                  type="button"
                  className="dash-btn dash-btn--primary ivc-notion-add"
                  onClick={addNotion}
                  disabled={adding || !selectionCount}
                >
                  {selectionCount ? `Add ${selectionCount} page${selectionCount > 1 ? 's' : ''}` : 'Add selected pages'}
                </button>
              </div>
            )}
            {error && <p className="ivc-picker-error" role="alert">{error}</p>}
          </div>
        )}
      </div>

      {error && !pickerOpen && <p className="ivc-picker-error ivc-picker-error--loose" role="alert">{error}</p>}

      <div className="ivc-composer2-hint">
        <span>
          <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
        </span>
        <button type="button" className="ivc-finish-link" onClick={onFinish} disabled={finishDisabled}>
          Finish &amp; build the skill from what Brian has
        </button>
      </div>
    </div>
  );
}

// A compact pill for one attached source: provider mark (or paperclip for an
// upload) + title, with a quiet status while it is still being read or if it
// failed. Reused read-only for finished interviews.
export function SourceChip({ source }) {
  const meta = source.kind === 'connector' ? SOURCES[source.source_type] : null;
  return (
    <li className={`ivc-chip is-${source.status}`}>
      <span className="ivc-chip-icon">
        {meta ? <ProviderLogo provider={meta.logo} label={meta.label} size={14} /> : <AttachGlyph size={13} />}
      </span>
      <span className="ivc-chip-title">{source.title}</span>
      {source.status === 'reading' && <span className="ivc-chip-status">reading…</span>}
      {source.status === 'failed' && <span className="ivc-chip-status is-failed">failed</span>}
    </li>
  );
}
