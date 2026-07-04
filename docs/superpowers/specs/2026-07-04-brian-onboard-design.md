# Brian Onboard (`npm run onboard`) — Design

**Date:** 2026-07-04
**Problem:** Wiring Brian into a customer's agents is currently manual and
per-platform: edit an MCP config here, run `hooks:install` there, paste the
agent contract somewhere else. For a customer running several agents (Claude
Code, Claude Desktop, Cursor, Codex, OpenClaw/Clawdbot…), onboarding is the
first impression — it must be one command.

**Goal:** One command detects every supported agent platform on the machine,
shows what it will change, and wires each one: MCP registration + the
strongest always-on layer that platform supports. Re-running is always safe.

## Approaches considered

1. **One installer script per platform** (status quo direction: `hooks:install`,
   then a `codex:install`, …). No detection, no shared UX, customers must know
   what they have. Rejected.
2. **Single `onboard` command with per-platform adapters behind a common
   interface** — detection + plan + apply in one flow; adapters are small,
   independently testable modules. **Chosen.**
3. **Published `npx brian-onboard` package.** Right eventual distribution, but
   packaging/publishing is pointless while Brian itself runs from this repo
   (cloud hosting deliberately deferred). The chosen design keeps the entry
   point package-ready so publishing later is a rename, not a rewrite.

## CLI

    cd server && npm run onboard                  # detect → show plan → confirm → apply
    npm run onboard -- --yes                      # no prompt (scripted onboarding)
    npm run onboard -- --dry-run                  # plan only, change nothing
    npm run onboard -- --only claude-code,cursor  # limit platforms
    npm run onboard -- --status                   # table: platform / detected / wired
    npm run onboard -- --url https://brian.example.com --token <TOKEN>   # remote Brian

Defaults: local Brian (stdio MCP via `npm --prefix <abs server> run mcp`; the
briefing hook hits `http://localhost:3001`). With `--url/--token` the adapters
emit remote config instead (Streamable HTTP `POST <url>/mcp` + bearer) for
platforms that support it, and the hook env gets `BRIAN_URL`/`BRIAN_API_TOKEN`.

Output ends with per-platform next steps ("restart Claude Desktop", "start the
Brian API: npm run api", …) and what was skipped and why.

## Architecture

`server/scripts/onboard/` — plain zero-dependency Node ESM, same conventions
as `scripts/hooks/` (runnable by bare `node`, no build):

- `onboard.mjs` — entry: parse flags, run adapters, render plan/confirm/apply.
- `lib.mjs` — shared helpers: read/merge/write JSON configs (refuse-on-
  unparseable, timestamped `.bak-brian` backup on first modification of a
  file, idempotent deep-merge), marker-block editing for text files
  (`# >>> brian >>>` … `# <<< brian <<<`), TOML section append/detect for
  Codex (line-scan for `[mcp_servers.brian]` — no TOML parser; never rewrites
  existing content, only appends the section or reports "already wired").
- `adapters/<platform>.mjs` — one per platform, exporting:

```js
export const name = "claude-code";
export function detect(env)  // -> { detected: boolean, evidence: string }
export function status(env)  // -> { mcp: "wired"|"missing", alwaysOn: "wired"|"missing"|"unsupported" }
export function plan(env, opts)   // -> [{ file, action, description }]
export async function apply(env, opts)  // idempotent; returns applied plan
```

`env` carries `home`, `platform`, and path overrides so tests run against a
temp HOME. Adding a platform later = adding one adapter file to a registry
array in `onboard.mjs`.

## Platform adapters (v1)

Tier A — implemented and live-verified on this machine:

| Platform | Detect | MCP registration | Always-on layer |
|---|---|---|---|
| **Claude Code** | `~/.claude/` | `claude mcp add brian --scope user` via CLI when present; else merge `mcpServers.brian` into `~/.claude.json` | Hooks: reuse the exact entries `scripts/hooks/install.mjs` writes, into `~/.claude/settings.json` (delegate to shared code, don't duplicate) |
| **Claude Desktop** | `~/Library/Application Support/Claude/` (per-OS path table) | Merge `mcpServers.brian` into `claude_desktop_config.json` (create) and/or the `mcp.json` observed there — adapter reads what actually exists and updates the live file | MCP `instructions` only (no hook surface) |
| **Cursor** | `~/.cursor/` | Merge `mcpServers.brian` into `~/.cursor/mcp.json` | Marker block with the agent contract appended to `~/.cursor/AGENTS.md` (global rules) |

Tier B — implemented against current docs, verified with fixture tests only
(not installed on this machine); implementer must confirm exact file formats
against official docs at build time and record findings in the plan:

| Platform | Detect | MCP registration | Always-on layer |
|---|---|---|---|
| **Codex CLI** | `~/.codex/` | Append `[mcp_servers.brian]` (command/args/env) to `~/.codex/config.toml` | Marker block with the contract in `~/.codex/AGENTS.md` (loaded every session) |
| **OpenClaw (Clawdbot)** | `~/.openclaw/` or `~/.clawdbot/` | Per current OpenClaw docs (config-file MCP support; else print manual instructions) | Marker block with the contract in the workspace `AGENTS.md`/`TOOLS.md` bootstrap files |

Honest layer labels in all output: hooks = *guaranteed per-prompt briefing*;
bootstrap/rules files = *contract always in context, tools still model-pulled*;
instructions-only = *contract delivered at connect*.

## Safety & error handling

- **Never destructive:** existing keys and unrelated config are preserved;
  first write to any file creates `<file>.bak-brian-<YYYYMMDD-HHmmss>` beside it.
- **Refuse, don't guess:** unparseable JSON/TOML → skip that platform with a
  clear message and nonzero summary flag; never rewrite what we can't parse.
- **Idempotent:** re-running produces "already wired", zero diffs (tested).
- **Confirm by default:** the plan (files + actions) prints before any write;
  `--yes` skips the prompt, `--dry-run` never writes.
- Missing prerequisites reported, not fatal: e.g. no `BRIAN_API_TOKEN` in
  `server/.env` when `--url` is remote → skip with instructions.

## Out of scope (v1)

- Windows paths (adapters take a path table, so adding later is data, not code).
- Auto-starting the Brian API (LaunchAgent/systemd) — printed as a next step;
  candidate for v2 `--daemon`.
- Publishing to npm as `brian-onboard` — entry point is kept dependency-free
  and repo-relative-path-free enough to publish later.
- New platforms (Gemini CLI, Windsurf…) — adapter registry makes them additive.

## Testing

- `lib.mjs` merge/marker/TOML helpers: unit tests incl. backup creation,
  unparseable-refusal, idempotency.
- Each adapter: subprocess tests against a temp HOME seeded with realistic
  fixture configs (fresh install / already-wired / foreign content preserved /
  broken JSON skipped). Tier A fixtures copied from real files on this machine.
- CLI: `--dry-run` writes nothing; `--status` reflects fixtures; `--only`
  filters; exit codes (0 all wired, 1 partial skips).
- Live verification (Tier A): run `--status` and `--dry-run` against the real
  machine; apply for Claude Code + Cursor + Desktop and smoke-test one prompt.
