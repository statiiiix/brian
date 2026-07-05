# Connectors (Gmail + Slack capture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) — implement
> task-by-task, TDD, commit per task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `npm run sync -- gmail|slack|all` pulls a tenant's new email/Slack threads, filters
the noise deterministically, extracts skill/context evidence with the LLM, clusters it, and
drafts skills/context into the existing review queue with provenance.

**Architecture:** Per-tenant `connectors` + `evidence` tables. A `Connector` adapter per source
(pure fetch, network isolated) behind a registry. A pipeline (`fetch → junkFilter → extract →
aggregate`) orchestrated by a sync runner exposed as a CLI and a REST endpoint. Everything runs
inside the shipped tenant context (`runTenant`/`db()`), reusing `draftFromText`/`capture` and the
existing review queue.

**Tech Stack:** Node/TS, pg + pgvector, OpenAI Structured Outputs (`gpt-5.4-mini`, strict
`json_schema`, retry-once), vitest (mock `LlmClient` and adapter `fetch`; never mock the DB).

## Global Constraints

- Depends on branch `supabase-tenancy` (tenant context + migration 005). This branch is cut from it.
- Every new table is tenant-scoped, `tenant_id` defaults to founding, RLS enabled (like 005);
  migrations stay convergent/re-runnable.
- Repos go through `db()` and scope by `tenantOrFounding()` (same pattern as the shipped repos).
- LLM calls use OpenAI only, Structured Outputs, retry-once (house style: `src/llm/`, interview engine).
- Adapters isolate all network I/O; the pipeline is tested against in-memory `RawThread[]`.
- Manual sync only (no schedulers). Store extracted knowledge + minimal provenance, not mailbox mirrors.
- Junk-filter thresholds are env constants with defaults; K defaults to 3 (`CONNECTORS_CLUSTER_K`).

## File Structure

- `server/src/db/migrations/006_connectors.sql` — connectors + evidence tables.
- `server/src/connectors/types.ts` — `RawThread`, `Connector`, `Evidence`, `Connector` row types.
- `server/src/connectors/repo.ts` — connectors + evidence CRUD (tenant-scoped, via `db()`).
- `server/src/connectors/junkFilter.ts` — pure deterministic filter.
- `server/src/connectors/extract.ts` — LLM extraction (Structured Outputs) → evidence rows.
- `server/src/connectors/aggregate.ts` — cluster evidence, draft at ≥K, record provenance.
- `server/src/connectors/sync.ts` — orchestrator (fetch→filter→extract→aggregate) + summary.
- `server/src/connectors/adapters/gmail.ts` — Gmail `Connector` (historyId cursor).
- `server/src/connectors/adapters/slack.ts` — Slack `Connector` (per-channel ts cursor).
- `server/src/connectors/adapters/index.ts` — registry `{ gmail, slack }`.
- `server/src/scripts/syncCli.ts` — `npm run sync` entry.
- `server/src/api/app.ts` — add `/api/connectors*` routes.
- Tests alongside each under `server/src/connectors/*.test.ts` + `src/api/connectorsApi.test.ts`.
- `server/package.json` — `"sync": "tsx src/scripts/syncCli.ts"`.

### Shared interfaces (locked here)

`types.ts`:
```ts
export interface RawThread {
  thread_id: string; permalink: string;
  participants: { id: string; is_company_member: boolean; is_bot: boolean }[];
  messages: { from: string; ts: string; text: string; headers?: Record<string,string> }[];
}
export interface Connector { type: "gmail" | "slack";
  fetch(creds: unknown, cursor: unknown): Promise<{ items: RawThread[]; nextCursor: unknown }>; }
export type EvidenceKind = "skill_evidence" | "context_evidence";
export interface ExtractResult { kind: EvidenceKind | "junk"; confidence: number; summary: string; }
```
`junkFilter.ts`: `export function keepThread(t: RawThread, opts?): boolean` and
`export function filterThreads(items: RawThread[]): RawThread[]` (dedupes by thread_id).
`extract.ts`: `export async function extractThread(t: RawThread, llm?: LlmClient): Promise<ExtractResult>`.
`repo.ts`: `getConnector(type)`, `upsertConnector(type, patch)`, `setCursor(type, cursor)`,
`insertEvidence(row)` (dedupe on `(connector_id, source_ref)`), `unpromotedEvidence(kind)`,
`markPromoted(ids, kind, id)`.
`aggregate.ts`: `export async function aggregate(): Promise<{ drafts: number }>`.
`sync.ts`: `export async function syncConnector(type, { llm?, fetchImpl? }): Promise<SyncSummary>`
where `SyncSummary = { fetched:number; kept:number; evidence:number; drafts:number }`.

---

### Task 1: Migration 006 (connectors + evidence)

**Files:** Create `006_connectors.sql`; Test `src/db/migrate006.test.ts`.

