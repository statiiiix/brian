# Brian CLI

The public package `@brianthebrain/cli` safely configures supported local AI clients for Brian's hosted MCP resource:

```text
https://api.brianthebrain.app/mcp
```

The package is ESM, requires Node.js 22+, has zero runtime dependencies, and exposes the `brian` binary. Node 20 reached end of life before this release, so the plan's “Node 20+ or oldest actively supported version” rule resolves to Node 22. It is publishable from `packages/cli`, but this repository does not claim that version 0.1.0 has been published to npm.

## Quick start

```bash
npx @brianthebrain/cli signup
npx @brianthebrain/cli connect
npx @brianthebrain/cli status
npx @brianthebrain/cli doctor
npx @brianthebrain/cli disconnect
```

The CLI never accepts `--token`, never writes an Authorization header, and never stores OAuth access or refresh tokens. The selected MCP client owns the OAuth session.

## Options

```text
--only <claude-code,claude-desktop,cursor,codex>
--dry-run
--yes, -y
--json
--help, -h
--version
```

`connect` and `disconnect` preview changes and request confirmation. Machine-readable mutations require both `--json` and `--yes`. `--dry-run` completes parsing and write-safety preflight but does not modify files or open a browser.

## Commands

- `signup` opens `https://brianthebrain.app/signup?source=cli`, or prints it under SSH/headless use. Passwords never enter the terminal.
- `connect` detects clients, validates every selected config first, backs up existing files, and writes the canonical URL-only entry. A second run is byte-idempotent.
- `status` reports detection, URL state, legacy endpoint/token warnings, instructions, restart requirements, the evidence-labeled OAuth capability category, and the last locally recorded `doctor` result without exposing credential values. A native login command remains `native-command-surface-unverified` until a dated Brian staging result exists.
- `doctor` checks both protected-resource metadata URLs, authorization-server discovery, PKCE S256 support, the unauthenticated MCP challenge, malformed/duplicate config, raw Supabase URLs, and legacy static auth. Network requests contain no bearer. Afterward it records only the categorical result, check time, and normalized resource URL in `~/.brian/health.json` with mode `0600`; it never stores response bodies, client identity, query strings, or credentials. Health persistence is best effort, and `status` reports `unknown` until a valid local record exists.
- `disconnect` removes only Brian-owned entries and marker blocks. It does not revoke the server grant; revoke from Settings → Agents & connections.

## Safety behavior

Existing files receive a sibling backup named `<file>.bak-brian-<YYYYMMDD-HHmmss-SSS>` with private `0600` permissions. The CLI refuses malformed JSON/TOML, scalar JSON, duplicate Brian entries, symlinks, and non-writable files. Multi-client preflight is atomic: if any selected config is unsafe, none of the planned writes occurs. Unrelated settings and MCP servers are preserved.

When upgrading a legacy raw Supabase URL or static bearer entry, the confirmed change writes only the canonical OAuth URL. The old credential survives only in the timestamped backup so the user can finish OAuth safely; delete that backup according to the organization's credential-retention policy after reconnection.

## Configuration paths

| Client | Paths |
|---|---|
| Claude Code | `~/.claude.json` |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Linux) | `~/.config/Claude/claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json`, `~/.cursor/AGENTS.md` |
| Codex | `~/.codex/config.toml`, `~/.codex/AGENTS.md` |

Windows paths are implemented but remain preview until they run in Windows CI. The JavaScript package and paths are architecture-neutral; no separate Apple Silicon or Intel binary exists.

## Stable exit codes

| Code | Meaning |
|---:|---|
| 0 | Success, including unchanged/idempotent status. |
| 1 | Validation, network, doctor, or write failure. |
| 2 | Invalid command or option. |
| 3 | No selected supported client detected. |
| 4 | Confirmation declined or unavailable. |

## Development and release verification

```bash
cd packages/cli
npm test
npm run check
npm pack --dry-run
```

Before publishing, install the generated tarball in a clean temporary project, execute its `brian` bin, run macOS arm64/x64 and Linux Node 22/24/26 CI, confirm package ownership/license, and complete the staging compatibility matrix. Publishing or changing npm/GitHub state requires an explicit release action; local implementation alone does not perform it.

The package-local [README](../packages/cli/README.md) contains the same command reference for npm consumers.
