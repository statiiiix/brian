# Brian — Next Steps

> Context-preservation doc. Snapshot of where the Company Brain backend stands and
> what to do next, so we can resume without re-deriving anything.
> Last updated: 2026-07-06.

---

## Where we are now (done)

A working **Company Brain backend** lives in `server/` (standalone Node/TS, Fastify,
pg, pgvector). The repo root is a separate Create-React-App UI the founder owns.

- **v1 engine (M0–M5):** skills schema + pgvector, skill repo with version history,
  `find_skill` semantic retrieval, MCP execution server with mock business tools, the
  end-to-end execution loop (retrieve → read guardrails → act or escalate → log),
  REST API, execution logging, staleness detection, `draft-from-text` ingestion.
- **v2 Knowledge Capture:** second knowledge type **context** (goals/decisions/prefs);
  `capture(text)` that classifies each item skill-vs-context and routes it
  (create or update); **graduated autonomy** (context always active; skills auto-active
  only when confident AND all tools are reversible/safe, else draft); tool-risk
  registry; bulk ingestion; MCP `capture` + `find_context` tools.
- **Roadmap-to-done (2026-07-01):** the four next-steps below are BUILT
  (spec: `docs/superpowers/specs/2026-07-01-brian-roadmap-to-done-design.md`):
  1. **MCP wired into Claude** — repo `.mcp.json` (Claude Code) + `mcpServers.brian`
     in the Claude Desktop config; the stdio entry self-loads `server/.env`
     (`src/env.ts`), so it works when launched by any client.
  2. **Draft review surface** — `npm run review -- [list|show|approve|reject]`
     (`src/review/`). Proven live: the "Customer inquiry reply" skill went
     draft → approved → active through it.
  3. **Real business tool: Gmail** — adapter registry (`src/mcp/adapters.ts`),
     Gmail client (`src/gmail/client.ts`, plain fetch + OAuth refresh token),
     tools `create_email_draft` (risk: safe) / `send_email` (risk: destructive),
     one-time `npm run gmail:auth` helper, setup guide `docs/gmail-setup.md`,
     live smoke `src/scripts/gmailSmoke.ts`.
  4. **HTTP transport + auth + agent contract** — MCP Streamable HTTP at
     `POST /mcp` inside the Fastify app (stateless), bearer-token auth
     (`BRIAN_API_TOKEN`) on `/api/*` and `/mcp`, new `log_execution` MCP tool,
     and the system-prompt contract in `docs/agent-contract.md`.
     **Cloud deploy deliberately deferred** — runs locally until a real external
     agent needs it.
- **Brian-bench Phase 1 (2026-07-02):** retrieval benchmark at scale
  (`npm run bench`, spec `docs/superpowers/specs/2026-07-02-brian-bench-design.md`).
  120 skills drafted from real GitLab-handbook pages in an isolated `bench` schema;
  120 labeled queries. **Result: 85.0% top-1 / 91.7% top-3**
  (`docs/bench/2026-07-02-retrieval.md`). The bench exposed a real production bug —
  ivfflat embedding indexes trained on empty tables silently returned empty/partial
  results at 100+ rows (first run scored 12.5%) — fixed by migration `003_hnsw.sql`
  (HNSW), applied to live. New repo fn `findSkillsWithDistance` (top-k).
  Phases 2–3 (500-task inbox marathon w/ adversarial slice; learning curve) are
  specced in the design doc, not built.
- **LLM:** OpenAI only (no Claude). Embeddings `text-embedding-3-small` (1536);
  generative `gpt-5.4-mini` via `LLM_MODEL`, using **Structured Outputs** (strict
  `json_schema`) because it's a reasoning model.
- **Status:** 202/202 tests pass on the live DB (as of 2026-07-06). Newest work
  (multi-tenancy Phase 1 + connectors + interview resume) lives on branch
  `connectors` (cut from `supabase-tenancy`); `main` currently has through the
  onboard installer. Branches are **not yet merged** — see "Next steps".

