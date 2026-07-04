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
- **Status:** 81/81 tests pass on the live DB.

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

## Next steps (prioritized)

### 1. Founder manual steps (unblock Gmail + verify clients)
- Follow `docs/gmail-setup.md` (GCP OAuth client → `npm run gmail:auth` →
  paste `GMAIL_REFRESH_TOKEN` into `server/.env`), then run
  `npx tsx src/scripts/gmailSmoke.ts` and check the Drafts folder.
- Restart Claude Desktop / start a Claude Code session in this repo and
  smoke-test: `find_skill("refund")`, `capture(...)`, `find_context(...)`,
  and the full e2e ("a customer asked X — handle it" → draft in Gmail).
- Rotate the OpenAI API key.

### 2. Brian onboard — one-command multi-agent install (specced, not built)
Spec: `docs/superpowers/specs/2026-07-04-brian-onboard-design.md`. A single
`npm run onboard` (`server/scripts/onboard/`, zero-dep ESM like the hooks
scripts) that detects the agent platforms on a machine and wires each one:
MCP registration + the strongest always-on layer it supports. Tier A
(live-verifiable on this machine): Claude Code (reuse `hooks:install`),
Claude Desktop, Cursor. Tier B (fixture-tested; confirm file formats against
official docs at build time): Codex CLI, OpenClaw/Clawdbot. Adapter registry
makes new platforms additive. `--url/--token` flags are the seam that makes
onboarding tenant-ready for hosted multi-company Brian.

### 3. Supabase integration — multi-tenant auth + per-client skills (designed, not built)
**Read `SupabaseIntegration.md` carefully (start to finish) before touching
this** — it holds the decided answers: shared tables + `tenant_id` + RLS (NOT
per-client vector tables/schemas), Supabase Auth for dashboard humans,
hashed per-tenant `api_tokens` for agents, `SET LOCAL app.tenant_id` +
double enforcement (SQL + RLS), and the four rollout phases. Phases 1–2
(migration `005_tenants.sql` + token guard; real RLS via a non-owner
`brian_app` role) are safe to build now; phases 3–4 (Supabase Auth swap,
hosted deploy) land with the first external design partner.

### 4. Dashboard follow-ups
The dashboard is built (see above). Remaining ideas: shareable interview links
for non-admin experts, review-queue count badge in the sidebar, interview
resume-from-abandoned. Next capture milestone per the 2026-07-03 brainstorm:
**connectors** (Slack/Gmail/tickets → drafts into the same review queue).

### 5. Later / deferred (intentional anti-goals until real use proves them out)
- Cloud hosting of the HTTP surface (Fly/Railway) — everything is transport-ready;
  deploy when a remote agent actually needs it.
- Automated third-party connectors (Slack/Gmail/Notion schedulers) — `capture` is
  the v2 substitute.
- Graph DB / graph UI — not happening for v1; a skill table beats it.
- Multi-tenant scoping — no longer deferred as an idea: fully designed in
  `SupabaseIntegration.md` (see step 3 above); build when prioritized.
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
