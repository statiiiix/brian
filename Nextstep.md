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
- **Status:** 114/114 tests pass on the live DB (as of 2026-07-04).

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

### 2. Brian onboard — one-command multi-agent MCP install (specced, not built)
**Spec (read first): `docs/superpowers/specs/2026-07-04-brian-onboard-design.md`.**
Why it exists: wiring Brian into a customer's agents is currently manual and
per-platform; onboarding must be ONE command. This builds on the shipped
always-on-invocation work (see "done" above) — the onboarder installs those
same layers everywhere.

What to build, concretely:
- **Entry point:** `npm run onboard` → `server/scripts/onboard/onboard.mjs`.
  Zero-dependency Node ESM, bare-`node` runnable, same conventions as
  `server/scripts/hooks/` (which is shipped and is the pattern to copy).
- **Flow:** detect installed agent platforms → print a plan (every file +
  action) → confirm → apply. Flags: `--yes` (no prompt), `--dry-run` (never
  writes), `--status` (table: platform / detected / wired), `--only a,b`,
  `--url <https://…> --token <t>` for remote/hosted Brian (default: local
  stdio MCP + `http://localhost:3001` briefing hook).
- **Adapter interface** (one file per platform in
  `server/scripts/onboard/adapters/`, registered in an array — new platforms
  are additive): `detect(env)`, `status(env)`, `plan(env, opts)`,
  `apply(env, opts)`. `env` carries `home` + path overrides so tests run
  against a temp HOME.
- **Platforms, tier A** (installed on this machine; verify live):
  Claude Code (MCP via `claude mcp add` or `~/.claude.json`; deterministic
  hooks by REUSING `server/scripts/hooks/install.mjs` — do not duplicate it),
  Claude Desktop (`~/Library/Application Support/Claude/` — read what config
  file actually exists there, both `claude_desktop_config.json` and `mcp.json`
  have been observed), Cursor (`~/.cursor/mcp.json` + contract block in
  `~/.cursor/AGENTS.md`).
- **Platforms, tier B** (NOT on this machine — build against official docs +
  fixture tests, and verify the file formats against current docs before
  writing code): Codex CLI (`~/.codex/config.toml` `[mcp_servers.brian]`
  appended by line-scan, no TOML parser; contract in `~/.codex/AGENTS.md`),
  OpenClaw/Clawdbot (`~/.openclaw/`; config-file MCP if supported, else print
  manual steps; contract in workspace bootstrap files).
- **Safety invariants (non-negotiable):** timestamped `.bak-brian-*` backup
  before first touch of any file; refuse (skip + report) on unparseable
  JSON/TOML — never rewrite what can't be parsed; idempotent — second run
  produces "already wired" and zero diffs; label each layer honestly in output
  (hooks = guaranteed per-prompt briefing; AGENTS.md/rules = contract always
  in context, tools still model-pulled; instructions-only = contract at
  connect).
- **Testing:** unit tests for the shared merge/marker/TOML helpers
  (`lib.mjs`); per-adapter subprocess tests against temp-HOME fixtures
  (fresh / already-wired / foreign-content-preserved / broken-config-skipped);
  live `--status`/`--dry-run` + real apply for tier A on this machine.
- **Done means:** a new machine goes from zero → all its agents consulting
  Brian with one command and one restart of each app.

### 3. Connectors — mine Gmail/Slack for patterns & SOPs (chosen direction, needs brainstorm + spec before code)
This was chosen as the next capture milestone in the 2026-07-03 brainstorm and
is now a firm commitment: Brian should not depend only on interviews and
manual `capture` — it should read the company's real communication streams,
find the recurring processes and durable decisions hiding in them, filter the
junk, and turn the good stuff into skill/context drafts. **Run the
superpowers brainstorm → spec → plan flow before building; what follows is the
agreed direction and constraints, not a finished spec.**

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

### 4. Supabase integration — multi-tenant auth + per-client skills (designed, not built)
**Read `SupabaseIntegration.md` carefully (start to finish) before touching
this** — it holds the decided answers: shared tables + `tenant_id` + RLS (NOT
per-client vector tables/schemas), Supabase Auth for dashboard humans,
hashed per-tenant `api_tokens` for agents, `SET LOCAL app.tenant_id` +
double enforcement (SQL + RLS), and the four rollout phases. Phases 1–2
(migration `005_tenants.sql` + token guard; real RLS via a non-owner
`brian_app` role) are safe to build now; phases 3–4 (Supabase Auth swap,
hosted deploy) land with the first external design partner.

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