### Environment / infra facts (don't re-derive)
- Supabase project **brian**, ref `foydcrwyakpkisxtvzgr` (Postgres 17 + pgvector).
  Migrations through **006 are applied to live prod** (via the Supabase MCP):
  001–004 base, 005 tenancy, 006 connectors. **RLS is now enabled on every
  owned table** (context_entries/context_versions got it 2026-07-06, closing the
  last `rls_disabled_in_public` advisor); the backend connects as the `postgres`
  owner, which bypasses RLS, so RLS is currently a latent backstop (see step 4).
  Only remaining advisor is a low-priority `vector`-extension-in-public WARN.
- DB access via the **session pooler** in gitignored `server/.env` (direct connection
  is IPv6-only and fails on the IPv4 network).
- **Tests run in a dedicated `test` schema** (`TEST_DATABASE_URL` has
  `?options=-c search_path=test,public`); they never touch live `public`. Live
  `public` holds 2 seeded skills + the active "Customer inquiry reply" skill.
- Run DB tests: `cd server && set -a && . ./.env && set +a && npm test`.
- `server/.env` vars: `DATABASE_URL`, `TEST_DATABASE_URL`, `OPENAI_API_KEY`,
  `LLM_MODEL=gpt-5.4-mini`, `BRIAN_API_TOKEN` (bearer for REST + /mcp), and —
  once the founder finishes `docs/gmail-setup.md` — `GMAIL_CLIENT_ID`,
  `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`.
- Consider rotating the OpenAI key (it was shared in chat).

