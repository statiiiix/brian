# Connectors — mine Gmail + Slack for SOPs & decisions — Design

**Date:** 2026-07-06
**Status:** approved (brainstorm); implementation plan next.
**Depends on:** Supabase multi-tenancy Phase 1 (migration 005 + `src/db/tenant.ts`
tenant context), which is shipped on branch `supabase-tenancy`. This branch
(`connectors`) is cut from it.

## Problem

Brian today only learns from interviews and manual `capture`. The richest source
of a company's real processes and decisions is the communication it already
produces. Connectors let Brian read a tenant's Gmail + Slack, find the recurring
processes and durable decisions hiding in them, filter the overwhelming noise,
and turn the good stuff into skill/context **drafts** that land in the existing
review queue with provenance. Nothing goes active unread.

## Decisions (locked in the brainstorm)

1. **Both Gmail and Slack from day one**, behind a shared connector abstraction
   (new sources are additive — one module + a registry entry, mirroring the
   `onboard` adapter pattern already shipped in `server/scripts/onboard/`).
2. **Per-tenant DB rows** for connector credentials and sync cursors (a new
   `connectors` table), not env vars — this matches the just-shipped tenancy
   model and powers the dashboard Connectors page + hosted multi-tenant.
3. **Manual sync only in v1** (`npm run sync -- gmail|slack|all`). No
   schedulers/daemons until the pipeline proves its signal-to-noise on real data.
4. **Reuse the existing review queue** (`needs_review`/`draft` on the skills and
   context tables). No new approval surface.
5. **Store extracted knowledge + minimal provenance snippets, NOT mirror copies**
   of mailboxes/channels (privacy).

## Data model — migration `006_connectors.sql`

Tenant-scoped and RLS-enabled from the start (same pattern as 005; owner backend
bypasses RLS, policies land with Phase 2). Convergent/re-runnable.

```sql
create table if not exists connectors (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) default '00000000-0000-0000-0000-000000000001',
  type          text not null,                 -- 'gmail' | 'slack'
  status        text not null default 'disabled', -- disabled | connected | error
  credentials   jsonb not null default '{}',   -- refresh_token / bot_token (secret)
  cursor        jsonb not null default '{}',    -- gmail: {historyId}; slack: {channelTs:{C123: '169..'}}
  last_synced_at timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, type)                      -- one connector per source per tenant
);

create table if not exists evidence (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) default '00000000-0000-0000-0000-000000000001',
  connector_id  uuid not null references connectors(id),
  source_ref    jsonb not null,                -- {thread_id, message_ids[], permalink}
  kind          text not null,                 -- 'skill_evidence' | 'context_evidence'
  summary       text not null,                 -- normalized, model-written
  raw_snippet   text,                          -- minimal excerpt for the reviewer
  confidence    real not null default 0,
  embedding     vector(1536),
  promoted_to_kind text,                       -- 'skill' | 'context' once drafted
  promoted_to_id   uuid,                        -- the draft's id
  created_at    timestamptz not null default now(),
  unique (tenant_id, connector_id, source_ref) -- dedupe re-syncs of the same thread
);
```

Provenance is `evidence` rows + the draft's back-reference (`promoted_to_id`).
The drafted skill/context stores the source snippets/permalinks in its existing
`source` field / examples so the reviewer sees them without leaving the page.

## Connector adapter interface

One module per source in `server/src/connectors/adapters/`, registered in an
array (additive). Pure fetch — no pipeline logic:

```ts
export interface RawThread {
  thread_id: string;
  permalink: string;
  participants: { email_or_id: string; is_company_member: boolean; is_bot: boolean }[];
  messages: { from: string; ts: string; text: string; headers?: Record<string,string> }[];
}

export interface Connector {
  type: "gmail" | "slack";
  // Incremental fetch from the stored cursor; returns new threads + the cursor to persist.
  fetch(creds: unknown, cursor: unknown): Promise<{ items: RawThread[]; nextCursor: unknown }>;
}
```

- **Gmail** reuses `src/gmail/client.ts` (plain fetch + OAuth refresh) — add the
  `gmail.readonly` scope next to the existing send scope. Cursor = `historyId`
  (Gmail History API for incremental); first sync bootstraps from a recent window.
- **Slack** uses a bot token (`conversations.history`/`replies`) over only the
  channels the bot is invited to. Cursor = per-channel latest `ts`.

