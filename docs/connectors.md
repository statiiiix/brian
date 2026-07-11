# Connectors — mine Google Workspace + Slack for SOPs & decisions

Brian reads a tenant's real communication, filters the noise deterministically,
extracts durable knowledge with the LLM, clusters it, and drafts skills/context
into the **existing review queue** with provenance. Nothing goes active unread.

Design: `docs/superpowers/specs/2026-07-06-connectors-design.md`.
Plan: `docs/superpowers/plans/2026-07-06-connectors.md`.

## Pipeline

`npm run sync -- gmail|google_drive|slack|all` (manual; no schedulers in v1), per connector,
in the current tenant:

1. **Fetch** — incremental from the stored cursor (Gmail `historyId`; Slack
   per-channel `ts`, or Drive file metadata), via the adapter (`src/connectors/adapters/`).
2. **Junk filter** — deterministic, zero-LLM (`junkFilter.ts`): drops
   newsletters (`List-Unsubscribe`), `no-reply@` senders, bot-tainted threads,
   sub-quorum / no-company-member threads, and one-liners; dedupes by thread.
   Thresholds are env constants (`CONNECTORS_MIN_HUMANS`, `CONNECTORS_MIN_MESSAGES`).
3. **Extract** — OpenAI Structured Outputs (`extract.ts`): each surviving thread →
   `skill_evidence | context_evidence | junk` + confidence + summary; retry-once
   then degrade-to-junk. Non-junk is embedded and stored in `evidence`.
4. **Aggregate** — greedy cosine clustering (`aggregate.ts`): a skill drafts only
   at **≥K** (`CONNECTORS_CLUSTER_K`, default 3); a single confident
   `context_evidence` drafts context directly. Every draft records provenance
   (`evidence.promoted_to_id`).
5. **Review** — drafts land in the dashboard review queue like interview drafts.

## Dashboard

**Signals → Sources**: connect each source, describe the process you want Brian
to learn, then run a **focused sync** (shows fetched/kept/evidence/drafts).
Stored credentials are never
returned by the API.

Every catalog source offers authorization. Authorization stores a secure,
tenant-owned connection first; source-specific data selection and ingestion are
implemented as the next layer. The OAuth registrations Brian must own are
listed in `docs/oauth-app-registrations.md`.

## Brian team setup (required before customers connect)

- **Google Workspace:** the dashboard starts one OAuth flow with read-only
  Gmail + Drive scopes and stores the resulting refresh token for both sources.
  Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
  `GOOGLE_OAUTH_REDIRECT_URI` in the hosted environment. Google Docs, Sheets,
  and Slides are exported to text before analysis.
- **Slack:** create a Slack app with `channels:history`, `groups:history`,
  `users:read`, and `users:read.email`; configure `SLACK_CLIENT_ID`,
  `SLACK_CLIENT_SECRET`, and `SLACK_OAUTH_REDIRECT_URI`. The dashboard uses
  Slack's OAuth installation flow. The direct bot-token endpoint remains
  available for local development.
- **All other sources:** register Brian as the public/multitenant OAuth app for
  each provider family, add the callback URL, and store its client ID and secret
  in the protected hosted configuration. See `oauth-app-registrations.md`.
- **DB:** apply migration `006_connectors.sql` to the live project (gated, like
  005). Until then connectors run against the `test` schema only.

## API

- `GET /api/connectors` — list (credentials redacted; `configured` boolean).
- `GET /api/connectors/providers` — report readiness for every catalog source;
  it never returns client IDs, client secrets, or customer tokens.
- `GET /api/connectors/google/start` — create a one-time Google OAuth state and
  return the authorization URL.
- `GET /api/connectors/slack/start` — create a one-time Slack OAuth state and
  return the authorization URL.
- `GET /api/connectors/:provider/start` — start any other catalog provider's
  OAuth flow; Zendesk additionally accepts its tenant subdomain as `workspace`.
- `GET /api/connectors/:provider/callback` — validate one-time state, exchange
  the provider code, save the tenant connection, and return to the Brian app.
- `POST /api/connectors/:type/connect` — store credentials, set `connected`.
- `POST /api/connectors/:type/disable` — toggle off.
- `POST /api/connectors/:type/sync` — run one focused sync now; body may include
  `{ "focus": "the process Brian should discover" }`.
- `GET /api/evidence?status=unpromoted` — list extracted skill evidence that
  has not yet been promoted into a draft.

## Storage (migration 006, tenant-scoped + RLS)

- `connectors` — one row per (tenant, source): credentials, cursor, status.
- `oauth_states` — short-lived, hashed Google OAuth state values; consumed once
  and expired after ten minutes.
- Connector credentials are encrypted at rest when `CONNECTOR_ENCRYPTION_KEY`
  is configured. Local development remains compatible with plaintext fixtures;
  hosted deployments should always set the key before connecting a customer.
- `evidence` — extracted signals: `source_ref`, `kind`, `summary`, `embedding`,
  `confidence`, `promoted_to_kind`/`promoted_to_id` (provenance link). Deduped on
  `(tenant, connector, thread_id)`.

## Testing

Adapters isolate network I/O; the pipeline is tested against in-memory
`RawThread[]` (junk filter fixtures, mocked `LlmClient`, mocked embeddings,
synthetic evidence). The live HTTP impls (`realGmailApi`, `realSlackApi`) are
founder-gated and verified with real tokens.