- **Interview mode + dashboard (2026-07-03, branch `interview-mode-dashboard`):**
  spec `docs/superpowers/specs/2026-07-03-interview-mode-dashboard-design.md`.
  Backend: migration `004_users_interviews.sql` (users + interviews, RLS),
  bcrypt+JWT auth (`src/auth/`), dual-mode guard (static `BRIAN_API_TOKEN` **or**
  user JWT on `/api/*` + `/mcp`; `POST /api/auth/login`, `GET /api/auth/me`),
  `npm run seed:admin` (env-driven: `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`AUTH_JWT_SECRET`),
  interview engine (`src/interviews/`, one Structured-Outputs call per turn:
  next question OR finished draft + 7-field coverage map, 25-question cap,
  retry-once on malformed output), REST: `POST/GET /api/interviews`,
  `POST /api/interviews/:id/messages|approve|abandon`. 103/103 tests.
  Frontend: react-router v6 (`/` landing, `/login`, `/app/*` JWT-gated), CRA
  proxy → :3001, nav "Log in" button, dashboard (`src/app/`, one CSS per
  component): Skills list/editor + versions, Review queue (web replacement for
  the CLI), Interviews list + chat with live coverage checklist and
  approve-to-active draft panel, Capture box, Executions log.
  **Verified live end to end:** JWT login → real-LLM interview (2 rich answers →
  faithful draft, zero invented policy) → approve → active → `find_skill`
  retrieves it ("Approve customer discount requests").

- **Always-on invocation (2026-07-04, branch `always-on-invocation`):**
  spec `docs/superpowers/specs/2026-07-04-always-on-invocation-design.md`.
  Fixes "agents only call Brian when asked": (1) the MCP server now sends the
  agent contract as MCP `instructions` at initialize
  (`src/mcp/instructions.ts`) + trigger-rich tool descriptions — raises call
  rates in every MCP client; (2) Claude Code hooks make it deterministic:
  `POST /api/agent/briefing` (one-shot skill+context lookup, 0.6 distance
  cutoff), zero-dep hook `server/scripts/hooks/brian-hook.mjs` (SessionStart →
  contract; UserPromptSubmit → briefing injected; fail-silent if the API is
  down), installer `npm run hooks:install [-- --user]`, repo-level
  `.claude/settings.json`. The hook needs the API running (`npm run api`).

- **Brian onboard — one-command multi-agent installer (2026-07-04, branch
  `brian-onboard`):** spec `docs/superpowers/specs/2026-07-04-brian-onboard-design.md`,
  plan `docs/superpowers/plans/2026-07-04-brian-onboard.md`, usage `docs/onboard.md`.
  `cd server && npm run onboard` detects installed agent platforms, prints a plan,
  and wires each: MCP registration + the strongest always-on layer it supports.
  Zero-dep ESM (`server/scripts/onboard/`): `onboard.mjs` entry + `lib.mjs`
  (JSON deep-merge with timestamped `.bak-brian-*` backup + refuse-on-unparseable,
  marker-block editing, TOML section append, `mcpEntry` stdio/http builders) +
  one adapter per platform behind a `{detect,status,plan,apply}` interface.
  Adapters: **Claude Code** (merge `~/.claude.json` + delegate hooks to the
  shipped `installBrianHooks()` — no duplication), **Claude Desktop**
  (`claude_desktop_config.json`/`mcp.json` merge), **Cursor** (`~/.cursor/mcp.json`
  + contract block in `~/.cursor/AGENTS.md`), plus Tier-B **Codex**
  (`~/.codex/config.toml` section + AGENTS.md) and **OpenClaw** (contract file +
  manual MCP note). Flags: `--status`/`--dry-run`/`--yes`/`--only`/`--url --token`.
  Safety invariants: backup-before-touch, refuse (never rewrite) unparseable
  configs, idempotent (zero-diff re-runs), honest per-layer labels, exit 1 on any
  refusal. 39 new tests (lib/adapters/CLI subprocess vs temp-HOME fixtures).
  **Live-verified on this machine:** Claude Code + Claude Desktop + Cursor all
  wired, backups created, second run reports "already wired". Restart each app to
  load the new MCP server; keep `npm run api` up for the Claude Code hook.

- **Multi-tenancy Phase 1 (2026-07-06, branch `supabase-tenancy`):** one brian
  project serves many client companies via shared tables + `tenant_id` + RLS
  (design: `SupabaseIntegration.md`). Migration `005_tenants.sql` (tenants +
  api_tokens + `tenant_id` on every owned table, founding tenant `sameh` =
  `…0001`, per-tenant email uniqueness) **applied to live prod**, non-breaking
  (existing rows backfilled). Tenant context in `src/db/tenant.ts`
  (`runTenant`/`currentTenantId`/`tenantOrFounding`/`db()` over AsyncLocalStorage)
  + token→tenant resolver (`src/auth/apiTokens.ts`, sha256). Every repo scopes by
  `tenant_id`; the Fastify guard resolves the request tenant (static founding
  bearer, per-tenant `api_tokens`, or dashboard JWT→founding) and binds it via
  `als.run(done)`. Cross-tenant isolation proven (`src/api/tenancy.test.ts`). RLS
  policies + non-owner role are Phase 2 (step 4 — optional/deferred).

- **Connectors — mine Gmail/Slack for SOPs (2026-07-06, branch `connectors`):**
  full pipeline `npm run sync -- gmail|slack|all` → fetch → deterministic junk
  filter → LLM extract (Structured Outputs) → aggregate/cluster (K=3) →
  skill/context drafts in the existing review queue, with provenance. Migration
  `006_connectors.sql` (`connectors` + `evidence`, tenant-scoped, RLS, deduped on
  thread_id) **applied to live prod**. Adapters (`src/connectors/adapters/`:
  Gmail `historyId` / Slack `ts` cursors; live HTTP impls founder-gated on
  tokens). REST API + dashboard **Activity → Connectors** page + "Sourced from
  connectors" provenance panel on skill detail. Spec/plan/`docs/connectors.md`.
  **To go live it needs source credentials only** (Gmail `readonly` re-auth;
  Slack app/bot token) — code + tables are deployed.

- **Interview resume-from-abandoned (2026-07-06):** `POST /api/interviews/:id/resume`
  + Resume buttons on the interview detail view and list (dashboard).

---

## How any agent should resume work here (read this first)

1. **Read order:** this file → `CompanyBrain.md` (product truth) → the spec
   for the step you're picking up (paths in each step + Key files below).
   For step 4 specifically, `SupabaseIntegration.md` is mandatory, in full.
2. **Workflow:** brainstorm → design spec (`docs/superpowers/specs/`) → 
   implementation plan (`docs/superpowers/plans/`) → TDD (failing test first),
   frequent commits on a feature branch → full suite green → `--no-ff` merge
   to `main`. Every merged milestone updates this file + the "done" list.
3. **Run tests:** `cd server && set -a && . ./.env && set +a && npm test`
   (the env file is gitignored and holds real credentials; tests hit the real
   Supabase DB but only the dedicated `test` schema — see infra facts above).
4. **Hard conventions (violating these has bitten us before):**
   - LLM provider is **OpenAI only** — no Anthropic/Claude API calls anywhere
     (founder directive). Generative calls use **Structured Outputs** (strict
     `json_schema`) because `gpt-5.4-mini` is a reasoning model that drifts
     otherwise; tests mock the LlmClient, never the DB.
   - Migrations (`server/src/db/migrations/`) re-run every time and must stay
     **convergent**; a later file dropping an index means removing its create
     from the earlier file.
   - Never trust a pgvector index created on an empty table; after index
     changes run `npm run bench`.
   - Frontend: CRA + react-router **v6** (v7 breaks CRA jest); every component
     is a `Component.js` + `Component.css` pair (founder directive).
   - Agent-facing scripts under `server/scripts/` are zero-dependency ESM
     `.mjs`, runnable by bare `node`, fail-silent when Brian is down.
   - Client-machine files (hooks, settings, AGENTS.md blocks) stay
     tenant-neutral — pointers + generic contract only, never company data.

## Next steps (prioritized)

The big feature arc (onboard → multi-tenancy Phase 1 → connectors) is **built,
tested, and its migrations are live on prod**. What remains is integration,
founder credentials, and deliberately-deferred hardening.

### 1. Integrate the feature branches to `main` (do first)
`main` currently has through the onboard installer. Two branches are built,
green (202/202), and unmerged, in dependency order — merge `--no-ff`:
1. `supabase-tenancy` (multi-tenancy Phase 1) → `main`.
2. `connectors` (cut from `supabase-tenancy`; adds connectors + interview resume)
   → `main`.
Migrations 005 + 006 are already applied to prod, so `main` and prod already
agree at the DB level; this just lands the code. (Kept unmerged pending founder
go-ahead because of concurrent landing-page work on the branch.)

### 2. Founder credentials to make connectors pull real data
Connectors code + tables are deployed; they only need source access:
- **Gmail:** add the `gmail.readonly` scope in Google Cloud, re-run
  `cd server && npm run gmail:auth`, paste the refreshed `GMAIL_REFRESH_TOKEN`
  into `server/.env` (the founding tenant reuses `GMAIL_*`).
- **Slack:** create a Slack app + bot token (`channels:history`,
  `groups:history`, `users:read`), invite it to the target channels, paste the
  token into the dashboard **Activity → Connectors** page.
Then `npm run sync -- gmail|slack|all` (or "Sync now") → drafts land in review
with provenance. Usage: `docs/connectors.md`.

### 3. Founder housekeeping (carried over)
- **Rotate the OpenAI API key** (it was shared in chat).
- Optional: `cd server && npm run onboard` on any new machine wires all its
  agents to Brian in one command (`docs/onboard.md`); keep `npm run api` running
  so the Claude Code per-prompt briefing hook fires.

### 4. Supabase Phase 2 — RLS as a real backstop (OPTIONAL; defer until external clients)
Not needed for single-company use — app-level tenant scoping already isolates
tenants (Phase 1, done). Do this when onboarding the first **external** client
company and you want database-level (not just app-level) isolation: create a
non-owner `brian_app` role, connect the app as it (credential in `server/.env`),
pin a per-request client with `SET LOCAL app.tenant_id` inside `db()` (repos
already route through `db()`, so no repo change), add `tenant_isolation` RLS
policies on every tenant table, and add cross-tenant leak tests that connect as
`brian_app`. All owned tables already have RLS *enabled* (no policies yet → the
owner bypasses; anon/authenticated are denied). Phases 3–4 (Supabase Auth for
dashboard humans; hosted cloud deploy) land with that same first design partner.
Design: `SupabaseIntegration.md`.

### 5. Smaller follow-ups (nice-to-have)
- Once real syncs run: tune the junk-filter thresholds / cluster `K` on live
  signal; per-channel Slack selection; **encrypt `connectors.credentials`**
  (currently plaintext in the tenant row — a noted hardening).
- Brian-bench Phases 2–3 (500-task inbox marathon + learning curve) — specced in
  `docs/superpowers/specs/2026-07-02-brian-bench-design.md`, not built.
- Done already: interview resume-from-abandoned; sidebar review-count badge.

### 6. Later / deferred (intentional anti-goals until real use proves them out)
- Cloud hosting of the HTTP surface (Fly/Railway) — transport-ready; deploy when
  a remote agent needs it (with Supabase Phase 4).
- Connector schedulers/daemons — v1 syncs are manual `npm run sync`; automate
  only after the pipeline proves signal-to-noise on real data.
- Graph DB / graph UI — not happening for v1; a skill table beats it.
- Move pgvector out of `public` schema (minor security-linter WARN) — low priority.

---

## How to equip a company's AI agent (reference)
The MCP server **is** the integration surface. A company's agent: (a) connects to
Brian's MCP server (stdio locally, or `POST /mcp` + bearer token), (b) gets the
system-prompt contract in `docs/agent-contract.md`, (c) has the company's real
business tools wired behind the MCP tool names via `src/mcp/adapters.ts`,
(d) logs every run via `log_execution`. The brain supplies judgment + rules; the
agent executes; `capture` keeps it current.

## Key files
- Specs: `docs/superpowers/specs/2026-06-29-company-brain-design.md`,
  `docs/superpowers/specs/2026-06-29-knowledge-capture-design.md`,
  `docs/superpowers/specs/2026-07-01-brian-roadmap-to-done-design.md`
- Plans: `docs/superpowers/plans/2026-06-29-company-brain-v1.md`,
  `docs/superpowers/plans/2026-06-29-knowledge-capture-v2.md`,
  `docs/superpowers/plans/2026-07-01-roadmap-to-done.md`
- Product source of truth: `CompanyBrain.md` · Supabase/multi-tenant design:
  `SupabaseIntegration.md` (mandatory reading before building tenancy)
- Newer specs: `docs/superpowers/specs/2026-07-04-always-on-invocation-design.md`,
  `docs/superpowers/specs/2026-07-04-brian-onboard-design.md`,
  `docs/superpowers/specs/2026-07-06-connectors-design.md`
- Docs: `docs/agent-contract.md`, `docs/gmail-setup.md`, `docs/onboard.md`,
  `docs/connectors.md` · Multi-tenant design: `SupabaseIntegration.md`
- Backend entry points: `server/src/api/index.ts` (REST + `/mcp` HTTP),
  `server/src/mcp/index.ts` (MCP stdio), `server/src/review/cli.ts` (review CLI),
  `server/src/ingestion/capture.ts` (capture pipeline), `server/src/llm/` (OpenAI),
  `server/src/db/tenant.ts` (tenant context), `server/src/connectors/` (Gmail/Slack
  pipeline; `npm run sync`), `server/scripts/onboard/` (`npm run onboard`).
