import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, icons, msym } from '../../components/Icon';
import { api } from '../api';
import { readCache, writeCache } from '../queryCache';
import StatusBadge from '../components/StatusBadge';
import TableSkeleton from '../components/TableSkeleton';
import ProviderLogo from '../components/ProviderLogo';
import './Connectors.css';

const EVIDENCE_KEY = '/api/evidence?status=unpromoted';

const SOURCES = [
  {
    id: 'google',
    label: 'Google Workspace',
    icon: icons.gmail,
    rowTypes: ['gmail', 'google_drive'],
    oauth: true,
    blurb: 'Connect Gmail and Google Drive with one read-only consent. Brian can use email threads and Docs, Sheets, and Slides as evidence.',
    capabilities: ['Gmail threads', 'Google Drive documents'],
    permissions: ['Email threads and message metadata', 'Drive files and folders you can access', 'Docs, Sheets, and Slides exported as text'],
    scope: 'Choose the mailboxes and Drive folders Brian should learn from after authorization.',
    available: true,
  },
  {
    id: 'slack',
    label: 'Slack',
    icon: icons.slack,
    rowTypes: ['slack'],
    oauth: true,
    blurb: 'Install Brian with read-only access to selected public and private channels. It filters noise and turns repeated decisions into reviewable evidence.',
    capabilities: ['Channel threads', 'Decision history'],
    permissions: ['Channels where Brian is invited', 'Messages, replies, and user names', 'Channel and thread metadata'],
    scope: 'Invite Brian only to the channels it should learn from.',
    available: true,
  },
];

const LEARNING_GOALS = [
  { label: 'Approval workflow', value: 'Decide when a request can be approved, what evidence is required, and when it must be escalated' },
  { label: 'Customer exception', value: 'Handle a customer exception consistently, including limits, promises, and escalation rules' },
  { label: 'Incident response', value: 'Respond to an operational incident, including severity, ownership, rollback, and communication rules' },
  { label: 'Team handoff', value: 'Run a recurring team handoff without losing context, ownership, deadlines, or edge cases' },
];

