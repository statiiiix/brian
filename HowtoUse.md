# How to use Brian

> **Current status — July 15, 2026:** The CLI package is implemented at version `0.1.0`, but this repository does not yet claim that `@brianthebrain/cli` is published on npm. The local-source commands in this guide work now from the Brian repository. The `npx` and global-install commands become available after publication is verified. Production discovery and a disposable Dynamic Client Registration (DCR) register/delete proof have passed, but use `doctor` to check whether new production approvals are currently enabled before attempting a connection.

Brian's one public MCP address is:

```text
https://api.brianthebrain.app/mcp
```

Do not use a raw Supabase URL. Do not paste a bearer token into an AI client's configuration.

## What Brian is

Brian is a governed company brain for AI agents. It stores and serves:

- approved skills: procedures, hard rules, guardrails, allowed tools, and escalation targets;
- active context: company goals, decisions, and preferences;
- execution feedback: what an agent attempted and whether it completed, escalated, or failed;
- optional business actions exposed only when the user and connection have permission.

After an AI agent connects through MCP, Brian tells it to consult company knowledge before acting. The normal agent contract is:

1. Call `find_skill` and `find_context` before acting.
2. Follow the matched skill's procedure and hard rules.
3. Stop and escalate when a guardrail triggers.
4. Use only tools allowed by the matched skill and the connection grant.
5. Call `log_execution` after completing, escalating, or failing a governed task.
6. Call `capture` when durable knowledge appears and the connection has knowledge-write permission.

If no approved skill matches a business process, the agent should ask a human instead of inventing a company procedure.

## How the connection works

Brian separates local configuration, browser authentication, and authorization:

```text
Brian CLI
  -> detects an AI client
  -> writes only https://api.brianthebrain.app/mcp
  -> optionally starts that client's login command

AI client
  -> contacts Brian without a token
  -> receives the OAuth discovery challenge
  -> dynamically registers, or uses a pre-registered OAuth client
  -> opens the browser

Browser
  -> signs the user in
  -> displays the real client, callback, company, and permissions
  -> records explicit approval or denial

AI client
  -> owns and protects the OAuth access/refresh credentials
  -> calls Brian through MCP

Brian
  -> verifies the token, live grant, membership, tenant, and permissions
  -> exposes only permitted tools
```

The CLI never receives or stores OAuth access tokens or refresh tokens. The AI client owns that session.

## Requirements

- Node.js 22 or newer.
- macOS or Linux for the first public CLI release.
- Windows paths are implemented but remain preview until Windows CI evidence is recorded.
- An installed AI client for automatic configuration, or a custom client that implements compatible remote MCP and OAuth.
- An existing or invited Brian account while public signup is disabled.
- Browser access for interactive OAuth approval, unless the client supports a documented headless continuation.

Check Node.js:

```bash
node --version
```

The result should begin with `v22`, `v24`, `v26`, or another supported version newer than 22.

## Quick start

### Use the CLI from this repository today

Run these commands from the Brian repository root:

```bash
node packages/cli/src/index.mjs doctor
node packages/cli/src/index.mjs connect
node packages/cli/src/index.mjs status
```

`doctor` checks public OAuth/MCP readiness and local configuration. `connect` previews and installs the Brian URL. `status` shows what is configured without displaying credentials.

To configure only one client:

```bash
node packages/cli/src/index.mjs connect --only codex
```

### Use npm after publication is verified

Run without installing globally:

```bash
npx @brianthebrain/cli doctor
npx @brianthebrain/cli connect
npx @brianthebrain/cli status
```

If npm reports `404 Not Found`, the package has not been published or the requested version is unavailable. Use the local-source form until publication is confirmed.

### Install the short `brian` command after publication

```bash
npm install --global @brianthebrain/cli
brian doctor
brian connect
brian status
```

`@brianthebrain/cli` is the npm package name. `brian` is the terminal executable exposed by that package.

## Running the CLI

This guide uses `brian ...` for readability. Before npm publication, replace `brian` with:

```text
node packages/cli/src/index.mjs
```

For example:

```bash
# After global npm installation
brian connect --only codex

# From the repository today
node packages/cli/src/index.mjs connect --only codex
```

Show help and version:

```bash
brian --help
brian --version
```

The current repository version is `0.1.0`.

### What happens inside `connect`

The CLI performs the following sequence:

1. Parses the command and rejects unknown clients, options, or positional arguments.
2. Detects the selected known clients by their command or configuration directory.
3. Inspects every target configuration without printing credential values.
4. Builds a complete multi-client mutation plan.
5. Refuses unsafe inputs such as malformed JSON/TOML, scalar JSON, duplicates, symlinks, or non-writable files.
6. Stops before all writes if any selected client fails preflight.
7. Displays the exact files it plans to create or update.
8. Requests confirmation unless `--yes` is supplied.
9. Creates a private timestamped backup before replacing an existing file.
10. Writes only Brian-owned configuration and instruction blocks, preserving unrelated settings and MCP servers.
11. After all file writes succeed, separately offers to run each supported native login command.
12. Reports a fixed retry command if native authentication fails; it does not undo the valid URL configuration.

Re-running `connect` after a completed installation is byte-idempotent: it should not rewrite the same content or create another backup.

## Complete CLI command reference

### `brian signup`

```bash
brian signup
```

Opens:

```text
https://brianthebrain.app/signup?source=cli
```

Under SSH, in CI, in JSON mode, or in another non-interactive/headless environment, the CLI prints the URL instead of opening a browser. Passwords never enter the terminal.

Public signup may be paused even though the page is reachable. Existing and invited users can continue using the appropriate login path.

Safe preview:

```bash
brian signup --dry-run
```

`signup` accepts only `--dry-run` and `--json` in addition to help.

### `brian connect`

```bash
brian connect
```

Detects supported clients, previews changes, asks for confirmation, installs Brian's canonical URL, and may offer native authentication.

Examples:

```bash
brian connect --dry-run
brian connect --only codex
brian connect --only claude-code,codex
brian connect --no-login
brian connect --only codex --yes --json
```

Use `--no-login` when you want configuration installed but will authenticate later from the client UI or native command.

### `brian status`

```bash
brian status
```

Reports:

- whether each selected known client was detected;
- client version when available;
- the exact inspected configuration path;
- whether Brian is connected, missing, legacy, or invalid;
- whether the Brian instruction block is installed when that client uses one;
- restart requirements;
- evidence-labeled OAuth capability status;
- the last locally recorded `doctor` result.

`status` never prints credential values. Until `doctor` has stored a valid local result, health is `unknown`.

Limit the report:

```bash
brian status --only cursor,codex
```

### `brian doctor`

```bash
brian doctor
```

Checks:

- both RFC 9728 protected-resource metadata locations;
- authorization-server discovery;
- PKCE S256 advertisement;
- DCR advertisement and Brian's public DCR marker;
- whether new OAuth approvals are enabled or paused;
- marker drift between the provider and Brian;
- the unauthenticated MCP `401` Bearer challenge;
- canonical local client configuration;
- legacy raw Supabase endpoints or static credentials without printing them;
- installed instruction blocks;
- native-login readiness for each detected client.

Network checks do not send an Authorization header. `doctor` does not register a client, open a browser, authenticate, refresh a token, or prove end-to-end compatibility.

It best-effort stores only a categorical result, check time, and normalized resource URL at:

```text
~/.brian/health.json
```

The file uses private `0600` permissions. It does not contain response bodies, client identity, query strings, or credentials.

### `brian disconnect`

```bash
brian disconnect
```

Previews and removes only Brian-owned local configuration and instruction markers. It preserves unrelated settings and other MCP servers.

Important: `disconnect` is not server-side revocation. To immediately block an already authorized agent, revoke its connection in Brian's dashboard as well.

Non-interactive example:

```bash
brian disconnect --only codex --yes --json
```

### CLI options

| Option | Meaning | Accepted by |
|---|---|---|
| `--only <a,b>` | Limit the command to comma-separated known client names. | `connect`, `status`, `doctor`, `disconnect` |
| `--dry-run` | Show planned changes without writing or opening a browser/client login. | `signup`, `connect`, `disconnect` |
| `--yes`, `-y` | Apply mutations without the file-change confirmation. | `connect`, `disconnect` |
| `--no-login` | Install configuration without starting a native login command. | `connect` only |
| `--json` | Emit machine-readable JSON. Mutations also require `--yes`. | All commands |
| `--help`, `-h` | Show help. | All commands |
| `--version` | Print the CLI version. | Top level |

Known `--only` names are:

```text
claude-code
claude-desktop
cursor
codex
```

Automation that changes files must use both `--json` and `--yes`:

```bash
brian connect --only codex --json --yes
```

JSON mode, dry-run mode, non-interactive terminals, and `--no-login` never launch a native authentication command.

### Stable exit codes