- [ ] **Step 1: failing test** — assert tables exist, tenant_id defaults to founding, RLS enabled,
  `(tenant_id,type)` unique on connectors, evidence dedupe unique, convergent re-run. Pattern:
  copy `migrate005.test.ts` (guarded on `TEST_DATABASE_URL`, `runMigrations`, founding id const).
- [ ] **Step 2: run → fail** (`... npm test -- src/db/migrate006.test.ts`).
- [ ] **Step 3: write `006_connectors.sql`** exactly as in the spec's Data model, plus
  `alter table connectors enable row level security;` and same for `evidence`, and
  `create index if not exists evidence_tenant_idx on evidence (tenant_id);`.
- [ ] **Step 4: run → pass.**
- [ ] **Step 5: commit** `feat(db): migration 006 — connectors + evidence tables`.
- [ ] **Step 6:** apply to live prod via Supabase MCP **only after user approval** (gated, like 005).

### Task 2: Connector repo (tenant-scoped CRUD)

**Files:** Create `connectors/types.ts`, `connectors/repo.ts`; Test `connectors/repo.test.ts`.

- [ ] Write failing tests: `upsertConnector('gmail', {status:'connected', credentials:{...}})` then
  `getConnector('gmail')` round-trips; `setCursor` persists; `insertEvidence` dedupes on repeat
  `source_ref`; `unpromotedEvidence('skill_evidence')` excludes promoted; tenant isolation
  (a second tenant sees none). Use `runTenant(FOUNDING…)` and a temp second tenant like
  `tenancy.test.ts`.
- [ ] Run → fail → implement repo (all queries via `db()`, filter/insert `tenant_id =
  tenantOrFounding()`; JSON columns `JSON.stringify`) → run → pass → commit
  `feat(connectors): tenant-scoped connectors + evidence repo`.

### Task 3: Deterministic junk filter (pure functions)

**Files:** Create `connectors/junkFilter.ts`; Test `connectors/junkFilter.test.ts`.

- [ ] **Step 1: failing tests** (rich fixtures):
```ts
import { keepThread, filterThreads } from "./junkFilter.js";
const human = (id: string) => ({ id, is_company_member: id.endsWith("@us.com"), is_bot: false });
const thread = (over: Partial<RawThread>): RawThread => ({
  thread_id: "t1", permalink: "p",
  participants: [human("a@us.com"), human("b@x.com")],
  messages: [{ from: "a@us.com", ts: "1", text: "hi can you..." }, { from: "b@x.com", ts: "2", text: "yes here's how" }],
  ...over,
});
it("drops newsletters (List-Unsubscribe)", () => {
  expect(keepThread(thread({ messages: [{ from: "x@n.com", ts: "1", text: "sale", headers: { "list-unsubscribe": "<u>" } }] }))).toBe(false);
});
it("drops noreply senders and bots and reaction/one-liner-only threads", () => {
  expect(keepThread(thread({ messages: [{ from: "noreply@x.com", ts: "1", text: "receipt" }] }))).toBe(false);
  expect(keepThread(thread({ participants: [human("a@us.com"), { id: "bot", is_company_member: false, is_bot: true }] }))).toBe(false);
  expect(keepThread(thread({ messages: [{ from: "a@us.com", ts: "1", text: "ok" }] }))).toBe(false); // one-liner, no reply
});
it("keeps a 2-human thread with a company member and a real exchange", () => {
  expect(keepThread(thread({}))).toBe(true);
});
it("filterThreads dedupes by thread_id", () => {
  expect(filterThreads([thread({}), thread({})])).toHaveLength(1);
});
```
- [ ] Run → fail → implement (env constants `CONNECTORS_MIN_HUMANS=2`, min message length/count;
  checks: any message has `list-unsubscribe` header or `no-?reply@` sender → drop; any bot
  participant → drop; humans (non-bot) < MIN_HUMANS → drop; no company member → drop; <2 messages
  or all one-liners → drop) → run → pass → commit `feat(connectors): deterministic junk filter`.

### Task 4: LLM extract (Structured Outputs → evidence)

**Files:** Create `connectors/extract.ts`; Test `connectors/extract.test.ts`.

- [ ] Failing tests with a mock `LlmClient` (like the interview engine tests): returns strict JSON
  `{kind,confidence,summary}`; assert routing for each kind; malformed output retries once then
  yields `{kind:'junk'}`; a `junk` result is not persisted. (Embedding mocked via
  `vi.mock("../db/embed.js")`.)
- [ ] Run → fail → implement `extractThread` (build the thread text, one Structured-Outputs call,
  strict `json_schema` for `{kind: enum, confidence: number, summary: string}`, retry-once) → pass →
  commit `feat(connectors): LLM thread extraction (Structured Outputs)`.

### Task 5: Aggregate / cluster → drafts + provenance

**Files:** Create `connectors/aggregate.ts`; Test `connectors/aggregate.test.ts`.

- [ ] Failing tests (synthetic evidence rows inserted directly, embeddings mocked so similar items
  share a vector): with K=3, three near-duplicate `skill_evidence` rows → exactly one skill draft
  created (status `needs_review`/`draft`) and those evidence rows `promoted_to_*` set; two rows →
  no draft; a single high-confidence `context_evidence` → one context draft directly.