const SOURCE_CATEGORIES = [
  {
    id: 'knowledge',
    label: 'Policies & playbooks',
    icon: 'library_books',
    description: 'The process as the company says it should work.',
    sources: [
      { id: 'notion', label: 'Notion', icon: 'description', signal: 'SOPs, team wikis, decision logs', value: 'Documented procedures', permissions: ['Pages shared with Brian', 'Database properties and page content', 'Page owners and update history'], scope: 'Select the pages and teamspaces Brian may read.', priority: 'Recommended next' },
      { id: 'confluence', label: 'Confluence', icon: 'article', signal: 'Policies, runbooks, project knowledge', value: 'Operational playbooks', permissions: ['Selected spaces and pages', 'Page content, labels, and owners', 'Version and update metadata'], scope: 'Choose specific Confluence spaces after authorization.' },
      { id: 'sharepoint', label: 'SharePoint', icon: 'folder_shared', signal: 'Controlled files and company policies', value: 'Enterprise knowledge', permissions: ['Selected SharePoint sites', 'Document libraries and file content', 'Owners and modification metadata'], scope: 'An administrator can limit Brian to approved sites.' },
      { id: 'onedrive', label: 'OneDrive', icon: 'cloud', signal: 'Team files, playbooks, and working documents', value: 'File-based processes', permissions: ['Selected files and folders', 'Supported document content', 'File owners and modification metadata'], scope: 'Choose the folders Brian should index.' },
    ],
  },
  {
    id: 'work',
    label: 'Work systems',
    icon: 'account_tree',
    description: 'The process as the team actually executes it.',
    sources: [
      { id: 'jira', label: 'Jira', icon: 'task_alt', signal: 'Tickets, incident history, acceptance rules', value: 'Delivery and operations', permissions: ['Selected projects and issues', 'Comments, status changes, and history', 'Issue fields and assignees'], scope: 'Choose the Jira projects Brian may analyze.', priority: 'Recommended next' },
      { id: 'linear', label: 'Linear', icon: 'data_object', signal: 'Issues, project updates, triage decisions', value: 'Product workflows', permissions: ['Selected teams and projects', 'Issues, comments, and status history', 'Labels, assignees, and cycles'], scope: 'Choose the Linear teams Brian should learn from.' },
      { id: 'github', label: 'GitHub', icon: 'code', signal: 'Pull requests, reviews, issues, runbooks', value: 'Engineering judgment', permissions: ['Selected repositories', 'Issues, pull requests, and reviews', 'Checks and repository metadata'], scope: 'Install the Brian GitHub app on selected repositories only.' },
      { id: 'asana', label: 'Asana', icon: 'checklist', signal: 'Tasks, approvals, recurring workflows', value: 'Cross-team handoffs', permissions: ['Selected projects and tasks', 'Comments, fields, and status history', 'Assignees and due dates'], scope: 'Choose the projects Brian may read.' },
      { id: 'clickup', label: 'ClickUp', icon: 'done_all', signal: 'Tasks, approvals, and operational checklists', value: 'Recurring operations', permissions: ['Selected spaces, folders, and lists', 'Tasks, comments, and custom fields', 'Assignees and status history'], scope: 'Choose the ClickUp spaces Brian may read.' },
    ],
  },
  {
    id: 'customers',
    label: 'Customer truth',
    icon: 'support_agent',
    description: 'The promises, objections, and edge cases that happen in the real world.',
    sources: [
      { id: 'zendesk', label: 'Zendesk', icon: 'confirmation_number', signal: 'Resolved tickets and escalation paths', value: 'Support playbooks', permissions: ['Selected ticket groups and views', 'Ticket comments, tags, and status history', 'Resolution and satisfaction metadata'], scope: 'Choose the support groups Brian may analyze.', priority: 'Recommended next' },
      { id: 'intercom', label: 'Intercom', icon: 'forum', signal: 'Customer conversations and resolutions', value: 'Service decisions', permissions: ['Selected inboxes and conversations', 'Replies, tags, and assignment history', 'Resolution and customer metadata'], scope: 'Choose the Intercom inboxes Brian may read.' },
      { id: 'hubspot', label: 'HubSpot', icon: 'contacts', signal: 'Deals, qualification, objections, handoffs', value: 'Sales judgment', permissions: ['Selected CRM objects and pipelines', 'Deals, notes, and activities', 'Owners, stages, and outcomes'], scope: 'Choose the pipelines and object types Brian may analyze.' },
      { id: 'salesforce', label: 'Salesforce', icon: 'cloud_sync', signal: 'Opportunities, cases, approvals, outcomes', value: 'Revenue workflows', permissions: ['Selected Salesforce objects', 'Records, activities, and field history', 'Owners, stages, and outcomes'], scope: 'An administrator chooses the objects and fields Brian may read.' },
      { id: 'gong', label: 'Gong', icon: 'graphic_eq', signal: 'Calls, objections, promises, coaching', value: 'Voice-of-customer skills', permissions: ['Selected call libraries', 'Transcripts and call metadata', 'Participants, topics, and outcomes'], scope: 'Choose the teams and call libraries Brian may analyze.' },
    ],
  },
  {
    id: 'conversations',
    label: 'Conversations',
    icon: 'chat',
    description: 'The exceptions, tradeoffs, and rationale people rarely write into policy.',
    sources: [
      { id: 'microsoft_teams', label: 'Microsoft Teams', icon: 'groups', signal: 'Channel decisions and expert answers', value: 'Decision history', permissions: ['Selected teams and channels', 'Messages, replies, and participants', 'Channel and thread metadata'], scope: 'An administrator chooses the teams and channels Brian may read.', priority: 'Recommended next' },
      { id: 'outlook', label: 'Outlook', icon: 'mail', signal: 'Internal threads, approvals, customer exceptions', value: 'Exception handling', permissions: ['Selected mailboxes and folders', 'Email threads and participants', 'Message and folder metadata'], scope: 'Choose the folders and shared mailboxes Brian may read.' },
      { id: 'zoom', label: 'Zoom', icon: 'video_camera_front', signal: 'Decisions, walkthroughs, owner knowledge', value: 'Undocumented processes', permissions: ['Selected cloud recordings', 'Meeting transcripts and summaries', 'Meeting participants and metadata'], scope: 'Choose the users and recording folders Brian may analyze.' },
    ],
  },
];