| Code | Meaning |
|---:|---|
| `0` | Success, including unchanged/idempotent configuration. |
| `1` | Validation, network, doctor, authentication, or write failure. |
| `2` | Invalid or missing command/option. |
| `3` | No selected known client detected. |
| `4` | Confirmation declined or unavailable. |

## Supported and custom AI agents

Brian is not limited to the four clients recognized by its CLI. There are two layers:

- **Protocol support:** Brian can serve any standards-compatible remote MCP client that can complete the required OAuth flow.
- **CLI automation:** The CLI knows how to edit four specific local configuration formats today.

An unknown enterprise agent does not need a new Brian server integration merely because its product name is unfamiliar. If it implements the compatibility checklist below, configure Brian's canonical URL in that agent's MCP settings.

### Codex CLI/app

The CLI writes:

```text
~/.codex/config.toml
~/.codex/AGENTS.md
```

Then authenticate:

```bash
codex mcp login brian
```

Restart Codex when requested. To remove the client-owned OAuth session, use the logout command exposed by the installed Codex version, then revoke the Brian connection when immediate server denial is required.

### Claude Code

The CLI writes:

```text
~/.claude.json
```

When the installed version exposes the native login command:

```bash
claude mcp login brian
```

If that command is unavailable, upgrade Claude Code or use its MCP settings. Do not assume a version is compatible solely because it has an MCP menu; check the dated [compatibility matrix](docs/mcp-client-compatibility.md).

### Cursor

The CLI writes:

```text
~/.cursor/mcp.json
~/.cursor/AGENTS.md
```

Restart Cursor, open MCP settings, select Brian, and choose **Connect**. The exact OAuth behavior is version-dependent until a dated result appears in the compatibility matrix.

### Claude Desktop

The CLI uses one of these paths:

```text
macOS:  ~/Library/Application Support/Claude/claude_desktop_config.json
Linux:  ~/.config/Claude/claude_desktop_config.json
```

If `mcp.json` already exists in the Claude configuration directory, the CLI can use it instead of creating the primary file.

Restart Claude Desktop, open Brian in **Connectors**, and choose **Connect**. Remote MCP OAuth support varies by version.

### Any unknown or custom enterprise AI agent

Configure only this URL:

```text
https://api.brianthebrain.app/mcp
```

Do not add a static token or a custom Authorization header.

The agent/client must support:

1. Remote MCP using Streamable HTTP.
2. An unauthenticated request followed by a `401` Bearer challenge.
3. RFC 9728 `resource_metadata` discovery.
4. OAuth authorization-code flow with PKCE S256.
5. The exact Brian resource value in authorization and token requests.
6. Dynamic Client Registration for a public client, or a pre-registered client ID with exact callback URIs.
7. Browser continuation for user login and consent.
8. Secure client-side storage of access and rotating refresh credentials.
9. Token refresh and a fresh authorization flow after revocation.
10. MCP initialization and tool calls after authentication.

Useful discovery locations:

```text
https://api.brianthebrain.app/.well-known/oauth-protected-resource/mcp
https://api.brianthebrain.app/.well-known/oauth-protected-resource
```

The challenge points the client to Brian's protected-resource metadata. The metadata points to the Supabase authorization-server issuer, where the client discovers authorization, token, JWKS, and registration endpoints.

If the enterprise agent does not support DCR, a Brian/Supabase administrator can pre-register it only after receiving the agent's exact public-client callback URIs and authentication method. Never guess wildcard callbacks.

If a product does not implement remote MCP or the compatible OAuth flow, it needs a standards-compliant adapter, gateway, or product upgrade. Calling it an “AI agent” alone is not enough to make it interoperable.

Before declaring a new agent compatible, record dated evidence for discovery, registration, PKCE, resource binding, browser consent, token use, refresh, revocation, and credential storage. Use [the compatibility matrix](docs/mcp-client-compatibility.md) as the evidence ledger.

## Browser login and consent

After the client begins authentication:

1. Your browser opens Brian's login/consent flow.
2. Sign in with your Brian account. If public signup is paused, use an existing or invited account.
3. Brian retrieves verified authorization details from Supabase.
4. Review the client name, client website when supplied, and exact return/callback origin.
5. Select the company the connection may access.
6. Review required and optional permissions.
7. Approve or deny the request.
8. The browser returns to the AI client.
9. The client exchanges the authorization code using PKCE and stores its credentials.
10. The next MCP request must resolve to the live company membership and Brian grant.

Do not approve when:

- you do not recognize the client;
- the callback origin is unexpected;
- the wrong company is selected;
- requested permissions exceed the client's purpose;
- Brian reports that new connections are paused;
- the browser asks you to copy a token into a terminal or config file.

