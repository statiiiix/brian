# Brian — Roadmap to Done (design)

Date: 2026-07-01
Status: approved by founder
Source of truth for product intent: `CompanyBrain.md`. State snapshot: `Nextstep.md`.

## Goal

Finish the Nextstep.md roadmap. End state:

- Brian's MCP server is usable from **Claude Code and Claude Desktop** (stdio).
- **Drafts are reviewable** from a CLI (list → inspect → approve/reject).
- **One real business tool (Gmail)** does actual work behind the MCP tool names.
- The server is reachable over **authenticated HTTP** (MCP Streamable HTTP + REST,
  bearer token), running **locally only** — cloud deploy is explicitly out of scope
  until a real external agent needs it.
- The **agent system-prompt contract** is written down as a doc.

Founder decisions (2026-07-01): both Claude clients; Gmail as first real tool via
Google OAuth + refresh token (draft + send); local-only hosting; minimal CLI review
surface (the React UI stays the founder's track per CompanyBrain.md).

## M1 — Wire MCP into Claude Code + Desktop

Problem: `server/src/mcp/index.ts` assumes DATABASE_URL / OPENAI_API_KEY are already
exported; when a Claude client launches it, they aren't.

- Load `server/.env` in-process at MCP boot using Node's built-in
  `process.loadEnvFile(path)`. Resolve the path relative to the server package root
  (not CWD — Desktop launches from `/`). Silently skip if the file is missing;
  already-exported env vars win (loadEnvFile does not override existing vars).
- Register the server in both clients:
  - Claude Code: project-scoped `.mcp.json` at repo root
    (`npm --prefix server run mcp` or equivalent absolute-path command).
  - Claude Desktop: `mcpServers.brian` entry in
    `~/Library/Application Support/Claude/claude_desktop_config.json`, absolute paths.
- Smoke test from a Claude session: `find_skill("refund")` returns a seeded skill;
  `capture(...)` files an item; `find_context(...)` retrieves it.

## M2 — Draft review CLI

`npm run review` — interactive CLI built directly on the repo layer (no running API
required):

- Lists skills with status `draft` or `needs_review` (name, status, version, owner).
- `inspect N` prints the full skill (procedure, hard_rules, guardrails, examples).
- `approve N` → activate (existing activate path: bumps history, sets `active`,
  refreshes `last_reviewed_at`).
- `reject N` → retire.

This closes the graduated-autonomy loop: parked skills no longer pile up unseen.
The founder's React UI remains the proper review surface later.

## M3 — Real business tool: Gmail

1. **Adapter registry** in `server/src/mcp/`: a map from tool name → handler
   descriptor (handler fn + input schema + risk level). The MCP server registers
   business tools from the registry instead of hardcoding them. Existing mocks
   (`get_order`, `issue_refund`) become the first adapters — no behavior change.
2. **Gmail adapter**: plain `fetch` against the Gmail REST API, authenticated by
   exchanging a long-lived OAuth **refresh token** for access tokens. No googleapis
   dependency. Tools:
   - `create_email_draft(to, subject, body)` — risk `safe` (reversible: it's a draft
     in the founder's Gmail, a human sends or deletes it).
   - `send_email(to, subject, body)` — risk `destructive` (irreversible; the
     graduated-autonomy gate therefore parks any auto-captured skill using it as
     `draft` until human-approved).
   Register both in the tool-risk registry (`toolRisk.ts`).
3. **One-time auth helper**: `npm run gmail:auth` — local loopback OAuth flow
   (temporary localhost HTTP server for the redirect). Founder creates the Google
   Cloud OAuth client (Desktop type; guided steps in the plan), runs the script,
   pastes the printed refresh token into `server/.env`
   (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`).
4. **One real skill** authored against the adapter (e.g. "Customer inquiry reply"
   using `create_email_draft`), created as draft, approved via the M2 CLI, then
   executed end-to-end from Claude: find_skill → follow procedure → real draft
   appears in Gmail → execution logged.

Tests mock the Gmail HTTP transport; no test ever calls live Gmail. Live Gmail is a
manual smoke test.

## M4 — HTTP transport + auth + agent contract (local)

- Mount the MCP SDK's **Streamable HTTP** transport in the same process as the
  Fastify REST API (one hosted surface). Stdio entry remains for local Claude
  clients.
- **Auth**: static bearer token `BRIAN_API_TOKEN` (in `server/.env`), required on
  the MCP HTTP endpoint and all `/api/*` routes. Constant-time comparison.
  Localhost-only by default.
- **Execution logging for remote agents**: expose a `log_execution` MCP tool (skill
  id, task input, actions taken, outcome) writing to the existing `executions`
  table, if the current loop doesn't already give remote agents a write path.
- **Agent system-prompt contract** written to `docs/agent-contract.md`:
  before acting, call `find_skill` + `find_context`; follow the procedure within
  `hard_rules`; if a guardrail trips, STOP and escalate to `escalation_target`;
  log the execution via `log_execution`. This is what makes an agent *use* the brain.
- Out of scope: cloud deploy (Fly/Railway/etc.), multi-tenant auth, HTTPS certs.

## Testing & constraints

- TDD throughout. All DB tests run in the isolated `test` schema via
  `TEST_DATABASE_URL`; live `public` (2 seeded skills) is never touched.
- The existing 52 tests must keep passing after every milestone.
- No new heavyweight dependencies; prefer Node built-ins and `fetch`.
- Anti-goals from CompanyBrain.md still hold: no graph DB, no connectors/schedulers,
  no auto-live skills, no UI build (founder's track).

## Ops notes

- Rotate the OpenAI API key (it was shared in chat) — reminder carried into the plan.
- Gmail credentials live only in gitignored `server/.env`.
