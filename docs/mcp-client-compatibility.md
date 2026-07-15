# MCP client OAuth compatibility

> Inspection date: 2026-07-15
> Protocol target: MCP 2025-11-25
> Status: Codex DCR, browser consent, authenticated MCP use, stored-session reuse, and immediate Brian-side revocation are verified against production. Refresh-token rotation and the other client families remain unverified.

This matrix is deliberately evidence-labeled. A CLI flag or menu item proves that a client exposes a feature; it does not prove interoperability with Supabase, RFC 9728 discovery, DCR, refresh rotation, or revocation.

The canonical domain was rechecked without credentials on 2026-07-14 after deploying Edge Function `brian` version 8 (build marker `207b223821555ba5`). The earlier release smoke passed both RFC 9728 metadata locations, Supabase authorization-server discovery, PKCE S256 advertisement, the authorization route, and the `/mcp` `401` Bearer challenge. Dynamic Client Registration was enabled in Supabase on 2026-07-14 after the repository gained count-only registry audit, fail-closed stale cleanup, alert thresholds, and a documented kill switch. On 2026-07-15, Edge version 13 and the guarded production flags supported a real Codex connection through DCR and browser consent.

A pre-deployment review on 2026-07-14 blocked release until the controlled
probe stopped deriving a privileged Admin destination from discovery, cleanup
failures produced nonzero workflow status, lifecycle evidence was rechecked per
client, marker drift was computed, workflow secrets were step-scoped, and the
runtime flags matched the documented database controls. Those corrections are
implemented and locally tested on the guarded rollout branch. Migration 016 and
the guarded Edge runtime are deployed; maintenance-authority provisioning and
the disposable registry-cleanup probe remain separate operational gates.

## Dated OAuth evidence ledger

These fields are independent. A later field never backfills an earlier one, and
an advertised command or endpoint is not authentication proof.

| Date | Surface | Advertised | Registered | Authenticated | Refreshed | Revoked |
|---|---|---|---|---|---|---|
| 2026-07-15 | Codex production E2E | Passed: RFC 9728 discovery and authorization metadata followed | Passed: Codex dynamically registered an OAuth client | Passed: browser consent completed; a fresh Codex process initialized MCP and called `find_skill` for tenant `sokoon` using the stored OAuth session | Not run: access-token expiry/refresh rotation was not forced | Passed: after the active Brian connection was revoked, a fresh process was rejected with `invalid_token` before MCP initialization |
| 2026-07-14 | Production authorization server | Passed: valid DCR `registration_endpoint` appeared after Supabase DCR enablement | Not run: controlled probe requires an available `SUPABASE_SECRET_KEY` so deletion is guaranteed | Not run | Not run | Not run |
| 2026-07-14 | Brian public release markers | Pending deployment: current production Edge bundle predates `mcpOAuth`, `mcpOAuthApprovals`, and `mcpDcr` markers | Not applicable | Not run | Not run | Not run |
| 2026-07-14 | Codex 0.144.2 | Passed: URL-only client follows Brian discovery and attempts DCR | Not rerun after enablement | Not run | Not run | Not run |
| 2026-07-14 | Claude Code 2.1.198 | Passed locally: exact native login command surface exists | Not run | Not run | Not run | Not run |

No row is `proven` beyond the exact dated field shown. The disposable DCR probe
will add `registered` evidence only when it verifies the new ID through the
Supabase OAuth Admin SDK and deletes it in `finally`.

On 2026-07-14, a second credential-free production smoke passed and an isolated
Codex 0.144.2 login reproduced the remaining boundary exactly:
`Dynamic client registration not supported`. A loopback control server then
proved that Codex can bypass DCR with a pre-registered public client ID. With
`mcp_oauth_callback_port = 1455`, this version uses the stable exact redirect
`http://127.0.0.1:1455/callback/YL4-rwMAP0YR`, requests `email`, sends PKCE S256,
and includes the configured OAuth resource. The last pre-enablement read-only
check found no rows in `auth.oauth_clients` and no Brian `agent_connections`,
so no browser consent or authenticated MCP request had occurred at that point.
DCR is now proven for the real Codex client in the 2026-07-15 row above. The
separate disposable registry probe remains pending because it must prove Admin
API cleanup even after ambiguous registration responses.