Viewers cannot approve an agent connection. Higher-risk action permission is limited by company role and explicit optional consent.

## Using Brian in an AI conversation

Once connected, ask the AI agent to use Brian naturally. Examples:

```text
Before answering, use Brian to find the approved refund procedure and current company context.
```

```text
Check Brian for the hard rules and escalation path for this customer request, then follow them.
```

```text
Use Brian to find our current launch decision and any relevant preferences before drafting the plan.
```

```text
This is a durable process correction. If this connection has permission, capture it in Brian after confirming the wording with me.
```

The connected agent should normally call:

- `find_skill` for the approved procedure;
- `get_skill` when it needs a known skill by ID;
- `find_context` for active goals, decisions, and preferences;
- `log_execution` after a governed task;
- `capture` only when `knowledge:write` was approved;
- business-action tools only when `actions:execute` was approved and the matched skill permits them.

Only granted tools appear in the MCP tool list, and Brian checks permission again on every call.

## Connection lifecycle and revocation

### Access and refresh

The AI client receives a short-lived access token and manages its refresh credential. Brian validates every access token against:

- exact issuer, audience, and Brian resource;
- signature and bounded lifetime;
- token type and required Brian claims;
- current agent connection;
- current user/company membership;
- exact tenant and permissions.

A valid signature alone is not enough.

### Local disconnect

```bash
brian disconnect
```

This removes Brian's local MCP entry and instruction markers. Restart the affected client afterward. Local disconnection does not invalidate a previously issued server grant.

### Immediate server-side revocation

In Brian, open **Settings → Agents & connections** and revoke the exact connection. Brian's live principal resolver blocks its next request even if its access token has not expired.

When the approving user revokes their own connection, Brian also attempts provider-side OAuth grant revocation. An administrator revoking another user's connection may need the supported Supabase/provider procedure to invalidate the refresh family completely.

For a lost device or suspected token compromise, follow [the compromised connection runbook](docs/runbooks/compromised-agent-connection.md).

### Reconnecting

After revocation:

1. Clear/logout the client-owned Brian OAuth session using the client's supported UI or command.
2. Ensure the old Brian connection remains revoked.
3. Start **Connect** again.
4. Review the new callback, company, and permissions.
5. Verify a harmless Brian lookup.

Do not reuse or copy an old access/refresh token.

## Administrator guide

### Known-client automation versus universal MCP

Do not create a Brian-specific server adapter for every customer agent. Prefer this order:

1. Ask the vendor whether its agent supports remote Streamable HTTP MCP and OAuth discovery.
2. Configure Brian's canonical MCP URL.
3. Test the standard discovery and DCR path.
4. If DCR is unavailable but OAuth is otherwise compatible, pre-register an exact public client and callback set.
5. Build an adapter only when the vendor lacks a required standard capability and the business need justifies maintaining it.

The CLI's list of four names is an automation boundary, not Brian's protocol boundary.

### Production release controls

Brian has separate controls for separate risks:

- `MCP_OAUTH_APPROVALS_ENABLED`: allows preparation/approval of new agent grants. Turning it off pauses new approvals while existing safe tokens can continue validation.
- `MCP_DCR_ENABLED`: publishes Brian's application-visible DCR release state.
- Supabase's DCR setting: the authoritative boundary that actually allows or blocks new dynamic OAuth registrations.
- `MCP_OAUTH_ENABLED`: hard stop for existing OAuth MCP credentials; use only when continuing OAuth validation is unsafe.
- `PUBLIC_SIGNUP_ENABLED`: independent public-account provisioning boundary.

Keep application markers aligned with the Supabase enforcement setting. `doctor` reports marker drift.

### DCR registry hygiene

- Run the scheduled/read-only registry audit and monitor aggregate registration volume.
- Keep privileged maintenance credentials scoped to the maintenance step only.
- Do not log registration responses, callbacks, raw client IDs, or credentials.
- Treat more than 2× the trailing seven-day same-hour registration baseline as a warning.
- Stop the release when registrations exceed 5× baseline or reach 100 in 10 minutes.
- Contain abuse by disabling DCR in Supabase first, setting Brian's DCR marker false, leaving safe existing OAuth validation enabled, keeping public signup off, and running a read-only audit.
- Do not use cleanup as the first containment mechanism.

See [the OAuth outage runbook](docs/runbooks/oauth-outage.md) and [monitoring runbook](docs/runbooks/monitoring-alerts.md).

