# Runbook: monitoring and alerts

This runbook defines Brian's provider-neutral telemetry contract and the
initial alert policy for public signup and MCP OAuth. The repository emits the
events and preserves authoritative database audits; connecting a production
log/metrics provider, creating alert rules, assigning an on-call destination,
and exercising every rule is an external GA gate.

## Safe application event contract

Operational output is newline-delimited JSON. `domain_metric` is a closed
event shape: it has no arbitrary metadata object and contains only finite
metric/outcome/category labels, request class and ID, server-resolved tenant
and connection IDs, and optional sanitized MCP client name/version. Client
labels are ASCII-only, at most 64 characters, and discarded when they look
like credentials or high-entropy token material.

The metric names are:

| `metric` | Server-observable meaning |
|---|---|
| `oauth_discovery` | Brian served, or failed to serve, RFC 9728 protected-resource metadata. |
| `oauth_consent` | The server verified and prepared a consent request, recorded a denial, classified it invalid/expired, or failed while doing so. `prepared` is not final OAuth approval. |
| `mcp_initialize` | An authenticated request reached MCP `initialize`; only sanitized `client_name` and `client_version` are retained. |
| `agent_connection` | Brian prepared, denied, revoked, or failed to mutate a connection. Activation happens in the database hook and is audited there. |
| `principal_resolution` | A cryptographically valid identity/token failed the current membership/grant/tenant resolver. Untrusted claim IDs are not copied into the event. |
| `tenant_authorization` | A logged-in user requested a tenant or tenant-owned connection that was not accessible. The requested identifier is not logged. |
| `invitation` | Invitation creation, boolean preflight, or one-time consumption result. Email and raw invitation token are never logged. |

`http_request` remains the latency/status/route-class source and
`auth_failure` remains the bounded MCP token-validation source. None of these
events reads Authorization headers, query strings, callback URLs, request
bodies, OAuth state/codes, PKCE verifiers, passwords, invitation tokens, or
connector credentials. Do not configure a collector to add raw request
capture around them.

## Authoritative Supabase and database signals

Some required lifecycle events do not cross Brian's Hono process. Treat these
sources as authoritative instead of inferring application events:

- Supabase Auth audit/log streams: signup attempted/completed, email verified,
  OAuth/DCR/token/refresh failures, and provider-side consent activity.
- `security_audit_events`: `tenant.self_signup_created`,
  `membership.provisioned_trusted`, `invitation.accepted`,
  `agent_connection.prepared`, `agent_connection.activated`,
  `oauth.authorization.denied`, and `agent_connection.revoked`.
- Current `agent_connections` rows: active/pending/denied/revoked counts. These
  are gauges from database state, not counters reconstructed from logs.
- Supabase Postgres/Edge logs: provisioning-trigger errors, resolver/database
  exceptions, custom access-token-hook failures, Edge timeouts, and runtime
  failures.

The browser loads consent details directly from Supabase, so Brian cannot
honestly count `consent viewed`. Likewise it cannot distinguish a refresh or
reconnect attempt from another rejected bearer at the resource server. Use
Supabase Auth logs for those events and Brian's `auth_failure` categories for
the resource-side symptom.

Example aggregate checks (counts only; never export audit metadata or customer
rows):

```sql
select event_type, count(*)::bigint
from security_audit_events
where created_at >= now() - interval '15 minutes'
  and event_type in (
    'tenant.self_signup_created',
    'membership.provisioned_trusted',
    'invitation.accepted',
    'agent_connection.prepared',
    'agent_connection.activated',
    'oauth.authorization.denied',
    'agent_connection.revoked'
  )
group by event_type;

select status, count(*)::bigint
from agent_connections
group by status;
```

## Initial alert thresholds

Start with the following thresholds, then tune them only from recorded staging
and production baselines. Ratios use the matching route/flow volume as their
denominator and minimum-volume clauses avoid low-traffic noise.