const CONNECTABLE_SOURCES = [
  ...SOURCES,
  ...SOURCE_CATEGORIES.flatMap((category) => category.sources.map((source) => ({ ...source, rowTypes: [source.id] }))),
];

function rowTypesFor(source) {
  return source.rowTypes || [source.id];
}

function displayStatus(rows, source, provider) {
  if (provider?.configured === false) return 'needs_setup';
  if (provider?.configured === true && provider?.verified === false) return 'unverified';
  const connected = rowTypesFor(source).some((type) => rows.find((row) => row.type === type)?.status === 'connected');
  if (connected) return 'connected';
  return provider?.configured ? 'ready' : 'needs_setup';
}

function safeNotionPermalink(permalink) {
  try {
    const url = new URL(permalink);
    if (url.protocol !== 'https:' || (url.hostname !== 'notion.so' && !url.hostname.endsWith('.notion.so'))) return null;
    return url.href;
  } catch {
    return null;
  }
}

export default function Connectors() {
  // Seeded from the cache so returning to this page paints immediately; load()
  // still refreshes everything in the background.
  const [rows, setRows] = useState(() => readCache('/api/connectors') ?? null);
  const [providers, setProviders] = useState(() => readCache('/api/connectors/providers') ?? null);
  const [evidence, setEvidence] = useState(() => readCache(EVIDENCE_KEY) ?? []);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [goal, setGoal] = useState('');
  const [results, setResults] = useState({});
  const [catalogFilter, setCatalogFilter] = useState('all');
  const [activeSource, setActiveSource] = useState(null);
  const [authorizationError, setAuthorizationError] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [notionPickerOpen, setNotionPickerOpen] = useState(false);
  const [notionBoundaries, setNotionBoundaries] = useState(null);
  const [notionSelection, setNotionSelection] = useState({ selected_page_ids: [], selected_data_source_ids: [] });
  const [notionPickerError, setNotionPickerError] = useState('');
  const [notionPickerBusy, setNotionPickerBusy] = useState('');
  const notionPickerRef = useRef(null);
  const notionPickerPortalRef = useRef(null);
  const notionPickerOpenerRef = useRef(null);
  const notionPickerSyncActionRef = useRef(null);
  const notionPickerDisconnectRef = useRef(null);
  const notionPickerRestoreAfterSaveRef = useRef(false);
  // Fresh-connect flow: auto-open the picker after the OAuth redirect, then
  // hand off to a source-grounded skill interview once the selection is saved.
  const notionAutoFlowRef = useRef(false);
  const notionAutoInterviewRef = useRef(false);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  async function load() {
    const [rowsResult, evidenceResult, providersResult] = await Promise.allSettled([
      api('/api/connectors'),
      api(EVIDENCE_KEY),
      api('/api/connectors/providers'),
    ]);
    if (rowsResult.status === 'fulfilled') {
      setRows(writeCache('/api/connectors', rowsResult.value));
      setRefreshError('');
    } else setRefreshError('We could not refresh connected sources. Please try again.');
    if (evidenceResult.status === 'fulfilled') setEvidence(writeCache(EVIDENCE_KEY, evidenceResult.value));
    if (providersResult.status === 'fulfilled') {
      setProviders(writeCache('/api/connectors/providers', providersResult.value));
    } else setProviders({});
    return rowsResult.status === 'fulfilled';
  }

  useLayoutEffect(() => {
    load();
    const connectedId = searchParams.get('connected');
    const connectedSource = CONNECTABLE_SOURCES.find((source) => source.id === connectedId);
    if (connectedSource) setMessage(`${connectedSource.label} connected successfully.`);
    if (connectedId === 'notion') notionAutoFlowRef.current = true;
    if (searchParams.get('error')) setError(searchParams.get('error').replaceAll('_', ' '));
  // The callback query is intentionally only read on first page load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byType = useMemo(() => Object.fromEntries((rows || []).map((row) => [row.type, row])), [rows]);

  useEffect(() => {
    if (!notionAutoFlowRef.current || notionPickerOpen) return;
    const row = byType.notion;
    if (row?.status !== 'connected') return;
    notionAutoFlowRef.current = false;
    notionAutoInterviewRef.current = true;
    openNotionPicker(row, null);
  // openNotionPicker is stable for this view's lifetime; run when rows arrive.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byType]);

  useEffect(() => {
    if (!activeSource && !notionPickerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && notionPickerOpen) {
        if (!notionPickerBusy) setNotionPickerOpen(false);
      } else if (event.key === 'Escape') {
        setActiveSource(null);
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [activeSource, notionPickerOpen, notionPickerBusy]);

  useLayoutEffect(() => {
    if (notionPickerOpen) {
      const focusable = [...(notionPickerRef.current?.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])') || [])]
        .filter((element) => !element.matches(':disabled') && element.getAttribute('aria-hidden') !== 'true');
      (focusable[0] || notionPickerRef.current)?.focus();
    } else if (notionPickerRestoreAfterSaveRef.current) {
      const action = notionPickerSyncActionRef.current && !notionPickerSyncActionRef.current.disabled
        ? notionPickerSyncActionRef.current
        : notionPickerDisconnectRef.current;
      notionPickerRestoreAfterSaveRef.current = false;
      if (action?.isConnected) action.focus();
    } else if (notionPickerOpenerRef.current?.isConnected) {
      notionPickerOpenerRef.current.focus();
    }
  }, [notionPickerOpen, notionPickerBusy]);

  useEffect(() => {
    if (!notionPickerOpen || !notionPickerPortalRef.current) return undefined;
    const hiddenSiblings = [...document.body.children]
      .filter((element) => element !== notionPickerPortalRef.current)
      .map((element) => ({
        element,
        ariaHidden: element.getAttribute('aria-hidden'),
        hadInert: element.hasAttribute('inert'),
      }));
    hiddenSiblings.forEach(({ element }) => {
      element.setAttribute('aria-hidden', 'true');
      element.setAttribute('inert', '');
    });
    return () => {
      hiddenSiblings.forEach(({ element, ariaHidden, hadInert }) => {
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
        if (!hadInert) element.removeAttribute('inert');
      });
    };
  }, [notionPickerOpen]);

  function openAuthorization(source) {
    setAuthorizationError('');
    setWorkspace('');
    setActiveSource(source);
  }

  async function authorizeSource(source) {
    setBusy(source.id);
    setAuthorizationError('');
    try {
      const query = source.id === 'zendesk' ? `?workspace=${encodeURIComponent(workspace.trim())}` : '';
      const { url } = await api(`/api/connectors/${source.id}/start${query}`);
      window.location.assign(url);
    } catch (e) {
      setAuthorizationError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function disable(source) {
    setBusy(source.id);
    setError('');
    try {
      for (const type of rowTypesFor(source)) {
        if (byType[type]?.status === 'connected') {
          await api(`/api/connectors/${type}/disable`, { method: 'POST' });
        }
      }
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  async function loadNotionBoundaries() {
    setNotionPickerBusy('loading');
    setNotionPickerError('');
    try {
      const response = await api('/api/connectors/notion/boundaries');
      setNotionBoundaries(response);
    } catch {
      setNotionPickerError('We could not load Notion pages. Please try again.');
    } finally {
      setNotionPickerBusy('');
    }
  }

  function closeNotionPicker() {
    if (!notionPickerBusy) setNotionPickerOpen(false);
  }

  function trapNotionPickerFocus(event) {
    if (event.key !== 'Tab') return;
    const focusable = [...(notionPickerRef.current?.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])') || [])]
      .filter((element) => !element.matches(':disabled') && element.getAttribute('aria-hidden') !== 'true');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === notionPickerRef.current || !notionPickerRef.current.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === notionPickerRef.current || !notionPickerRef.current.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  function openNotionPicker(row, opener) {
    notionPickerRestoreAfterSaveRef.current = false;
    notionPickerOpenerRef.current = opener;
    const settings = row?.settings || {};
    setNotionSelection({
      selected_page_ids: Array.isArray(settings.selected_page_ids) ? settings.selected_page_ids : [],
      selected_data_source_ids: Array.isArray(settings.selected_data_source_ids) ? settings.selected_data_source_ids : [],
    });
    setNotionBoundaries(null);
    setNotionPickerError('');
    setNotionPickerOpen(true);
    loadNotionBoundaries();
  }

  function toggleNotionSelection(key, id) {
    setNotionSelection((current) => ({
      ...current,
      [key]: current[key].includes(id) ? current[key].filter((value) => value !== id) : [...current[key], id],
    }));
  }

  async function saveNotionSelection() {
    setNotionPickerBusy('saving');
    setNotionPickerError('');
    try {
      await api('/api/connectors/notion/settings', { method: 'PUT', body: notionSelection });
      if (notionAutoInterviewRef.current) {
        // Fresh-connect flow: Brian reads the selected pages and opens a
        // grounded skill interview immediately.
        setNotionPickerBusy('starting');
        try {
          const interview = await api('/api/interviews', {
            method: 'POST',
            body: { source: { connector: 'notion' } },
          });
          notionAutoInterviewRef.current = false;
          navigate(`/app/interviews/${interview.id}`);
          return;
        } catch {
          notionAutoInterviewRef.current = false;
          setNotionPickerError('Selection saved, but we could not start the skill interview. You can start one from the Interviews page.');
          return;
        }
      }
      const rowsRefreshed = await load();
      if (!rowsRefreshed) {
        setNotionPickerError('We could not refresh your connected sources. Please try again.');
        return;
      }
      notionPickerRestoreAfterSaveRef.current = true;
      setNotionPickerOpen(false);
      setMessage('Notion selection saved. Brian will read only those resources and their children.');
    } catch {
      setNotionPickerError('We could not save your Notion selection. Please try again.');
    } finally {
      setNotionPickerBusy('');
    }
  }

  async function sync(source) {
    setBusy(source.id);
    setError('');
    setMessage('');
    try {
      const activeTypes = rowTypesFor(source).filter((type) => byType[type]?.status === 'connected');
      const summaries = await Promise.all(activeTypes.map((type) => api(`/api/connectors/${type}/sync`, {
        method: 'POST',
        body: { focus: goal.trim() },
      })));
      const summary = summaries.reduce((total, current) => ({
        fetched: total.fetched + current.fetched,
        kept: total.kept + current.kept,
        evidence: total.evidence + current.evidence,
        drafts: total.drafts + current.drafts,
      }), { fetched: 0, kept: 0, evidence: 0, drafts: 0 });
      setResults((current) => ({ ...current, [source.id]: summary }));
      setMessage(summary.drafts > 0
        ? `${summary.drafts} draft${summary.drafts === 1 ? '' : 's'} created. Review them before an agent can use them.`
        : 'Sync complete. Brian found no new cluster strong enough to draft yet.');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="connectors">
      <header className="dash-head sources-head">
        <div>
          <h1 className="dash-title">Sources</h1>
          <p className="dash-subtitle">Read-only evidence from the systems where your company actually decides things.</p>
        </div>
        <Link to="/app/build" className="dash-btn dash-btn--ghost"><Icon path={msym.build} size={16} /> Build without a source</Link>
      </header>

      {message && <p className="dash-notice" role="status">{message}</p>}
      {error && <p className="dash-error" role="alert">{error}</p>}
      {refreshError && <p className="dash-error" role="alert">{refreshError}</p>}

      <section className="dash-card source-focus">
        <div className="source-focus-copy">
          <h2>What should Brian learn?</h2>
          <label className="source-goal-label" htmlFor="source-goal">Learning goal</label>
          <input id="source-goal" className="dash-input" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Approve production access requests without creating a security gap" />
          <div className="source-goal-presets" aria-label="Example learning goals">
            {LEARNING_GOALS.map((item) => (
              <button type="button" key={item.label} onClick={() => setGoal(item.value)}>{item.label}</button>
            ))}
          </div>
        </div>
      </section>

      <div className="source-section-head">
        <h2>Connected sources</h2>
      </div>

      {rows === null && !error && <TableSkeleton rows={2} />}

      {rows !== null && (
        <div className="connectors-grid">
          {SOURCES.map((source) => {
            const provider = providers?.[source.id];
            const status = displayStatus(rows, source, provider);
            const connected = rowTypesFor(source).some((type) => rows.find((row) => row.type === type)?.status === 'connected');
            const configured = provider?.configured === true;
            const acting = busy === source.id;
            const result = results[source.id];
            return (
              <section key={source.id} className="dash-card connectors-card">
                <div className="connectors-card-head">
                  <span className="connectors-icon"><ProviderLogo provider={source.id} label={source.label} size={19} /></span>
                  <div className="connectors-card-title"><span>Source</span><h3>{source.label}</h3></div>
                  <StatusBadge status={status} />
                </div>
                <div className="source-capabilities">
                  {source.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
                </div>

                {connected && source.rowTypes.some((type) => byType[type]?.last_synced_at) && (
                  <p className="connectors-meta dash-mono">Last synced {new Date(source.rowTypes.map((type) => byType[type]?.last_synced_at).filter(Boolean).sort().at(-1)).toLocaleString()}</p>
                )}

                <div className="connectors-actions">
                  {!connected && (
                    <button type="button" className="dash-btn dash-btn--primary" disabled={acting || !configured} onClick={() => openAuthorization(source)}>
                      <Icon path="lock_open" size={15} /> Authorize {source.label}
                    </button>
                  )}
                  {connected && <>
                    <button type="button" className="dash-btn dash-btn--primary" disabled={acting || !goal.trim()} onClick={() => sync(source)}>{acting ? 'Finding evidence…' : 'Sync focused source'}</button>
                    <button type="button" className="dash-btn dash-btn--ghost" disabled={acting} onClick={() => disable(source)}>Disconnect</button>
                  </>}
                </div>
                {!connected && !configured && <p className="connectors-hint connectors-setup"><Icon path="info" size={15} /> {providers === null ? 'Checking OAuth setup…' : 'Brian’s OAuth app still needs to be registered by the Brian team.'}</p>}
                {connected && !goal.trim() && <p className="connectors-hint">Add a process above before syncing so Brian knows what signal to prioritize.</p>}
                {result && <p className="connectors-result" role="status">Fetched {result.fetched} · kept {result.kept} · evidence {result.evidence} · drafts {result.drafts}</p>}
              </section>
            );
          })}
        </div>
      )}

      <section className="source-library">
        <div className="source-library-head">
          <h2>More sources</h2>
        </div>

        <div className="source-filters" role="group" aria-label="Filter source roadmap">
          <button type="button" className={catalogFilter === 'all' ? 'is-active' : ''} onClick={() => setCatalogFilter('all')}>All sources</button>
          {SOURCE_CATEGORIES.map((category) => (
            <button type="button" key={category.id} className={catalogFilter === category.id ? 'is-active' : ''} onClick={() => setCatalogFilter(category.id)}>{category.label}</button>
          ))}
        </div>

        <div className="source-category-list">
          {SOURCE_CATEGORIES.filter((category) => catalogFilter === 'all' || category.id === catalogFilter).map((category) => (
            <section className="source-category" key={category.id}>
              <div className="source-category-head">
                <span><Icon path={category.icon} size={17} /></span>
                <h3>{category.label}</h3>
              </div>
              <div className="source-roadmap-grid">
                {category.sources.map((source) => {
                  const provider = providers?.[source.id];
                  const status = displayStatus(rows || [], source, provider);
                  const connected = rowTypesFor(source).some((type) => (rows || []).find((row) => row.type === type)?.status === 'connected');
                  const configured = provider?.configured === true;
                  const unverified = configured && provider?.verified === false;
                  const acting = busy === source.id;
                  const notionNeedsSelection = source.id === 'notion' && connected && byType.notion?.selection_ready === false;
                  const lastSynced = byType[source.id]?.last_synced_at;
                  const result = results[source.id];
                  return (
                    <article className="source-roadmap-card" key={source.label}>
                      <div className="source-roadmap-card-head">
                        <span className="source-roadmap-icon"><ProviderLogo provider={source.id} label={source.label} size={18} /></span>
                        <h4>{source.label}</h4>
                        <StatusBadge status={status} />
                      </div>
                      <p>{source.signal}</p>
                      {(unverified || !connected) && <p className="source-roadmap-note">{unverified
                        ? 'OAuth is configured, but production data access has not been verified with a dated check.'
                        : configured
                        ? 'Authorize to run a dated production verification, then sync it against your learning goal.'
                        : 'Brian’s OAuth app must be registered once by the Brian team—not by each customer workspace.'}</p>}
                      {connected && lastSynced && <p className="source-roadmap-note dash-mono">Last synced {new Date(lastSynced).toLocaleString()}</p>}
                      {notionNeedsSelection && <p className="source-roadmap-note">Choose the Notion pages and data sources Brian may read before syncing.</p>}
                      {connected && !notionNeedsSelection && !goal.trim() && <p className="source-roadmap-note">Add a learning goal above so Brian knows what signal to prioritize.</p>}
                      {result && <p className="source-roadmap-note connectors-result" role="status">Fetched {result.fetched} · kept {result.kept} · evidence {result.evidence} · drafts {result.drafts}</p>}
                      {connected ? (
                        <div className="source-roadmap-actions">
                          {notionNeedsSelection ? (
                            <button type="button" className="source-authorize-btn" disabled={acting} onClick={(event) => openNotionPicker(byType.notion, event.currentTarget)}>Choose Notion pages</button>
                          ) : (
                            <button ref={source.id === 'notion' ? notionPickerSyncActionRef : null} type="button" className="source-authorize-btn" disabled={acting || !goal.trim()} onClick={() => sync(source)}>
                              <Icon path="sync" size={14} /> {acting ? 'Finding evidence…' : 'Sync focused source'}
                            </button>
                          )}
                          <button ref={source.id === 'notion' ? notionPickerDisconnectRef : null} type="button" className="source-authorize-btn source-disconnect-btn" disabled={acting} onClick={() => disable(source)}>Disconnect</button>
                        </div>
                      ) : (
                        <button type="button" className="source-authorize-btn" disabled={acting || !configured} onClick={() => openAuthorization(source)}>
                          <Icon path={configured ? 'lock_open' : 'settings'} size={14} /> {configured ? `Authorize ${source.label}` : 'Setup required'}
                        </button>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section className="source-evidence">
        <div className="overview-section-head">
          <h2>Evidence</h2>
          <Link to="/app/review" className="overview-text-link">Open review queue →</Link>
        </div>
        {evidence.length === 0 ? (
          <div className="dash-card overview-empty-activity"><Icon path={icons.search} size={20} /><span>Sync a focused source and Brian will surface recurring rules here.</span></div>
        ) : (
          <div className="source-evidence-grid">
            {evidence.slice(0, 8).map((item) => (
              <article className="dash-card source-evidence-card" key={item.id}>
                <div className="source-evidence-card-head"><span className="source-evidence-kind">{item.kind.replace('_', ' ')}</span><span className="dash-mono">{Math.round(item.confidence * 100)}% confidence</span></div>
                <p>{item.summary}</p>
                {item.source_ref?.permalink && <a href={item.source_ref.permalink} target="_blank" rel="noreferrer">Open source →</a>}
              </article>
            ))}
          </div>
        )}
      </section>

      {activeSource && createPortal(
        <div className="dash source-auth-portal">
          <div className="source-auth-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveSource(null); }}>
            <section className="source-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="source-auth-title">
            <button type="button" className="source-auth-close" aria-label="Close authorization" onClick={() => setActiveSource(null)} autoFocus><Icon path="close" size={18} /></button>
            <div className="source-auth-brand"><ProviderLogo provider={activeSource.id} label={activeSource.label} size={23} /></div>
            <p className="sources-kicker">Secure connection</p>
            <h2 id="source-auth-title">Authorize {activeSource.label}</h2>
            <p className="source-auth-intro">You’ll continue to {activeSource.label} to approve read-only access. Brian never receives your password and never writes back to the source.</p>

            <div className="source-auth-permissions">
              <p>Brian will request access to</p>
              {activeSource.permissions.map((permission) => <span key={permission}><Icon path="check" size={14} /> {permission}</span>)}
            </div>

            <div className="source-auth-scope"><Icon path="admin_panel_settings" size={18} /><span><strong>You control the scope.</strong> {activeSource.scope}</span></div>

            {activeSource.id === 'zendesk' && (
              <label className="source-auth-workspace">
                <span>Zendesk subdomain</span>
                <div className="source-auth-workspace-input">
                  <input className="dash-input" value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="acme" autoComplete="organization" />
                  <span>.zendesk.com</span>
                </div>
              </label>
            )}

            <ol className="source-auth-steps">
              <li><span>1</span> Approve access</li>
              <li><span>2</span> Return to Brian</li>
              <li><span>3</span> Connection saved</li>
            </ol>

            {authorizationError && <p className="dash-error source-auth-error" role="alert">{authorizationError}</p>}
            <div className="source-auth-actions">
              <button type="button" className="dash-btn dash-btn--ghost" onClick={() => setActiveSource(null)}>Cancel</button>
              <button type="button" className="dash-btn dash-btn--primary" disabled={busy === activeSource.id || (activeSource.id === 'zendesk' && !workspace.trim())} onClick={() => authorizeSource(activeSource)}>
                {busy === activeSource.id ? 'Opening authorization…' : `Continue to ${activeSource.label}`}
                <Icon path="open_in_new" size={15} />
              </button>
            </div>
            </section>
          </div>
        </div>,
        document.body,
      )}

      {notionPickerOpen && createPortal(
        <div className="dash notion-selection-portal" ref={notionPickerPortalRef}>
          <div className="notion-selection-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeNotionPicker(); }}>
            <section className="notion-selection-dialog" role="dialog" aria-modal="true" aria-labelledby="notion-selection-title" ref={notionPickerRef} tabIndex="-1" onKeyDown={trapNotionPickerFocus}>
              <button type="button" className="notion-selection-close" aria-label="Close Notion page selection" onClick={closeNotionPicker} disabled={Boolean(notionPickerBusy)}><Icon path="close" size={18} /></button>
              <div className="notion-selection-brand"><ProviderLogo provider="notion" label="Notion" size={23} /></div>
              <p className="notion-selection-kicker">Read-only scope</p>
              <h2 id="notion-selection-title">Choose Notion pages</h2>
              <p className="notion-selection-intro">Brian will read only the resources you select and their children. Notion’s provider-side picker controls what is available here.</p>

              {notionPickerError && <p className="dash-error notion-selection-error" role="alert">{notionPickerError}</p>}
              {notionPickerError && <button type="button" className="notion-selection-retry" onClick={loadNotionBoundaries} disabled={Boolean(notionPickerBusy)}>Try again</button>}
              {notionPickerBusy === 'loading' && <p role="status" className="notion-selection-status">Loading available Notion resources…</p>}
              {notionBoundaries && <>
                {notionBoundaries.truncated && <p className="notion-selection-notice" role="status">Only the first bounded set is shown. You can narrow what you share in Notion and try again; this list may be incomplete.</p>}
                {[
                  ['page', 'selected_page_ids', 'Pages'],
                  ['data_source', 'selected_data_source_ids', 'Data sources'],
                ].map(([kind, key, label]) => {
                  const resources = notionBoundaries.boundaries.filter((boundary) => boundary.kind === kind);
                  return (
                    <fieldset className="notion-selection-group" key={kind} disabled={Boolean(notionPickerBusy)}>
                      <legend>{label}</legend>
                      {resources.length === 0 ? <p>No {label.toLowerCase()} are available from this connection.</p> : resources.map((resource, index) => {
                        const inputId = `notion-${kind}-${index}`;
                        const permalink = safeNotionPermalink(resource.permalink);
                        return (
                          <div className="notion-selection-option" key={resource.id}>
                            <input id={inputId} type="checkbox" checked={notionSelection[key].includes(resource.id)} onChange={() => toggleNotionSelection(key, resource.id)} />
                            <label htmlFor={inputId}>{resource.title}</label>
                            {permalink && <a href={permalink} target="_blank" rel="noreferrer" aria-label={`Open ${resource.title} in Notion`} onClick={(event) => event.stopPropagation()}>Open in Notion</a>}
                          </div>
                        );
                      })}
                    </fieldset>
                  );
                })}
              </>}
              <div className="notion-selection-actions">
                <button type="button" className="dash-btn dash-btn--ghost" disabled={Boolean(notionPickerBusy)} onClick={closeNotionPicker}>Cancel</button>
                <button type="button" className="dash-btn dash-btn--primary" disabled={Boolean(notionPickerBusy) || notionSelection.selected_page_ids.length + notionSelection.selected_data_source_ids.length === 0} onClick={saveNotionSelection}>
                  {notionPickerBusy === 'saving' ? 'Saving selection…'
                    : notionPickerBusy === 'starting' ? 'Reading pages & starting interview…'
                      : 'Save selection'}
                </button>
              </div>
            </section>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