### Compatibility acceptance for a new enterprise agent

Record one dated row covering:

| Check | Required proof |
|---|---|
| Transport | Successful remote MCP initialization against the branded resource. |
| Challenge | Client follows Brian's `401` and `resource_metadata`. |
| Discovery | Both Brian and authorization-server metadata are valid. |
| Registration | DCR succeeds, or exact pre-registration is documented. |
| PKCE | S256 challenge and verifier are used. |
| Resource | Exact canonical resource is sent where required. |
| Consent | Browser shows the real client, callback, company, and permissions. |
| Token | Authenticated harmless MCP call succeeds with the correct grant. |
| Refresh | Connection survives access-token expiry using supported rotation. |
| Revocation | The next request is blocked and fresh authorization is required. |
| Storage | Credential location/protection is documented without exposing values. |

Never capture live Authorization headers, OAuth codes, state values, PKCE verifiers, access tokens, or refresh tokens as test evidence.

### Public signup

Public signup is separate from MCP compatibility. Keep it disabled until spam controls, email limits, monitoring, legal pages, and provisioning evidence are ready. Companies can use existing or invited accounts while universal MCP client support is tested.

## Security model

### What the CLI writes

- The canonical Brian MCP URL.
- The configuration shape required by the known client.
- For Codex and Cursor, a bounded Brian instruction block in `AGENTS.md`.
- A categorical local health file after `doctor`.

### What the CLI never writes

- A static bearer token.
- An Authorization header.
- Supabase access or refresh credentials.
- Passwords, OAuth codes, PKCE values, or callback query strings.

### Configuration safety

Existing files receive a sibling backup:

```text
<file>.bak-brian-<YYYYMMDD-HHmmss-SSS>
```

Backups use private `0600` permissions. When migrating a legacy static credential, the old value may remain only in that backup until OAuth is proven. Delete it according to the organization's credential-retention policy after the old credential is revoked.

The CLI refuses:

- malformed JSON or TOML;
- scalar/non-object JSON;
- duplicate Brian entries or duplicate relevant TOML sections;
- symlinks;
- non-writable files.

It preserves unrelated settings and performs all selected-client preflight checks before the first write.

For the complete credential model, see [token and secret handling](docs/security/token-handling.md) and [MCP authentication architecture](docs/architecture/mcp-auth.md).

## Troubleshooting

### `npm` returns 404

The package is not yet published or the requested version does not exist. From the repository root, use:

```bash
node packages/cli/src/index.mjs --version
node packages/cli/src/index.mjs connect
```

### No clients detected

The CLI exits with code `3`. Install/start a known client, or limit detection to the correct name:

```bash
brian status --only codex
```

For an unknown enterprise agent, detection is not required. Configure the canonical URL manually in that agent's MCP settings.

### `doctor` says approvals are paused

Local configuration may be correct, but Brian is not accepting new production approvals. Do not bypass the pause with a static token. An administrator must verify the deployment, DCR state, monitoring, and release controls before enabling approvals.

### `doctor` reports DCR marker drift

The Supabase provider advertisement and Brian's application marker disagree. Stop new rollout work and align the authoritative Supabase DCR setting with the Brian marker. Follow the OAuth outage runbook.

### Native login command is unavailable

- Codex: install or upgrade Codex, then retry `codex mcp login brian`.
- Claude Code: upgrade to a version that exposes `claude mcp login`, or use Claude's MCP settings.
- Cursor/Claude Desktop: restart and use the connection UI.
- Custom client: confirm the vendor supports remote MCP OAuth/DCR or exact pre-registration.

### Browser did not open

Run the native login again or open the URL printed by the client. Under SSH, use the client's documented headless flow. Do not copy token values between machines.

### The callback or client identity looks wrong

Deny the request. Return to the intended client, update/verify it, and start again. Administrators should investigate malicious or unexpected client metadata.

### Configuration is malformed, duplicated, a symlink, or read-only

The CLI blocks all planned writes. Repair the file manually or restore a known-good copy, then use:

```bash
brian connect --dry-run
```

Do not use force flags or replace unrelated configuration.

### A legacy raw Supabase URL or static credential is detected

1. Run `brian status` or `brian doctor`; values remain redacted.
2. Run `brian connect` and review the canonical URL-only replacement.
3. Complete browser OAuth immediately.
4. Verify a tenant-scoped harmless Brian call.
5. Revoke the old server-side legacy credential.
6. Remove backups containing the old bearer according to policy.

