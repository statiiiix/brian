# Connectors — mine Gmail + Slack for SOPs & decisions

Brian reads a tenant's real communication, filters the noise deterministically,
extracts durable knowledge with the LLM, clusters it, and drafts skills/context
into the **existing review queue** with provenance. Nothing goes active unread.

Design: `docs/superpowers/specs/2026-07-06-connectors-design.md`.
Plan: `docs/superpowers/plans/2026-07-06-connectors.md`.

## Pipeline

`npm run sync -- gmail|slack|all` (manual; no schedulers in v1), per connector,
in the current tenant:

1. **Fetch** — incremental from the stored cursor (Gmail `historyId`; Slack
   per-channel `ts`), via the adapter (`src/connectors/adapters/`).
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

**Activity → Connectors**: connect each source, **Sync now** (shows
fetched/kept/evidence/drafts), and disable. Stored credentials are never
returned by the API.

## Founder setup (required before a real sync)

- **Gmail:** add the `gmail.readonly` scope and re-run `npm run gmail:auth`; the
  founding tenant's `GMAIL_*` env is reused automatically.
- **Slack:** create a Slack app, add a bot token with `channels:history`,
  `groups:history`, `users:read`; invite the bot to the target channels; paste
  the token in the Connectors page (or `POST /api/connectors/slack/connect`).
- **DB:** apply migration `006_connectors.sql` to the live project (gated, like
  005). Until then connectors run against the `test` schema only.

## API

- `GET /api/connectors` — list (credentials redacted; `configured` boolean).
- `POST /api/connectors/:type/connect` — store credentials, set `connected`.
- `POST /api/connectors/:type/disable` — toggle off.
- `POST /api/connectors/:type/sync` — run one sync now; returns the summary.

## Storage (migration 006, tenant-scoped + RLS)

- `connectors` — one row per (tenant, source): credentials, cursor, status.
- `evidence` — extracted signals: `source_ref`, `kind`, `summary`, `embedding`,
  `confidence`, `promoted_to_kind`/`promoted_to_id` (provenance link). Deduped on
  `(tenant, connector, thread_id)`.

## Testing

Adapters isolate network I/O; the pipeline is tested against in-memory
`RawThread[]` (junk filter fixtures, mocked `LlmClient`, mocked embeddings,
synthetic evidence). The live HTTP impls (`realGmailApi`, `realSlackApi`) are
founder-gated and verified with real tokens.
