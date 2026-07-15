# Connect local AI clients to Brian

The public onboarding path is the standalone Brian CLI:

```bash
npx @brianthebrain/cli connect
```

It detects Claude Code, Claude Desktop, Cursor, and Codex, previews every change, and backs up existing configuration. File-configured clients receive only the hosted OAuth resource:

```text
https://api.brianthebrain.app/mcp
```

Version `0.1.0` is published publicly on npm. A clean machine with Node.js 22 or newer can resolve the `npx` command directly.

## Common commands

```bash
npx @brianthebrain/cli signup
npx @brianthebrain/cli connect
npx @brianthebrain/cli connect --dry-run
npx @brianthebrain/cli connect --only claude-code,codex
npx @brianthebrain/cli status
npx @brianthebrain/cli doctor
npx @brianthebrain/cli disconnect
```

For noninteractive mutation, pass both `--yes` and `--json`. The public CLI rejects `--token`; the MCP client performs browser OAuth and stores its own access/refresh credentials.

After connection:

- Claude Code: run `claude mcp login brian` (or `--no-browser` over SSH).
- Codex: run `codex mcp login brian`.
- Cursor: restart, then use the client's Brian connection UI. Treat OAuth as version-dependent until its exact version is in [the compatibility matrix](mcp-client-compatibility.md).
- Claude Desktop: open `https://claude.ai/customize/connectors`, choose **Add custom connector**, name it `Brian`, and enter `https://api.brianthebrain.app/mcp`. Do not put this remote URL in `claude_desktop_config.json`; that file accepts local MCP server definitions, while remote connectors are account-level.

## Safety

- Existing files receive a timestamped `.bak-brian-*` sibling backup.
- Malformed/scalar JSON, unsafe TOML, duplicate Brian entries, symlinks, and read-only files are refused.
- Preflight covers every selected client before any file is written.
- Re-running a completed install is byte-idempotent.
- Disconnect removes only Brian-owned entries/marker blocks and preserves unrelated configuration.
- Status/doctor report credential presence and paths, never values.

See [docs/cli.md](cli.md) for paths, exit codes, and release verification.

## Migrating an old static-token installation

Old instructions used `npm run onboard -- --url <raw-edge-url> --token <token>`. Do not use that flow for public hosted Brian.

1. Run `brian status` or `brian doctor`; it reports the raw Supabase endpoint or static auth without printing the credential.
2. Run `brian connect` and review the URL-only replacement. The old config is preserved in the timestamped backup until OAuth is proven.
3. Complete browser OAuth immediately and verify a tenant-scoped `find_skill` call.
4. Revoke the old server-side `api_tokens` credential.
5. Delete backups containing the old bearer according to the organization's credential-retention policy.

Never copy a Supabase access/refresh token into JSON/TOML, `.env`, `AGENTS.md`, or a shell command.

## Internal compatibility command

`cd server && npm run onboard` is now a thin compatibility alias for the checked-in public CLI implementation under `packages/cli`. It no longer has a separate mutation path or platform registry.

The original flag-only forms continue to work:

```bash
npm run onboard -- --dry-run
npm run onboard -- --yes --only cursor,codex
npm run onboard -- --status
```

They delegate to `brian connect --dry-run`, `brian connect --yes --only ...`, and `brian status`, respectively. Explicit public commands also pass through, for example `npm run onboard -- doctor --json`.

The compatibility command always targets the canonical hosted OAuth resource. It rejects `--url` and `--token` with exit code 2 before delegation, never prints the supplied credential, and never writes it to client configuration. It no longer installs local stdio, arbitrary self-hosted URLs, or static-token configurations. Existing self-hosted installations should keep their current configuration until they have a deliberate migration path; do not use the compatibility command to overwrite them.

New onboarding behavior, platform adapters, and safety fixes belong only in `packages/cli`.
