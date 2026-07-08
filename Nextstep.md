# Brian — Next Steps

> Context-preservation doc. Snapshot of where the Company Brain backend stands and
> what to do next, so we can resume without re-deriving anything.
> Last updated: 2026-07-08.

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
- **Status:** 204/204 tests pass on the live DB (as of 2026-07-08). Multi-tenancy
  Phase 1 + connectors + interview resume are **merged to `main`** (96f71c7).
  Newest work (Supabase-hosted backend) is on branch `supabase-hosted-backend`.

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

- **Supabase-hosted backend (2026-07-08, branch `supabase-hosted-backend`):**
  founder mandate: fully migrate the backend to Supabase; MCP stdio stays local.
  Spec `docs/superpowers/specs/2026-07-08-supabase-hosted-backend-design.md`,
  plan `docs/superpowers/plans/2026-07-08-supabase-hosted-backend.md`.
  (1) HTTP layer ported **Fastify → Hono** (same routes/codes/guard; MCP over
  `@hono/mcp` fetch-native transport; local entry on `@hono/node-server`;
  Fastify removed; tests via `src/test/http.ts` inject shim).
  (2) `npm run edge:build` bundles `src/edge/entry.ts` (our code only, esbuild,
  minified) → `supabase/functions/brian/index.js` + a generated `deno.json`
  import map pinning npm deps; **deployed via the Supabase MCP** with
  `verify_jwt=false` (the app enforces its own bearer/JWT guard).
  **LIVE at `https://foydcrwyakpkisxtvzgr.supabase.co/functions/v1/brian`**
  (`/api/*`, `/mcp`, `/__build` marker). Edge-runtime gotchas (encoded in
  comments): `process.env` READS pass through, WRITES + `Deno.env.toObject()`
  throw NotSupported; pool falls back to platform `SUPABASE_DB_URL`; auth
  fails closed (random token when the `BRIAN_API_TOKEN` secret is unset, so
  only `api_tokens` rows / JWTs authenticate — verified 401).
  (3) Clients repointed: `BRIAN_URL` in `server/.env` (hook needs no local
  API), `vercel.json` rewrites `/api/*` → the edge function for the deployed
  dashboard, docs updated. Live-verified: REST, MCP initialize + tools/list,
  hook SessionStart. `find_skill`/briefing/LLM routes await the
  `OPENAI_API_KEY` **edge secret** (founder step — no MCP tool for secrets).

- **RLS backstop (2026-07-08, branch `rls-backstop`):** SupabaseIntegration
  §7 Phase 2, now REQUIRED (public API). Migration `007_rls_backstop.sql`
  **applied to live prod** (via Supabase MCP): non-owner `brian_app` role
  (nologin until the founder sets a password — see Phase F), DML grants +
  default privileges per schema, RLS enabled everywhere, `tenant_isolation`
  policies on all 10 tenant tables keyed to transaction-scoped
  `app.tenant_id`, `pre_tenant_lookup` SELECT policies on api_tokens/tenants
  (bearer-hash → tenant resolution happens before a tenant exists).
  Code: `db()` in `src/db/tenant.ts` now wraps every one-shot repo query in
  `begin; set_config('app.tenant_id', tenant, true); …; commit` (setting dies
  with the tx — no cross-checkout leakage); updateSkill/updateContext bind it
  after their own `begin`. Tests: `migrate007.test.ts` (4) green;
  `rlsLeak.test.ts` (6, connect AS brian_app: unfiltered selects return only
  the bound tenant, cross-tenant insert rejected) **skip until
  `APP_TEST_DATABASE_URL` exists** — the agent classifier blocks granting a
  prod login credential, deliberately left to the founder.

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

## Next steps — the YC-ready phase plan (2026-07-08)

Goal: **YC-ready** — hosted product, one-command onboarding, real isolation,
demo that works on a clean machine. The backend is now hosted on Supabase
(Phase 1 ✅, see done list); what remains:

