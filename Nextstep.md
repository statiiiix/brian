# Brian — Next Steps

> Context-preservation doc. Snapshot of where the Company Brain backend stands and
> what to do next, so we can resume without re-deriving anything.
> Last updated: 2026-07-01.

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
- **LLM:** OpenAI only (no Claude). Embeddings `text-embedding-3-small` (1536);
  generative `gpt-5.4-mini` via `LLM_MODEL`, using **Structured Outputs** (strict
  `json_schema`) because it's a reasoning model.
- **Status:** 74/74 tests pass on the live DB.

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

### 2. Founder's React UI (their track)
Skill list, editor with version history, capture paste box, execution log, and a
review queue highlighting `draft`/`needs_review`. The JSON API contract is ready
(`CompanyBrain.md` → API Contract); auth is a bearer header.

### 3. Later / deferred (intentional anti-goals until real use proves them out)
- Cloud hosting of the HTTP surface (Fly/Railway) — everything is transport-ready;
  deploy when a remote agent actually needs it.
- Automated third-party connectors (Slack/Gmail/Notion schedulers) — `capture` is
  the v2 substitute.
- Graph DB / graph UI — not happening for v1; a skill table beats it.
- Multi-tenant scoping (tenant column + RLS policies) — only when serving many companies.
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
- Product source of truth: `CompanyBrain.md`
- Agent contract: `docs/agent-contract.md` · Gmail setup: `docs/gmail-setup.md`
- Backend entry points: `server/src/api/index.ts` (REST + `/mcp` HTTP),
  `server/src/mcp/index.ts` (MCP stdio), `server/src/review/cli.ts` (review CLI),
  `server/src/ingestion/capture.ts` (capture pipeline), `server/src/llm/` (OpenAI).