Never place a bearer in JSON, TOML, `.env`, `AGENTS.md`, a shell command, a ticket, or chat.

### Configuration exists but the agent cannot use Brian

Check in this order:

1. Restart the client if required.
2. Run `brian status`.
3. Run `brian doctor`.
4. Start the client-native Brian login/Connect flow.
5. Confirm the browser approval completed for the correct company.
6. Verify the connection is active in **Settings → Agents & connections**.
7. Check the dated compatibility matrix for that exact client/version.
8. Test with a protocol-control client before declaring Brian or the vendor incompatible.

### `disconnect` did not immediately block the old client

Expected: `disconnect` changes only local files. Revoke the server-side connection in Brian, then clear/logout the client's OAuth session.

## Common workflows

### Preview before touching files

```bash
brian connect --dry-run
```

### Connect only Codex

```bash
brian connect --only codex
codex mcp login brian
```

### Install configuration now and authenticate later

```bash
brian connect --no-login
```

Then use the appropriate native command or client UI.

### Configure known clients in automation

```bash
brian connect --only cursor,codex --yes --json
```

Automation writes configuration only; JSON/non-interactive mode does not open login.

### Check readiness without credentials

```bash
brian doctor --json
```

### Connect an unknown enterprise agent

1. Open the agent's remote MCP settings.
2. Add a server named `brian`.
3. Set the URL to `https://api.brianthebrain.app/mcp`.
4. Leave token/header fields empty.
5. Choose Connect.
6. Complete browser consent.
7. Run a harmless knowledge lookup.
8. Record refresh and revocation evidence before production approval.

### Fully remove and revoke a connection

```bash
brian disconnect --only codex
```

Then:

1. Revoke the connection in Brian's dashboard.
2. Logout/clear Brian through the client's supported OAuth controls.
3. Restart the client.
4. Confirm `brian status` reports the local entry missing.

## Current limitations

- `@brianthebrain/cli@0.1.0` is implemented but not claimed as published until npm verification succeeds.
- The CLI automatically configures four known client formats; other agents require manual URL configuration.
- Manual configuration is not a compatibility guarantee. The client still needs remote MCP and compatible OAuth behavior.
- Client menus and login commands prove only that a feature is exposed, not that refresh and revocation work end to end.
- Windows support remains preview pending CI evidence.
- Public signup can remain disabled independently of MCP access.
- No OAuth compatibility bridge ships in v1. Products missing MCP/OAuth support need a standards-compliant adapter or upgrade; static credentials are not the fallback.
- Check [the dated compatibility matrix](docs/mcp-client-compatibility.md) for the exact currently verified evidence.

## Quick-reference table

| Goal | After npm publication | From the repository today |
|---|---|---|
| Show help | `brian --help` | `node packages/cli/src/index.mjs --help` |
| Open signup | `brian signup` | `node packages/cli/src/index.mjs signup` |
| Preview connection | `brian connect --dry-run` | `node packages/cli/src/index.mjs connect --dry-run` |
| Connect known clients | `brian connect` | `node packages/cli/src/index.mjs connect` |
| Connect only Codex | `brian connect --only codex` | `node packages/cli/src/index.mjs connect --only codex` |
| Configure without login | `brian connect --no-login` | `node packages/cli/src/index.mjs connect --no-login` |
| Inspect local state | `brian status` | `node packages/cli/src/index.mjs status` |
| Diagnose readiness | `brian doctor` | `node packages/cli/src/index.mjs doctor` |
| Remove local config | `brian disconnect` | `node packages/cli/src/index.mjs disconnect` |
| Machine-readable connect | `brian connect --yes --json` | `node packages/cli/src/index.mjs connect --yes --json` |
| Connect a custom agent | Set its MCP URL to the canonical URL | Same |
| Immediately block an agent | Revoke it in Brian's dashboard | Same |

## Further documentation

- [CLI technical reference](docs/cli.md)
- [MCP OAuth connection contract](docs/mcp-oauth.md)
- [MCP client compatibility evidence](docs/mcp-client-compatibility.md)
- [Agent contract](docs/agent-contract.md)
- [MCP authentication architecture](docs/architecture/mcp-auth.md)
- [Token and secret handling](docs/security/token-handling.md)
- [OAuth outage runbook](docs/runbooks/oauth-outage.md)
- [Compromised connection runbook](docs/runbooks/compromised-agent-connection.md)
- [Monitoring and alerts](docs/runbooks/monitoring-alerts.md)
- [Legacy token retirement](docs/runbooks/legacy-token-retirement.md)