| Signal | Warning | Page / release stop |
|---|---|---|
| Discovery failure | 1 failure in 5 minutes | 3 failures in 5 minutes, or failure ratio ≥1% with at least 100 discovery requests |
| `wrong_issuer` or `wrong_audience` | 25 combined in 5 minutes | 100 combined in 5 minutes, or ≥5% of at least 100 MCP auth attempts |
| Other token-validation failures | ≥10% of at least 50 MCP auth attempts in 10 minutes | ≥25% of at least 100 attempts in 10 minutes |
| Principal-resolution denial | ≥5% of at least 50 cryptographically valid MCP tokens in 10 minutes | ≥15% of at least 100 in 10 minutes; page immediately when paired with Postgres/resolver errors |
| Tenant-authorization denial | 10 in 10 minutes | 50 in 10 minutes or 5× the trailing 7-day same-hour baseline |
| Consent invalid/expired | ≥10% of at least 20 consent server actions in 15 minutes | ≥25% of at least 40 actions in 15 minutes |
| Consent/connection preparation failure | 1 in 10 minutes | 3 in 10 minutes |
| Activation followed by MCP 401 symptom | At least 3 `agent_connection.activated` audits and ≥20% MCP 401s in the following 10-minute aggregate window | At least 5 activations and ≥50% MCP 401s in that window |
| Signup/provisioning trigger failure | 1 matching Auth/Postgres trigger error | 3 in 10 minutes, or any sustained inability to create the synthetic tenant; set `PUBLIC_SIGNUP_ENABLED=false` |
| DCR registrations | >2× trailing 7-day same-hour baseline | >5× baseline or ≥100 registrations in 10 minutes; stop the release and disable DCR in Supabase |
| MCP initialize failure | ≥2% of at least 50 initializes in 10 minutes | ≥5% of at least 100 in 10 minutes |
| Edge/API server errors | ≥1% of at least 100 requests in 5 minutes | ≥5% of at least 100 in 5 minutes |
| Edge/API p95 latency | >1.5 seconds for 10 minutes | >3 seconds for 5 minutes |
| Edge timeout | 1 in 10 minutes | 3 in 10 minutes |

Consent denial and invalid invitation preflight are normal user/abuse outcomes;
retain them for funnels and anomaly detection but do not page on isolated
events. A resolver denial is intentionally fail-closed and may mean revocation,
suspension, or an outage; correlate it with `auth_failure`, Postgres logs, and
recent changes before classifying an incident.

## Dashboard and correlation

Build one dashboard with these panels:

1. Discovery requests, success ratio, latency, and branded-domain status.
2. Supabase signup → verified → `tenant.self_signup_created` or
   `invitation.accepted` funnel.
3. Consent prepared/denied/expired plus database activations.
4. MCP auth-failure category, principal denials, initialize success ratio, p95
   latency, and sanitized client/version distribution.
5. Active/revoked connection gauges and revocation rate.
6. Tenant-authorization denials, Postgres resolver errors, custom-hook errors,
   DCR volume, and Edge timeouts.

Use `request_id` to correlate Brian request events. Use aggregate time windows
to correlate Supabase-only activity. Never join by copying an access token,
OAuth code/state, callback URL, raw client registration payload, or connector
credential into the monitoring system.

## Rollout and exercise

1. Route JSON logs to the selected provider with body/header/query capture off.
2. Verify field allowlists and retention/access controls in a non-production
   environment.
3. Import Supabase Auth, Postgres, and Edge logs using the provider-supported
   integration; confirm current Supabase plan retention is sufficient.
4. Create the rules above with named owners, on-call destinations, dashboard
   links, and links to the OAuth outage and compromised-connection runbooks.
5. Inject one synthetic event for every rule and record delivery time and
   responder acknowledgement. Do not inject real credentials or customer data.
6. Run a synthetic signup/provisioning/OAuth/MCP/revocation journey and verify
   the expected application metrics and database audits are present.

Repository tests prove the local event shapes and secret exclusions. They do
not prove provider ingestion, Supabase log-drain configuration, alert delivery,
retention, or on-call response. A dated successful exercise remains the GA
evidence gate.

## Dynamic-client registry hygiene

The scheduled DCR workflow runs a count-only audit at minute 17 of every hour.
At 02:41 UTC it enters the protected `production` environment and requests
cleanup of only those dynamic clients that are more than 24 hours old and have
complete negative lifecycle evidence. A manual dispatch defaults to audit;
cleanup requires the boolean input, production-environment approval, and the
CLI's explicit `--delete-stale --yes` pair.

The maintenance database credential must be a dedicated, read-only,
non-owner/non-superuser role. Its startup settings and exact lifecycle schema
are attested before classification. The job stops deletion after the first
provider error. GitHub logs contain one count-only summary and bounded records
with a SHA-256 client-ID hash, age bucket, categorical outcome, and run ID.
Never enable shell tracing, print environment values, or upload raw output,
registration responses, OAuth client metadata, callbacks, or credentials as
artifacts.

Treat registration volume above 2× the trailing seven-day same-hour baseline
as a warning. Stop a release and execute the DCR containment sequence when the
rate exceeds 5× that baseline or reaches 100 registrations in 10 minutes.
Record only the maintenance run ID and aggregate summary in the incident.
