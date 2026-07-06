# Brian — Next Steps

> Context-preservation doc. Snapshot of where the Company Brain backend stands and
> what to do next, so we can resume without re-deriving anything.
> Last updated: 2026-07-04.

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
- **Status:** 201/201 tests pass on the live DB (as of 2026-07-06).

### Environment / infra facts (don't re-derive)
- Supabase project **brian**, ref `foydcrwyakpkisxtvzgr` (Postgres 17 + pgvector).
  RLS enabled on all tables; backend connects as the `postgres` owner (bypasses RLS).
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

### 1. Founder manual steps (unblock Gmail + verify clients)
- Follow `docs/gmail-setup.md` (GCP OAuth client → `npm run gmail:auth` →
  paste `GMAIL_REFRESH_TOKEN` into `server/.env`), then run
  `npx tsx src/scripts/gmailSmoke.ts` and check the Drafts folder.
- Restart Claude Desktop / start a Claude Code session in this repo and
  smoke-test: `find_skill("refund")`, `capture(...)`, `find_context(...)`,
  and the full e2e ("a customer asked X — handle it" → draft in Gmail).
- Rotate the OpenAI API key.
- Run `cd server && npm run hooks:install -- --user` to make every Claude Code
  project on this machine consult Brian (the agent was permission-blocked from
  editing its own `~/.claude/settings.json`), and keep `npm run api` running
  so the per-prompt briefing layer actually fires.

### 2. Brian onboard — one-command multi-agent MCP install ✅ DONE (2026-07-04)
Built, tested (39 new tests), and **live-verified** on this machine — see the
**Brian onboard** entry in the "done" list above for the full summary. Entry
point: `cd server && npm run onboard` (`--status` / `--dry-run` / `--yes` /
`--only a,b` / `--url --token`); usage in `docs/onboard.md`, plan in
`docs/superpowers/plans/2026-07-04-brian-onboard.md`. Adding the next platform
(Gemini CLI, Windsurf, …) = one new adapter file in
`server/scripts/onboard/adapters/` registered in `onboard.mjs`'s REGISTRY array.
Deferred edges (fine as-is): Codex/OpenClaw are Tier-B (fixture-tested, not
installed here — reconfirm their file formats against current docs before a
customer relies on them); remote `--url` emits HTTP MCP entries but the Claude
Code briefing hook still reads `BRIAN_URL` from `server/.env` (local-first).

### 3. Connectors — mine Gmail/Slack for SOPs & decisions ✅ DONE — backend + dashboard (2026-07-06, branch `connectors`)
Full pipeline built: `npm run sync -- gmail|slack|all` → fetch → deterministic
junk filter → LLM extract (Structured Outputs) → aggregate/cluster (K=3) →
skill/context drafts in the EXISTING review queue, with provenance. Migration
`006_connectors.sql` (tenant-scoped `connectors` + `evidence`, RLS, deduped on
thread_id). Adapter registry (`src/connectors/adapters/`: Gmail `historyId` /
Slack per-channel `ts` cursors; pure RawThread mappings unit-tested; live
`realGmailApi`/`realSlackApi` HTTP impls founder-gated on tokens). REST API
(`/api/connectors` list/connect/disable/sync — credentials redacted) + dashboard
**Activity → Connectors** page (connect / Sync now / disable). 30 new tests;
full suite **201/201**. Spec `docs/superpowers/specs/2026-07-06-connectors-design.md`,
plan `docs/superpowers/plans/2026-07-06-connectors.md`, usage `docs/connectors.md`.
**Founder-gated to go live:** apply `006` to prod (via Supabase MCP, like 005);
add the `gmail.readonly` scope + re-run `npm run gmail:auth`; create a Slack app
+ bot token and invite it to channels. The 5-stage detail below is the original
agreed direction — now implemented.

Pipeline direction (5 stages):
1. **Fetch** — per-connector incremental sync with stored cursors (Gmail:
   `historyId`; Slack: channel + `ts`), new `connector_state` table. Gmail
   creds are half-wired already: `src/gmail/client.ts` + `npm run gmail:auth`
   (needs the `gmail.readonly` scope added next to the send scope). Slack is
   new: bot token, only channels the bot is invited to. Start with manual
   `npm run sync -- gmail|slack` — NO schedulers/daemons in v1.
2. **Junk filter, deterministic first (zero LLM cost — this is where 90%
   dies):** drop newsletters/notifications (`List-Unsubscribe`, `noreply@`
   senders), automated/bot messages, joins/leaves/reactions-only, one-liners
   with no reply; keep only threads with ≥2 human participants and a company
   member involved; dedupe by thread. Thresholds as tunable env constants.
3. **Extract (LLM):** surviving threads → the existing OpenAI Structured
   Outputs pattern (`gpt-5.4-mini`, strict `json_schema`, retry-once — see
   `src/llm/` and the interview engine for the house style). Each thread
   classifies to `skill_evidence` | `context_evidence` | `junk` + confidence +
   a normalized summary. Tests mock the LlmClient as everywhere else.
