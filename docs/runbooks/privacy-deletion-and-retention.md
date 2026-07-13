# Privacy deletion and retention runbook

Brian supports account and company deletion through a grace-period workflow.
The operational default is **30 days**. Set `BRIAN_DELETION_GRACE_DAYS` to an
integer from 1 through 365 only after the published Privacy Policy and legal
requirements use the same value. The code default is an operational safeguard,
not a substitute for reviewed legal copy.

## Lifecycle and irreversible scheduling effects

Scheduling either scope creates an immutable-at-runtime audit event and a
`pending` deletion request with an exact `scheduledFor` timestamp.

- Account deletion is available to every active member. It fails closed if the
  user is the sole active owner of any company. Scheduling immediately revokes
  all of that user's OAuth agent connections across companies and any legacy
  credentials that were verifiably issued by that user. The user retains
  dashboard access during the grace period to inspect or cancel the request,
  while database triggers block replacement agent grants or attributable
  legacy credentials until the request is cancelled.
- Imported and bootstrap legacy credentials have no creator attribution. They
  remain tenant-owned and are revoked by company deletion or the separate
  legacy-token retirement process; account deletion never guesses ownership.
- Company deletion is owner-only. Scheduling immediately suspends the company,
  revokes every agent connection and legacy credential, disables every
  connector, and destroys Brian's stored connector credentials and cursors.

Cancellation is allowed only before `scheduledFor`. It never restores an agent
connection, legacy token, connector credential, or cursor. Cancelling the same
owner's pending company deletion reactivates that company; no ordinary runtime
role can write `tenants.status` directly.

Connector erasure revokes Brian's ability to use the credential. Where a
provider also exposes an installed-app/token revocation control, the customer
should revoke Brian from that provider as a parallel operational step. Never
copy a connector credential out of the database to perform that step.

## Dry-run and confirmed maintenance

Use a database-owner connection, never the `brian_app` runtime credential.
Account deletion also needs `SUPABASE_URL` and either
`SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`. These values are read only
from the environment and are never printed.

Preview all due work and retention counts (the default is dry-run):

```bash
cd server
npm run privacy:maintain -- --all
```

Process due requests and prune one bounded batch only after reviewing the
preview:

```bash
npm run privacy:maintain -- --all --limit 1000 --confirm
```

The scopes can run separately:

```bash
npm run privacy:maintain -- --process-due --confirm
npm run privacy:maintain -- --prune-retention --confirm
```

The command refuses mutations unless the database session is the table owner or
a superuser. Output contains aggregate counts and fixed error categories only;
it never contains email addresses, user tokens, service keys, connector
credentials, or provider response bodies.

## Account deletion specifics

The worker uses the server-only Supabase Auth Admin hard-delete endpoint. A 404
is treated as idempotent success so a retry after a process crash can finish the
request. Supabase documents two important constraints:

1. An Auth user that owns Supabase Storage objects cannot be deleted. Remove or
   reassign those objects through the approved Storage process first.
2. A previously issued JWT remains cryptographically valid until its expiry.
   Brian still rejects it immediately because deleting the Auth user cascades
   their memberships and every dashboard/MCP principal resolution re-checks an
   active server-side membership/grant.

The worker repeats the last-owner check at processing time. The database's
deferred last-owner constraint remains the final race-safe backstop if ownership
changes between scheduling and the Auth Admin call.

## Company deletion specifics

Due company deletion runs in one owner transaction and deletes tenant data in
foreign-key-safe order. Human Auth accounts are retained because a user can
belong to other companies. `security_audit_events` and the deletion request are
retained as evidence with their tenant foreign key set to `NULL`; runtime roles
cannot update or delete that evidence.

Before a production run:

1. Confirm the request is past its displayed grace timestamp.
2. Confirm a recent backup/restore exercise and any legal hold requirements.
3. Run the dry-run and record the aggregate counts in the change record.
4. Run a bounded confirmed batch.
5. Verify the completed request and `privacy.*_deletion.completed` audit event.
6. Re-run dry-run; a large unexpected remainder is an incident signal.

## Retention

Defaults are:

- Security audit events: `365` days (`SECURITY_AUDIT_RETENTION_DAYS`).
- Execution logs: `180` days (`EXECUTION_LOG_RETENTION_DAYS`).

Both values accept integers from 1 through 3650. Pruning is owner-only, bounded
to 10,000 rows per table per invocation, dry-run by default, and requires
`--confirm`. Every confirmed batch appends a new aggregate
`privacy.retention.pruned` event after pruning. Change these periods only when
the published policy, contractual obligations, legal holds, and backup policy
have been reviewed together.