| Client | Version inspected | Remote HTTP / OAuth evidence | Brian configuration | E2E status |
|---|---|---|---|---|
| Claude Code | 2.1.198 | `claude mcp` exposes HTTP add, login/logout, client ID, callback port, and headless `--no-browser` | CLI writes canonical URL-only HTTP entry; finish with `claude mcp login brian` | Public discovery passed; authenticated run pending |
| Codex CLI | 0.144.2 (production E2E rerun 2026-07-15) | `codex mcp` exposes Streamable HTTP, DCR, explicit OAuth resource, and login/logout | CLI writes `url` and exact `oauth_resource`; the project adapter now refuses a conflicting local stdio Brian entry | Production DCR, consent, authenticated `find_skill`, stored-session reuse, and Brian-side revocation passed; forced refresh rotation pending |
| Claude Desktop | Not installed/inspected in this workspace | Configuration adapter exists; OAuth behavior is version-dependent | CLI writes canonical URL-only `mcpServers.brian`; restart and use client connection UI | Not run |
| Cursor | CLI not installed/inspected in this workspace | Configuration adapter exists; OAuth behavior is version-dependent | CLI writes canonical URL-only `mcpServers.brian`; restart and use client connection UI | Not run |
| MCP Inspector / official SDK client | Not inspected | Required as a protocol-control client | Manual staging setup | Not run |

## Local command evidence

Claude Code 2.1.198 reports:

```bash
claude mcp add --transport http --scope user brian https://api.brianthebrain.app/mcp
claude mcp login brian
claude mcp login --no-browser brian
claude mcp logout brian
```

Codex CLI 0.144.2 reports:

```bash
codex mcp add brian \
  --url https://api.brianthebrain.app/mcp \
  --oauth-resource https://api.brianthebrain.app/mcp
codex mcp login brian
codex mcp logout brian
```

For the dated pre-registration proof only, Codex additionally needs:

```toml
mcp_oauth_callback_port = 1455

[mcp_servers.brian.oauth]
client_id = "<public Supabase OAuth client ID>"
```

Register this exact public-client redirect in Supabase for Codex 0.144.2:

```text
http://127.0.0.1:1455/callback/YL4-rwMAP0YR
```

Treat the callback suffix as version-specific evidence: re-run the isolated
registration probe before reusing it for another Codex release.

The public Brian CLI produces equivalent URL-only configuration and never adds a bearer-token environment variable or header.

## Required staging run

For each launch client, record a dated result for every row below:

| Check | Required evidence |
|---|---|
| Transport | Successful Streamable HTTP `initialize` against the branded resource |
| Challenge | Parses the `401` Bearer challenge and follows `resource_metadata` |
| Discovery | Fetches RFC 9728 metadata and Supabase authorization-server metadata |
| Registration | DCR succeeds, or a pre-registered client and exact callback are documented |
| PKCE | Sends S256 and a verifier at token exchange |
| Resource | Sends the exact canonical `resource` in both authorization and token requests |
| Consent | Browser identifies the real client, redirect origin, company, and permissions |
| Token | Short-lived token has exact audience and all Brian claims |
| Refresh | Reconnects after access-token expiry using a rotating refresh token |
| Revocation | Brian blocks the next request and the client starts a fresh authorization flow |
| Storage | Credential location and OS protection are documented without exposing values |

Capture HTTP traces only in an isolated environment with headers and query secrets redacted. Never record authorization codes, state, PKCE verifiers, access tokens, or refresh tokens.

## Known open platform questions

Supabase's current documentation confirms authorization code + PKCE, DCR, consent APIs, refresh rotation, and custom access-token hooks. The documentation does not yet provide enough evidence to close Brian's exact RFC 8707 `resource` propagation requirement, custom-scope behavior, or every launch client's DCR callback shape. Those remain GA-blocking staging tests.

No OAuth compatibility bridge ships in v1. If a launch client fails the matrix, document a supported client/version or pre-registration path first. Build a local PKCE/Keychain bridge only for a demonstrated product need; never replace it with static credentials in public configuration.
