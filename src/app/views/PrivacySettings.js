import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { api } from '../api';
import { readCache, writeCache } from '../queryCache';
import { useAuth } from '../auth';
import './PrivacySettings.css';

const PRIVACY_KEY = '/api/privacy/deletion-requests';
const ACCOUNT_CONFIRMATION = 'DELETE MY ACCOUNT';

function revocationNotice(scope) {
  return scope === 'account'
    ? 'Account deletion scheduled. Your local agent connections and Brian legacy agent credentials attributed to your account have been revoked.'
    : 'Company deletion scheduled. The company’s local agent connections and legacy agent credentials have been revoked, and its stored connector credentials and sync cursors have been erased.';
}

function revocationWarning(scope) {
  return scope === 'account'
    ? 'Submitting this request immediately revokes your local agent connections and Brian legacy agent credentials attributed to your account. Shared company connector credentials are not erased by an account request. Cancelling later will not restore revoked access.'
    : 'Submitting this request immediately revokes the company’s local agent connections and legacy agent credentials, and erases its stored connector credentials and sync cursors. Cancelling later will not restore them.';
}

function requestId(request) {
  return request.id || request.request_id || request.requestId;
}

function requestScope(request) {
  return request.scope || request.deletion_scope || request.deletionScope;
}

function requestStatus(request) {
  return request.status || 'pending';
}

function scheduledTimestamp(request) {
  return request.scheduled_for
    || request.scheduledFor
    || request.execute_after
    || request.executeAfter
    || request.deletion_at
    || request.deletionAt;
}

function formatSchedule(value) {
  if (!value) return 'Scheduled date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Scheduled date unavailable';
  return date.toLocaleString(undefined, {
    dateStyle: 'long',
    timeStyle: 'short',
  });
}

function activeRequest(requests, scope) {
  return requests.find((request) =>
    requestScope(request) === scope && ['pending', 'processing'].includes(requestStatus(request))
  );
}

