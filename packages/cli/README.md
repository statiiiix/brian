# Brian CLI

`@brianthebrain/cli` safely configures supported local AI clients to use Brian's
hosted MCP resource:

```text
https://api.brianthebrain.app/mcp
```

The public CLI never accepts `--token`, never writes an authorization header,
and never stores OAuth access or refresh tokens. The MCP client owns its OAuth
session and opens browser authorization after Brian is configured.

## Requirements

- Node.js 22 or newer. CI covers the currently supported Node 22, 24, and 26 release lines.
- macOS or Linux for the first public release. Windows paths are implemented,
  but should be treated as preview until the platform fixtures run in CI.

## Commands

```bash
npx @brianthebrain/cli signup
npx @brianthebrain/cli connect
npx @brianthebrain/cli status
npx @brianthebrain/cli doctor
npx @brianthebrain/cli disconnect
```

Use `--only claude-code,codex` to limit client commands. `connect` and
`disconnect` show their plan and ask before writing. After a successful
interactive `connect`, the CLI offers to start each supported client's native
OAuth login command. Use `--no-login` to install configuration without starting
authentication. Automation must pass both `--yes` and `--json`:

```bash
npx @brianthebrain/cli connect --only codex --yes --json
```

`--dry-run` performs parsing and write-safety checks but does not modify files.

### `brian signup`

Opens `https://brianthebrain.app/signup?source=cli`. Under SSH, CI, or a
headless Linux session, it prints the URL instead. Passwords are never collected
in the terminal.

### `brian connect`

Detects supported clients, validates their configuration, and shows the exact files
it will change. File-configured clients receive only the canonical hosted MCP URL. Existing files get
a sibling backup with private `0600` permissions named:

```text
<file>.bak-brian-<YYYYMMDD-HHmmss-SSS>
```

The CLI refuses malformed JSON/TOML, non-object JSON configuration, symlinks,
read-only files, and duplicate Brian entries. Unrelated settings and MCP servers
are preserved. Re-running a completed connection is byte-for-byte idempotent.

Legacy raw Supabase endpoints and static bearer configuration are reported
without printing credential values. A confirmed upgrade replaces the live Brian
entry with URL-only OAuth configuration; the original config remains available
only in the timestamped backup. Complete browser OAuth immediately, then remove
legacy backups according to your credential-retention policy.

Current post-install authentication:

- Claude Code: the CLI offers `claude mcp login brian` when the installed client
  exposes that command; older versions get an upgrade/settings instruction.
- Codex: the CLI offers `codex mcp login brian`.
- Cursor: restart the client and use its Brian connection UI.
- Claude Desktop: open `https://claude.ai/customize/connectors`, choose
  **Add custom connector**, name it `Brian`, and enter
  `https://api.brianthebrain.app/mcp`. Claude Desktop remote connectors are
  account-level; the CLI never writes a remote URL to its local-server config.

Native commands run only after every planned configuration write succeeds, one
client at a time, and only in an interactive terminal after a separate login
confirmation. `--json`, `--dry-run`, non-interactive terminals, and
`--no-login` never launch a client. A login failure does not roll back the valid
URL-only configuration; the CLI prints the fixed retry command instead.

These command surfaces show native OAuth support, but no client/version is
reported as Brian-compatible until a dated staging result is recorded in the
public client compatibility matrix.

### `brian status`

Reports client detection, configured URL state, legacy endpoint/token warnings,
instruction status, tested OAuth capability category, and whether restart is
required. It also reports the last locally recorded `doctor` outcome, or
`unknown` if no valid record exists. Credential values are never included in
human or JSON output.

### `brian doctor`

Checks both OAuth protected-resource metadata URLs, authorization-server
discovery with PKCE S256, the unauthenticated MCP `401` Bearer challenge, and
local client configuration. Requests never include an Authorization header.
After each run, the CLI best-effort writes only the categorical outcome, check
time, and normalized resource URL to `~/.brian/health.json` with mode `0600`.
It never persists response bodies, client identity, URL query strings, or
credentials.

### `brian disconnect`

Removes only Brian-owned local entries, Codex's `mcp_servers.brian` tables, and
Brian-owned instruction marker blocks. It preserves unrelated config and creates
backups first. For Claude Desktop, also remove Brian in Claude's account-level
Connectors UI. Local disconnect does not revoke the server-side OAuth grant; use
Brian's Agents & connections dashboard to revoke it.

## Configuration paths

| Client | Path |
|---|---|
| Claude Code | `~/.claude.json` |
| Claude Desktop | Account-level connector at `https://claude.ai/customize/connectors` |
| Claude Desktop legacy cleanup (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop legacy cleanup (Linux) | `~/.config/Claude/claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json`, `~/.cursor/AGENTS.md` |
| Codex | `~/.codex/config.toml`, `~/.codex/AGENTS.md` |

## Stable exit codes

| Code | Meaning |
|---:|---|
| `0` | Command completed successfully, including an unchanged/idempotent run. |
| `1` | Validation, doctor, network, or write failure. No planned writes occur when preflight fails. |
| `2` | Invalid command or option. |
| `3` | No selected supported client was detected. |
| `4` | Confirmation was declined or unavailable. JSON mutations require `--yes`. |

## Development

```bash
npm test
npm run check
npm pack --dry-run
```

The package has zero runtime dependencies and uses Node's built-in test runner.
It intentionally does not contain an OAuth compatibility bridge.
`CLI_OAUTH_BRIDGE_ENABLED` is therefore a server-side release marker only; it
must remain false and cannot turn on bridge code that is not shipped.
