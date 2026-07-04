# Always-On Invocation — Design

**Date:** 2026-07-04
**Problem:** Agents connected to Brian's MCP server only call its tools when the
user explicitly says "use Brian". MCP tool selection is probabilistic — the model
decides — so on most tasks `find_skill`/`find_context` are never called and Brian's
judgment never reaches the agent. This defeats the product: a company brain that is
only consulted on request is not a brain.

**Goal:** Brian is consulted on every task, automatically, with zero per-task user
action.

## Approaches considered

1. **Prompt-side only** — MCP server `instructions` + trigger-rich tool
   descriptions. Cheap, works in every MCP client (Claude Code, Claude Desktop,
   Cursor…), but still probabilistic: it raises call rates, it cannot guarantee
   them.
2. **Harness-side push (hooks)** — Claude Code hooks run deterministically on
   every session start and every user prompt. A `UserPromptSubmit` hook sends the
   prompt to Brian and injects the matched skill + context into the conversation
   before the model even starts. Guaranteed, but Claude Code–specific and requires
   the Brian server to be running (must degrade silently when it isn't).
3. **Proxy/wrapper client** — intercept the agent's model calls and inject Brian.
   Maximum control, but heavy, brittle, and client-specific. Rejected (YAGNI).

**Chosen: 1 + 2.** Layer 1 improves every client; layer 2 makes invocation
deterministic in the primary client (Claude Code). They share no code paths and
fail independently.

## Design

### Layer 1 — MCP server pulls harder (all clients)

- `buildMcpServer()` passes `instructions` to the `McpServer` constructor —
  MCP's `initialize` response carries it and Claude Code/Desktop surface it in the
  system prompt (same mechanism as Supabase's MCP guidance). Content: a condensed
  agent contract — always `find_skill` + `find_context` before acting, follow
  procedure/hard_rules/guardrails, `log_execution` after, `capture` durable
  learnings.
- Rewrite tool descriptions with trigger language ("Call this FIRST before acting
  on ANY business task…") mirroring how high-recall skills/tools are described.
  Affected: `find_skill`, `find_context`, `capture`, `log_execution`.

### Layer 2 — deterministic push via Claude Code hooks

- **New REST endpoint** `POST /api/agent/briefing` `{ query }` →
  `{ skill: Skill | null, context: ContextEntry | null }`. Runs `findSkill` and
  `findContextWithDistance` in parallel; one round trip keeps hook latency to a
  single HTTP call. Sits behind the existing dual-mode auth guard.
- **Hook script** `server/scripts/hooks/brian-hook.mjs` — zero-dependency Node
  ESM, one script handling both events (reads the hook event JSON on stdin):
  - `SessionStart` → emits the agent contract as `additionalContext`.
  - `UserPromptSubmit` → POSTs the prompt to `/api/agent/briefing` (5 s
    timeout — cold-start embedding calls exceed 2.5 s) and emits matched
    skill + context as `additionalContext`.
  - Config from env: `BRIAN_URL` (default `http://localhost:3001`),
    `BRIAN_API_TOKEN`, or `BRIAN_ENV_FILE` pointing at `server/.env`.
  - **Fail-silent invariant:** any error (server down, bad token, timeout) →
    exit 0 with no output. A broken Brian must never break the user's agent.
- **Installer** `server/scripts/hooks/install.mjs` (`npm run hooks:install`,
  `-- --user` for `~/.claude/settings.json`): idempotently merges the two hook
  entries into a `.claude/settings.json`, preserving unrelated settings and
  existing hooks. Repo ships a project-level `.claude/settings.json` so Brian's
  own repo demonstrates the wiring.

### Docs

`docs/agent-contract.md` gains a "Guaranteed invocation" section: paste-contract
remains for non-hook clients; hook install instructions for Claude Code projects.
`Nextstep.md` updated.

## Error handling

- Briefing endpoint: validation error → 400; embedding/DB failure → 500 (hook
  swallows it).
- Hook: all failures silent (exit 0, no stderr noise); timeout hard-capped so
  prompts are never delayed more than ~2.5 s when the server is unreachable.
- Installer: refuses to run if settings JSON is unparseable; otherwise merge is
  additive and idempotent (re-running changes nothing).

## Testing

- MCP: server exposes instructions; descriptions contain trigger phrases.
- API: briefing returns skill+context, nulls when no match, 401 without auth
  (existing app.test patterns, real test-schema DB, mocked embeddings as today).
- Hook: logic exported as pure functions (`handleHookEvent` with injected
  `fetch`) and unit-tested: session-start payload, prompt-submit happy path,
  fail-silent on fetch error/timeout/non-200.
- Installer: merge function unit-tested (fresh file, existing unrelated hooks,
  idempotency).
