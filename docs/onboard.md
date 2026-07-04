# Brian Onboard — one-command multi-agent install

Wire every AI-agent platform on a machine to Brian (the company brain) with a
single command. The onboarder detects installed platforms, shows exactly what it
will change, then registers Brian's MCP server and installs the strongest
always-on layer each platform supports.

```bash
cd server
npm run onboard                 # detect → show plan → confirm → apply
npm run onboard -- --status     # table: platform / detected / mcp / always-on
npm run onboard -- --dry-run    # print the plan, change nothing
npm run onboard -- --yes        # apply without the confirmation prompt
npm run onboard -- --only claude-code,cursor        # limit to named platforms
npm run onboard -- --url https://brian.example.com --token <TOKEN>   # remote Brian
```

`--help` lists every flag. Exit code is `0` when everything detected is wired (or
on `--status`/`--dry-run`), and `1` when a detected config was **refused** (see
Safety). A `--url` remote install requires `--token` (else exit `2`).

## Platforms and layers

Each platform gets an **MCP registration** (the tools) plus an **always-on
layer** (how reliably the Brian contract reaches the model). The layers are
labelled honestly because they are not equally strong:

| Platform | MCP registration | Always-on layer | Layer strength |
|---|---|---|---|
| **Claude Code** | `mcpServers.brian` merged into `~/.claude.json` | SessionStart + UserPromptSubmit hooks in `~/.claude/settings.json` (delegated to `scripts/hooks/install.mjs`) | **guaranteed per-prompt briefing** |
| **Claude Desktop** | `mcpServers.brian` merged into `claude_desktop_config.json` (or the `mcp.json` present) | MCP `instructions` | contract delivered at connect |
| **Cursor** | `mcpServers.brian` merged into `~/.cursor/mcp.json` | Brian contract marker block in `~/.cursor/AGENTS.md` | contract always in context (tools still model-pulled) |
| **Codex CLI** | `[mcp_servers.brian]` appended to `~/.codex/config.toml` | contract marker block in `~/.codex/AGENTS.md` | contract loaded every session (tools model-pulled) |
| **OpenClaw / Clawdbot** | manual (config format unverified — printed as a step) | contract marker block in `AGENTS.md` | best-effort |

After applying, **restart each app** so it reloads its MCP config, and keep the
Brian API running so the Claude Code per-prompt hook can fetch briefings:

```bash
cd server && npm run api
```

## Safety

- **Backups:** the first time the onboarder modifies any existing file it copies
  it to `<file>.bak-brian-<YYYYMMDD-HHmmss>` beside it.
- **Refuse, don't guess:** an unparseable JSON/TOML config is never rewritten —
  the platform is skipped, reported, and the run exits non-zero.
- **Idempotent:** re-running reports "already wired" and writes nothing.
- **Non-destructive:** unrelated keys, other MCP servers, and your own
  `AGENTS.md` content are preserved (Brian owns only its marker block).

## Adding a platform

Add one module to `server/scripts/onboard/adapters/` exporting
`{ name, label, detect, status, plan, apply }` and register it in the `REGISTRY`
array in `onboard.mjs`. Shared config-editing primitives live in
`server/scripts/onboard/lib.mjs`; tests go in `server/src/onboard/`.