export default function PrivacySettings() {
  const { profile } = useAuth();
  const [requests, setRequests] = useState(() => readCache(PRIVACY_KEY) ?? null);
  const [confirmScope, setConfirmScope] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);

  const currentTenant = profile?.currentTenant || profile?.current_tenant;
  const currentMembership = useMemo(() => {
    if (profile?.currentMembership) return profile.currentMembership;
    const tenantId = currentTenant?.id;
    return (profile?.memberships || []).find((membership) =>
      (membership.tenant_id || membership.tenantId || membership.tenant?.id) === tenantId
    );
  }, [currentTenant?.id, profile]);
  const isOwner = (currentMembership?.role || profile?.user?.role || '').toLowerCase() === 'owner';
  const companyName = currentTenant?.name || '';

  const load = useCallback(async () => {
    setError('');
    setLoadFailed(false);
    try {
      const payload = await api('/api/privacy/deletion-requests');
      setRequests(writeCache(PRIVACY_KEY, Array.isArray(payload?.requests) ? payload.requests : []));
    } catch (loadError) {
      setError(loadError.message || 'Unable to load deletion requests.');
      setRequests([]);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const accountRequest = activeRequest(requests || [], 'account');
  const companyRequest = activeRequest(requests || [], 'company');
  const confirmationPhrase = confirmScope === 'account' ? ACCOUNT_CONFIRMATION : companyName;

  function openConfirmation(scope) {
    setError('');
    setNotice('');
    setConfirmation('');
    setConfirmScope(scope);
  }

  function closeConfirmation() {
    if (busy) return;
    setConfirmScope('');
    setConfirmation('');
  }

  async function scheduleDeletion(event) {
    event.preventDefault();
    if (!confirmScope || confirmation !== confirmationPhrase) return;

    const scope = confirmScope;
    setBusy(`create:${scope}`);
    setError('');
    setNotice('');
    try {
      const payload = await api('/api/privacy/deletion-requests', {
        method: 'POST',
        body: { scope },
      });
      const nextRequest = payload?.request;
      if (!nextRequest) throw new Error('The deletion request was not returned.');
      setRequests((current) => [
        nextRequest,
        ...(current || []).filter((request) =>
          requestScope(request) !== scope || !['pending', 'processing'].includes(requestStatus(request))
        ),
      ]);
      setConfirmScope('');
      setConfirmation('');
      setNotice(revocationNotice(scope));
    } catch (scheduleError) {
      setError(scheduleError.message || 'Unable to schedule deletion.');
    } finally {
      setBusy('');
    }
  }

  async function cancelDeletion(request) {
    const id = requestId(request);
    if (!id) {
      setError('This deletion request cannot be cancelled because its identifier is missing.');
      return;
    }

    setBusy(`cancel:${id}`);
    setError('');
    setNotice('');
    try {
      const payload = await api(`/api/privacy/deletion-requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const cancelled = payload?.request;
      setRequests((current) => (current || []).map((item) => requestId(item) === id
        ? (cancelled || { ...item, status: 'cancelled' })
        : item));
      setNotice('Deletion cancelled. Previously revoked credentials and connections were not restored.');
    } catch (cancelError) {
      setError(cancelError.message || 'Unable to cancel deletion.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="privacy-page">
      <header className="dash-head">
        <div>
          <p className="privacy-kicker">Settings</p>
          <h1 className="dash-title">Privacy & deletion</h1>
          <p className="dash-subtitle">Schedule deletion of your Brian account or, for owners, the current company workspace.</p>
        </div>
      </header>

      {error && <p className="dash-error" role="alert">{error}</p>}
      {notice && <p className="dash-notice" role="status">{notice}</p>}

      <section className="privacy-policy-note" aria-labelledby="privacy-grace-title">
        <span className="privacy-note-icon"><Icon path="schedule" size={20} /></span>
        <div>
          <h2 id="privacy-grace-title">30-day default grace period</h2>
          <p>Deletion is scheduled 30 days after a request by default. You can cancel before its scheduled time while it is pending, but cancellation does not restore credentials or connections revoked when the request was made.</p>
        </div>
      </section>

      <p className="privacy-revocation-note">
        Account requests revoke that user’s local agent connections and attributable legacy agent credentials; they do not erase connector credentials shared by the company. Company requests revoke company agent access and erase its stored connector credentials and sync cursors. Provider-side revocation or erasure may still require operator completion; this page does not claim that external provider data has already been erased.
      </p>

      {requests === null ? (
        <p className="privacy-loading" role="status">Loading deletion requests…</p>
      ) : loadFailed ? (
        <div className="privacy-load-failed">
          <p>Deletion controls stay unavailable until Brian can verify whether a request is already pending.</p>
          <button type="button" className="dash-btn dash-btn--ghost" onClick={load}>Try again</button>
        </div>
      ) : (
        <div className="privacy-grid">
          <DeletionCard
            title="Delete your account"
            description="Request deletion of your Brian account and its memberships. Every member can make this request. A last owner must transfer ownership or delete the company first."
            request={accountRequest}
            actionLabel="Request account deletion"
            onRequest={() => openConfirmation('account')}
            onCancel={cancelDeletion}
            busy={busy}
          />

          <DeletionCard
            title="Delete this company"
            description={`Request deletion of ${companyName || 'the current company'} and its Brian-held workspace data. This action is available only to a current owner.`}
            request={companyRequest}
            actionLabel="Request company deletion"
            onRequest={() => openConfirmation('company')}
            onCancel={cancelDeletion}
            busy={busy}
            allowed={isOwner && Boolean(companyName)}
            unavailableMessage={isOwner
              ? 'Company details are still loading. Try again shortly.'
              : 'Only a current company owner can request company deletion.'}
          />
        </div>
      )}

      {confirmScope && (
        <div className="privacy-dialog-backdrop">
          <section
            className="privacy-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="privacy-dialog-title"
            aria-describedby="privacy-dialog-warning"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeConfirmation();
                return;
              }
              if (event.key !== 'Tab') return;
              const controls = Array.from(event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled)'));
              if (!controls.length) return;
              const first = controls[0];
              const last = controls[controls.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <button type="button" className="privacy-dialog-close" aria-label="Close deletion confirmation" onClick={closeConfirmation} disabled={Boolean(busy)}>
              <Icon path="close" size={19} />
            </button>
            <span className="privacy-dialog-icon"><Icon path="warning" size={23} /></span>
            <h2 id="privacy-dialog-title">Confirm {confirmScope} deletion</h2>
            <p id="privacy-dialog-warning">{revocationWarning(confirmScope)}</p>
            <form onSubmit={scheduleDeletion}>
              <label htmlFor="privacy-confirmation">Type <code>{confirmationPhrase}</code> exactly to continue</label>
              <input
                id="privacy-confirmation"
                className="dash-input"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                spellCheck="false"
                autoFocus
              />
              <div className="privacy-dialog-actions">
                <button type="button" className="dash-btn dash-btn--ghost" onClick={closeConfirmation} disabled={Boolean(busy)}>Keep {confirmScope}</button>
                <button type="submit" className="dash-btn dash-btn--danger privacy-confirm-button" disabled={confirmation !== confirmationPhrase || Boolean(busy)}>
                  {busy ? 'Scheduling…' : `Schedule ${confirmScope} deletion`}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function DeletionCard({
  title,
  description,
  request,
  actionLabel,
  onRequest,
  onCancel,
  busy,
  allowed = true,
  unavailableMessage = '',
}) {
  const id = request && requestId(request);
  const cancelling = Boolean(id) && busy === `cancel:${id}`;
  const pending = request && requestStatus(request) === 'pending';
  const scheduledMs = request ? new Date(scheduledTimestamp(request)).getTime() : Number.NaN;
  const [cutoffTick, setCutoffTick] = useState(0);
  const beforeCutoff = pending && Number.isFinite(scheduledMs) && scheduledMs > Date.now();

  useEffect(() => {
    if (!pending || !Number.isFinite(scheduledMs)) return undefined;
    const remaining = scheduledMs - Date.now();
    if (remaining <= 0) return undefined;
    // Browser timers cap near 24.8 days, shorter than the default grace period.
    // Wake in bounded chunks, then re-render exactly when the cutoff passes.
    const timer = window.setTimeout(
      () => setCutoffTick((value) => value + 1),
      Math.min(remaining + 25, 2_147_000_000),
    );
    return () => window.clearTimeout(timer);
  }, [cutoffTick, pending, scheduledMs]);

  return (
    <section className="privacy-card">
      <div className="privacy-card-head">
        <span><Icon path="delete_forever" size={21} /></span>
        <div><h2>{title}</h2><p>{description}</p></div>
      </div>

      {request ? (
        <div className="privacy-pending" role="status">
          <div className="privacy-pending-head"><strong>{pending ? 'Pending deletion' : 'Deletion in progress'}</strong><span>{requestStatus(request)}</span></div>
          <p>{pending ? 'Scheduled for' : 'Originally scheduled for'} <time dateTime={scheduledTimestamp(request) || undefined}>{formatSchedule(scheduledTimestamp(request))}</time>.</p>
          {beforeCutoff ? (
            <button type="button" className="dash-btn dash-btn--ghost" onClick={() => onCancel(request)} disabled={Boolean(busy)}>
              {cancelling ? 'Cancelling…' : 'Cancel deletion request'}
            </button>
          ) : pending ? (
            <p className="privacy-processing-note">
              {Number.isFinite(scheduledMs)
                ? 'The scheduled time has passed, so this request can no longer be cancelled.'
                : 'The cancellation cutoff is unavailable; reload before trying again.'}
            </p>
          ) : <p className="privacy-processing-note">Processing has started, so this request can no longer be cancelled here.</p>}
        </div>
      ) : allowed ? (
        <button type="button" className="dash-btn dash-btn--danger" onClick={onRequest} disabled={Boolean(busy)}>{actionLabel}</button>
      ) : (
        <p className="privacy-unavailable">{unavailableMessage}</p>
      )}
    </section>
  );
}