- [ ] Run → fail → implement greedy clustering: pull `unpromotedEvidence('skill_evidence')`, for
  each ungrouped row gather others within cosine distance `CONNECTORS_CLUSTER_TAU` (default 0.15);
  when a group reaches K, `draftFromText`/`capture` a skill from the merged summaries, `markPromoted`
  the group. Context evidence with confidence ≥ `CONNECTORS_CONTEXT_MIN` drafts directly → pass →
  commit `feat(connectors): cluster evidence and draft at K with provenance`.

### Task 6: Gmail adapter

**Files:** Create `connectors/adapters/gmail.ts`; extend `src/gmail/client.ts` (add readonly scope
constant); Test `connectors/adapters/gmail.test.ts`.

- [ ] Failing test: given a stubbed gmail client (list history + get thread) injected, `fetch(creds,
  {historyId})` maps Gmail threads → `RawThread[]` (participants from headers, `is_company_member`
  by company domain, `is_bot`/noreply heuristics) and returns `nextCursor.historyId`. No live API.
- [ ] Run → fail → implement (History API incremental; bootstrap window when cursor empty) → pass →
  commit `feat(connectors): gmail adapter (historyId cursor)`.

### Task 7: Slack adapter

**Files:** Create `connectors/adapters/slack.ts`, `connectors/adapters/index.ts` (registry);
Test `connectors/adapters/slack.test.ts`.

- [ ] Failing test: stubbed Slack client (`conversations.list`/`history`/`replies`, `users.info`),
  `fetch(creds, {channelTs})` → `RawThread[]` with per-channel `nextCursor.channelTs` advanced;
  bot/join/leave/reaction subtypes flagged so the junk filter drops them. Registry exports `{gmail,
  slack}`.
- [ ] Run → fail → implement → pass → commit `feat(connectors): slack adapter + registry`.

### Task 8: Sync orchestrator + CLI

**Files:** Create `connectors/sync.ts`, `src/scripts/syncCli.ts`; modify `package.json`;
Test `connectors/sync.test.ts`.

- [ ] Failing integration test: `syncConnector('gmail', { llm: mock, fetchImpl: fixture })` runs
  fetch→filter→extract→aggregate end-to-end against the DB (tenant-scoped), returns
  `{fetched,kept,evidence,drafts}`, advances the cursor, and a second run with the same fixture
  adds zero new evidence (dedupe) — proving idempotency.
- [ ] Run → fail → implement `syncConnector` (loads connector row for creds/cursor, calls the
  adapter or injected `fetchImpl`, pipes through the stages, persists cursor + `last_synced_at`);
  `syncCli.ts` parses `gmail|slack|all`, wraps in `runTenant(FOUNDING…)`, prints the summary → pass →
  commit `feat(connectors): sync orchestrator + npm run sync`.

### Task 9: Connector REST API

**Files:** modify `src/api/app.ts`; Test `src/api/connectorsApi.test.ts`.

- [ ] Failing tests (like `tenancy.test.ts`): `GET /api/connectors` lists; `POST
  /api/connectors/gmail/connect` stores creds + status connected; `/disable` toggles; `/sync`
  returns a summary (with an injected mock so no live API); cross-tenant isolation (Acme token sees
  only its own connectors).
- [ ] Run → fail → implement routes (thin over the repo + `syncConnector`) → pass → commit
  `feat(api): connectors endpoints (list/connect/disable/sync)`.

### Task 10: Docs, Nextstep, full suite, merge

- [ ] `docs/connectors.md` (usage: founder setup for gmail.readonly + Slack bot, `npm run sync`,
  what lands in review).
- [ ] Full suite green (`cd server && set -a && . ./.env && set +a && npm test`).
- [ ] Update `Nextstep.md`: move Step 3 (connectors) to done with the backend summary; note the
  deferred dashboard pages + founder setup + live 006 apply status.
- [ ] Merge `connectors` → `main` `--no-ff` **after** the `supabase-tenancy` (Phase 1) branch is
  integrated, so tenancy lands first. (Coordinate with the user on branch order.)

## Self-Review (spec coverage)

- connectors + evidence tables → Task 1. ✔  Repo (tenant-scoped, dedupe, provenance) → Task 2. ✔
- 5 stages: fetch (Tasks 6–7 adapters + Task 8), junk filter (Task 3), extract (Task 4),
  aggregate (Task 5), review (reuses existing queue — no new surface). ✔
- Both Gmail + Slack behind the adapter interface/registry → Tasks 6–7. ✔
- Per-tenant storage + isolation → Tasks 1–2, 9. ✔  Manual `npm run sync` → Task 8. ✔
- Backend API for the dashboard → Task 9; React pages deferred (spec). ✔
- Founder-gated setup + live migration apply flagged (Tasks 1, 10). ✔
- Tests mock LlmClient + adapter fetch, never the DB (Global Constraints; Tasks 4–5, 8). ✔