Network I/O is isolated in the adapters so the pipeline is tested against
in-memory `RawThread[]` fixtures (no live API in unit tests).

## Pipeline (5 stages)

`npm run sync -- gmail|slack|all` runs, per selected connector, for the current
tenant (founding in v1 via env; per-token in hosted):

1. **Fetch** — adapter pulls new threads from the stored cursor; persist
   `nextCursor` + `last_synced_at` on the connector row.
2. **Junk filter — deterministic, zero LLM (this is where ~90% dies):** drop
   newsletters/notifications (`List-Unsubscribe` header, `noreply@`/`no-reply`
   senders), automated/bot messages, join/leave/reaction-only Slack events, and
   one-liners with no reply; keep only threads with **≥2 human participants incl.
   a company member**; dedupe by thread. Thresholds are tunable env constants
   (`CONNECTORS_MIN_HUMANS`, etc.). Pure functions → heavy fixture tests.
3. **Extract — LLM:** each surviving thread → OpenAI Structured Outputs
   (`gpt-5.4-mini`, strict `json_schema`, retry-once — the house style in
   `src/llm/` and the interview engine). Output: `{ kind: 'skill_evidence' |
   'context_evidence' | 'junk', confidence, summary }`. Junk is dropped; the rest
   is written to `evidence` with an embedding. Tests mock `LlmClient`.
4. **Aggregate — one email is not an SOP:** cluster `evidence` by embedding
   similarity within a tenant; when **≥K independent pieces (default K=3, env
   `CONNECTORS_CLUSTER_K`)** describe the same process, draft a skill via the
   existing `draftFromText`/`capture` machinery, tagging the cluster's evidence
   rows with `promoted_to_*`. A single strong `context_evidence`
   (confidence ≥ threshold) drafts a context entry directly (context is
   low-risk; v2 graduated-autonomy rules still apply). Drafts carry provenance.
5. **Review:** drafts land in the existing review queue (`needs_review`/`draft`),
   approved/rejected in the dashboard exactly like interview drafts.

## Backend API (for the dashboard, built now)

Tenant-scoped REST under the existing guard:
- `GET /api/connectors` — list (type, status, last_synced_at, last_error).
- `POST /api/connectors/:type/connect` — store credentials, set `connected`.
- `POST /api/connectors/:type/disable` — toggle off.
- `POST /api/connectors/:type/sync` — run one sync now (thin wrapper over the CLI
  pipeline); returns counts (fetched / kept / evidence / drafts).
- Review-queue drafts expose their provenance (evidence rows) via the existing
  skill/context detail endpoints.

## Deferred to avoid colliding with the active landing redesign

The **Connectors dashboard page** (connect/authorize, sync status, enable toggle,
"sync now") and the **provenance panel** on review-queue drafts are frontend
(`src/app/`, one-`.js`-one-`.css`-per-component, unique classes). Backend + API
ship first; the React pages are a follow-up once the frontend redesign settles.

## Founder-gated setup (like Gmail OAuth today)

- Add the `gmail.readonly` scope and re-run `npm run gmail:auth`.
- Create a Slack app, add a bot token with `channels:history`,
  `groups:history`, `users:read`; invite the bot to the target channels; store
  the token via `POST /api/connectors/slack/connect`.

## Testing

- **Junk filter:** pure-function unit tests with realistic fixtures
  (newsletter / noreply / bot / reactions-only / one-liner / good 2-human thread /
  dedupe).
- **Extract:** mock `LlmClient`; assert routing (skill/context/junk), retry-once
  on malformed output, evidence rows written with embeddings (embed mocked).
- **Aggregate:** synthetic evidence; assert a draft is created only at ≥K, single
  strong context drafts directly, and provenance is recorded.
- **Sync orchestration:** integration test against an in-memory connector `fetch`
  fixture end-to-end (fetch → filter → extract(mock) → aggregate → draft) with a
  DB, all tenant-scoped; cursor advances and re-sync is idempotent (dedupe).
- **Connector repo/API:** CRUD + tenant isolation (mirrors `tenancy.test.ts`).

## Out of scope (v1)

- Schedulers/daemons (manual `npm run sync` only until signal proven).
- Secret encryption/KMS for `connectors.credentials` (stored in the tenant row;
  a noted hardening follow-up, tracked with the Phase 2 RLS work).
- Connectors beyond Gmail/Slack (additive via the adapter registry).
- The dashboard React pages (deferred above).
