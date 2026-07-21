import { useEffect, useRef, useState } from 'react';
import { api, apiForm } from '../api';
import './InterviewSources.css';

const ACCEPT = '.pdf,.docx,.png,.jpg,.jpeg,.webp';
const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;

export default function InterviewSources({
  interviewId = null,
  sources = [],
  onSourcesChange,
  pendingFiles = [],
  onPendingFilesChange,
  notionSelection = null,
  onNotionSelectionChange,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [boundaries, setBoundaries] = useState(null);
  const [selection, setSelection] = useState(notionSelection || { selected_page_ids: [], selected_data_source_ids: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (notionSelection) setSelection(notionSelection);
  }, [notionSelection]);

  async function loadNotion() {
    setError('');
    setBusy(true);
    try {
      const result = await api('/api/connectors/notion/boundaries');
      setBoundaries(result.boundaries || []);
    } catch (e) {
      setError(e.message === 'Notion is not connected'
        ? 'Connect Notion first, then choose a page.' : e.message);
    } finally {
      setBusy(false);
    }
  }

  function toggleBoundary(boundary) {
    const key = boundary.kind === 'page' ? 'selected_page_ids' : 'selected_data_source_ids';
    setSelection((current) => {
      const exists = current[key].includes(boundary.id);
      return { ...current, [key]: exists ? current[key].filter((id) => id !== boundary.id) : [...current[key], boundary.id] };
    });
  }

  async function addNotion() {
    const count = selection.selected_page_ids.length + selection.selected_data_source_ids.length;
    if (!count) return setError('Choose at least one Notion page.');
    setError('');
    if (!interviewId) {
      onNotionSelectionChange?.(selection);
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const next = await api(`/api/interviews/${interviewId}/sources/connector`, {
        method: 'POST',
        body: { connector: 'notion', selection },
      });
      onSourcesChange?.(next);
      setOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function chooseFiles(event) {
    const chosen = [...event.target.files];
    event.target.value = '';
    const existingUploads = sources.filter((source) => source.kind === 'upload').length;
    if (existingUploads + pendingFiles.length + chosen.length > MAX_FILES) {
      return setError('Each interview can include up to five uploaded files.');
    }
    const oversized = chosen.find((file) => file.size > MAX_BYTES);
    if (oversized) return setError(`${oversized.name} is larger than 10 MB.`);
    setError('');
    if (!interviewId) {
      onPendingFilesChange?.([...pendingFiles, ...chosen]);
      return;
    }
    setBusy(true);
    try {
      let next = [...sources];
      for (const file of chosen) {
        const form = new FormData();
        form.set('file', file);
        const uploaded = await apiForm(`/api/interviews/${interviewId}/sources/upload`, form);
        next = [...next.filter((source) => source.id !== uploaded.id), uploaded];
        onSourcesChange?.(next);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = selection.selected_page_ids.length + selection.selected_data_source_ids.length;
  return (
    <div className="interview-sources">
      <button type="button" className="dash-btn dash-btn--ghost interview-sources-add" onClick={() => setOpen((value) => !value)} disabled={disabled || busy}>
        + Add source
      </button>
      {open && (
        <div className="interview-sources-popover">
          <div className="interview-sources-actions">
            <button type="button" className="dash-btn dash-btn--ghost" onClick={loadNotion} disabled={busy}>Choose Notion pages</button>
            <button type="button" className="dash-btn dash-btn--ghost" onClick={() => inputRef.current?.click()} disabled={busy}>Upload files</button>
            <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={chooseFiles} />
          </div>
          {boundaries && (
            <div className="interview-sources-notion">
              <p>Choose the pages Brian should learn from for this skill.</p>
              <div className="interview-sources-options">
                {boundaries.map((boundary) => {
                  const key = boundary.kind === 'page' ? 'selected_page_ids' : 'selected_data_source_ids';
                  return (
                    <label key={boundary.id}>
                      <input type="checkbox" checked={selection[key].includes(boundary.id)} onChange={() => toggleBoundary(boundary)} />
                      <span>{boundary.title}</span>
                    </label>
                  );
                })}
              </div>
              <button type="button" className="dash-btn dash-btn--primary" onClick={addNotion} disabled={busy || !selectedCount}>Add selected pages</button>
            </div>
          )}
          {error && <p className="dash-error" role="alert">{error}</p>}
        </div>
      )}
      {(sources.length > 0 || pendingFiles.length > 0 || notionSelection) && (
        <ul className="interview-sources-list">
          {notionSelection && !interviewId && <li><span>Notion pages</span><small>{selectedCount} selected</small></li>}
          {pendingFiles.map((file) => <li key={`${file.name}-${file.size}`}><span>{file.name}</span><small>ready to upload</small></li>)}
          {sources.map((source) => <li key={source.id}><span>{source.title}</span><small className={`is-${source.status}`}>{source.status}</small></li>)}
        </ul>
      )}
    </div>
  );
}