### Phase F — Founder checklist (only steps an agent cannot do; ~15 min)
0. ~~Enable the RLS role's login~~ ✅ DONE 2026-07-08 (founder-authorized):
   `brian_app` has login; `APP_TEST_DATABASE_URL` is in `server/.env`; all
   **6 cross-tenant leak tests pass** (unfiltered selects return only the
   bound tenant; cross-tenant insert rejected). Remaining half-step: set the
   edge `DATABASE_URL` secret to the **brian_app** session-pooler URL
   (user `brian_app.foydcrwyakpkisxtvzgr`, password = `brian_app` login
   password) so the HOSTED API also runs with RLS enforced — until then it
   connects as the `postgres` owner via `SUPABASE_DB_URL`, which bypasses
   policies.
1. **Edge Function secrets** (Dashboard → Project → Edge Functions → Secrets,
   or `supabase secrets set` with a PAT): `OPENAI_API_KEY` (unblocks
   find_skill/briefing/capture/interviews on the hosted API — everything else
   already works), `BRIAN_API_TOKEN`, `AUTH_JWT_SECRET` (same values as
   `server/.env`), optionally `DATABASE_URL` (session-pooler URL; otherwise the
   platform `SUPABASE_DB_URL` direct connection is used) and `LLM_MODEL`.
   While in there: **rotate the OpenAI key** (it was shared in chat) and
   delete the retired `brian-diag` function (410 stub).
2. **Connector credentials** (unchanged, see `docs/connectors.md`): Gmail
   `gmail.readonly` re-auth (`npm run gmail:auth`); Slack bot token pasted in
   dashboard Activity → Connectors.

### Phase 2 — RLS as a real backstop ✅ BUILT (2026-07-08; live activation = Phase F step 0)
Migration 007 + tenant-bound queries are live and tested (see done list).
All that remains is the founder credential step above — no code left here.

### Phase 3 — Supabase Auth for dashboard humans ✅ BUILT (2026-07-08, branch `supabase-auth`)
- Guard (4th auth path): Supabase access tokens validated against the auth
  server (`GET /auth/v1/user`; `src/auth/supabase.ts` — no JWKS/secret
  handling, works with any signing scheme), `tenant_id`/`role` read from
  `app_metadata`, issuer pre-filter so agent bearers never trigger a network
  call. `SUPABASE_URL`+`SUPABASE_ANON_KEY` config (auto-present on the edge;
  added to `server/.env` locally).
- Login page tries Supabase password grant first
  (`REACT_APP_SUPABASE_URL/_ANON_KEY` in root `.env`, anon key is public);
  falls back to legacy `/api/auth/login`.
- `npm run seed:supabase-admin` creates/updates the founder auth user with
  founding-tenant `app_metadata` — needs `SUPABASE_SERVICE_ROLE_KEY` +
  `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `server/.env` (founder: dashboard →
  Settings → API → service_role). **Legacy bcrypt path deliberately kept**
  until that user exists; delete `src/auth/users.ts`+`jwt.ts` and the login
  route's bcrypt branch at cutover. Token auto-refresh (supabase-js) and the
  invite flow + "Agents & tokens" page: Phase 4 backlog.

### Phase 4 — YC polish (remaining)
- **Founder: deploy the frontend** — `vercel deploy` at repo root
  (`vercel.json` rewrites `/api/*` → the edge function; set
  `REACT_APP_SUPABASE_URL/_ANON_KEY` in Vercel env, values in root `.env`).
- **YC demo script** (after Phase F secrets): on any machine,
  `cd server && npm run onboard -- --url
  https://foydcrwyakpkisxtvzgr.supabase.co/functions/v1/brian --token <TOKEN>`
  → open Claude/Cursor → ask for a refund task → agent pulls the skill from
  the hosted brain, respects guardrails, logs the execution → show the
  execution + provenance in the dashboard. No laptop server anywhere.
- Connectors live on real data (after Phase F): tune junk-filter thresholds /
  cluster K, **encrypt `connectors.credentials`**.
- Backlog: supabase-js token refresh + invite flow + "Agents & tokens" page;
  metrics for the pitch (executions per tenant; bench 85/91.7 + Phases 2–3).

### Smaller follow-ups (nice-to-have)
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
