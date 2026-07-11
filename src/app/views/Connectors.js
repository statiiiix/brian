import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon, icons, msym } from '../../components/Icon';
import { api } from '../api';
import StatusBadge from '../components/StatusBadge';
import TableSkeleton from '../components/TableSkeleton';
import ProviderLogo from '../components/ProviderLogo';
import './Connectors.css';

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
  const connected = rowTypesFor(source).some((type) => rows.find((row) => row.type === type)?.status === 'connected');
  if (connected) return 'connected';
  return provider?.configured ? 'ready' : 'needs_setup';
}

export default function Connectors() {
  const [rows, setRows] = useState(null);
  const [providers, setProviders] = useState(null);
  const [evidence, setEvidence] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [goal, setGoal] = useState('');
  const [results, setResults] = useState({});
  const [catalogFilter, setCatalogFilter] = useState('all');
  const [activeSource, setActiveSource] = useState(null);
  const [authorizationError, setAuthorizationError] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [searchParams] = useSearchParams();

  function load() {
    Promise.all([api('/api/connectors'), api('/api/evidence?status=unpromoted')])
      .then(([nextRows, nextEvidence]) => {
        setRows(nextRows);
        setEvidence(nextEvidence);
      })
      .catch((e) => setError(e.message));
    api('/api/connectors/providers')
      .then(setProviders)
      .catch(() => setProviders({}));
  }

  useEffect(() => {
    load();
    const connectedId = searchParams.get('connected');
    const connectedSource = CONNECTABLE_SOURCES.find((source) => source.id === connectedId);
    if (connectedSource) setMessage(`${connectedSource.label} connected successfully.`);
    if (searchParams.get('error')) setError(searchParams.get('error').replaceAll('_', ' '));
  // The callback query is intentionally only read on first page load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byType = useMemo(() => Object.fromEntries((rows || []).map((row) => [row.type, row])), [rows]);

  useEffect(() => {
    if (!activeSource) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setActiveSource(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [activeSource]);

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

  async function sync(source) {
    setBusy(source.id);
    setError('');
    setMessage('');
    try {
      const activeTypes = source.rowTypes.filter((type) => byType[type]?.status === 'connected');
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
        </div>
        <Link to="/app/build" className="dash-btn dash-btn--ghost"><Icon path={msym.build} size={16} /> Build without a source</Link>
      </header>

      {message && <p className="dash-notice" role="status">{message}</p>}
      {error && <p className="dash-error" role="alert">{error}</p>}

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
            const connected = status === 'connected';
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
                  const connected = status === 'connected';
                  const configured = provider?.configured === true;
                  const acting = busy === source.id;
                  return (
                    <article className="source-roadmap-card" key={source.label}>
                      <div className="source-roadmap-card-head">
                        <span className="source-roadmap-icon"><ProviderLogo provider={source.id} label={source.label} size={18} /></span>
                        <h4>{source.label}</h4>
                        <StatusBadge status={status} />
                      </div>
                      <p>{source.signal}</p>
                      <p className="source-roadmap-note">{configured || connected
                        ? 'Authorize now. Brian stores the connection securely; selecting and learning from its data comes next.'
                        : 'Brian’s OAuth app must be registered once by the Brian team—not by each customer workspace.'}</p>
                      {connected ? (
                        <button type="button" className="source-authorize-btn" disabled={acting} onClick={() => disable(source)}>Disconnect</button>
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
    </div>
  );
}