4. **Aggregate — one email is not an SOP:** store evidence rows with
   embeddings; cluster by similarity; only when ≥K independent pieces of
   evidence describe the same process does Brian draft a skill (via the
   existing `draftFromText`/`capture` machinery). Every draft keeps
   **provenance**: source snippets + message ids/permalinks, stored with the
   draft. Single strong `context_evidence` items can draft directly (context
   is low-risk; graduated-autonomy rules from v2 still apply).
5. **Review — nothing goes active unread:** drafts land in the EXISTING
   review queue (`needs_review`/`draft` statuses) and are approved/rejected in
   the dashboard exactly like interview drafts. No new approval surface.

Dashboard integration (`src/app/`, follow the one-`.js`-one-`.css`-per-
component convention): a **Connectors** page (connect/authorize per connector,
sync status + last-cursor timestamp, per-connector enable toggle, "sync now"
button) and a **provenance panel** on review-queue drafts (show the source
excerpts + evidence count that produced the draft, so the reviewer can judge
it without leaving the page).

Privacy constraint: store extracted knowledge + minimal provenance snippets,
NOT mirror copies of mailboxes/channels. Multi-tenant note: after
`005_tenants.sql` lands (step 4 below), connector credentials and cursors are
per-tenant rows, not env vars.

### 4. Supabase integration — multi-tenant auth + per-client skills (Phase 1 DONE; Phase 2 remaining)
**Read `SupabaseIntegration.md` carefully (start to finish) before touching
this** — it holds the decided answers: shared tables + `tenant_id` + RLS (NOT
per-client vector tables/schemas), Supabase Auth for dashboard humans,
hashed per-tenant `api_tokens` for agents, `SET LOCAL app.tenant_id` +
double enforcement (SQL + RLS), and the four rollout phases.

**Phase 1 shipped (2026-07-04, branch `supabase-tenancy`):** migration
`005_tenants.sql` (tenants + api_tokens + `tenant_id` on every owned table,
founding tenant `sameh` = `00000000-0000-0000-0000-000000000001`, per-tenant
email uniqueness, RLS enabled on the new tables) — **applied to live prod** via
the Supabase MCP; non-breaking (backfilled the 5 skills/1 user/2 interviews/1
execution). Tenant-context infra (`src/db/tenant.ts`: `runTenant` /
`currentTenantId` / `tenantOrFounding` / `db()` over AsyncLocalStorage) +
token→tenant resolver (`src/auth/apiTokens.ts`, sha256 `hashToken` /
`tenantForToken` / `ensureToken`). Every repo reads/writes scoped by
`tenant_id`; the Fastify guard resolves the tenant (static founding bearer →
founding, per-tenant `api_tokens`, or dashboard JWT → founding in phase 1) and
binds it for the request via `als.run(done)` (a bare `enterWith` in a hook does
NOT reach the handler — that bug is caught by `src/api/tenancy.test.ts`, which
proves an Acme-token request sees only Acme's skills). Unscoped calls default to
founding, so it's non-breaking: **169/169 tests**. API startup seeds
`BRIAN_API_TOKEN` as the founding tenant's first `api_tokens` row.

**Phase 2 remaining (RLS as a real backstop) — needs one founder step:** create
a non-owner `brian_app` role and connect the app as it (its credential goes in
`server/.env` — founder-provided), pin a per-request client with `SET LOCAL
app.tenant_id` inside `db()` (repos already go through `db()`, so no repo
change), add `tenant_isolation` RLS policies on every tenant table (+ ENABLE RLS
on `context_entries`/`context_versions`, still flagged ERROR by the security
advisor), and add cross-tenant leak tests that connect as `brian_app` (owner
bypasses RLS, so enforcement can only be proven from the non-owner role).
Phases 3–4 (Supabase Auth swap, hosted deploy) land with the first external
design partner.

### 5. Dashboard follow-ups
The dashboard is built (see above). Remaining ideas: shareable interview links
for non-admin experts (superseded by Supabase Auth invites once step 4 phase 3
lands), review-queue count badge in the sidebar, interview
resume-from-abandoned. The connectors work (step 3) adds its own dashboard
pages — build those as part of step 3, not separately.

### 6. Later / deferred (intentional anti-goals until real use proves them out)
- Cloud hosting of the HTTP surface (Fly/Railway) — everything is transport-ready;
  deploy when a remote agent actually needs it (Supabase phase 4, step 4 above).
- Connector *schedulers/daemons* — connectors themselves are now step 3, but
  v1 syncs are manual `npm run sync`; automation only after the pipeline
  proves its signal-to-noise on real data.
- Graph DB / graph UI — not happening for v1; a skill table beats it.
- Multi-tenant scoping — no longer deferred as an idea: fully designed in
  `SupabaseIntegration.md` (see step 4 above); build when prioritized.
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
  `docs/superpowers/specs/2026-07-04-brian-onboard-design.md`
- Agent contract: `docs/agent-contract.md` · Gmail setup: `docs/gmail-setup.md`
- Backend entry points: `server/src/api/index.ts` (REST + `/mcp` HTTP),
  `server/src/mcp/index.ts` (MCP stdio), `server/src/review/cli.ts` (review CLI),
  `server/src/ingestion/capture.ts` (capture pipeline), `server/src/llm/` (OpenAI).
