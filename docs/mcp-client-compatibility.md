# MCP client OAuth compatibility

> Inspection date: 2026-07-14
> Protocol target: MCP 2025-11-25
> Status: public discovery/challenge verified against production; authenticated end-to-end OAuth has not yet been run.

This matrix is deliberately evidence-labeled. A CLI flag or menu item proves that a client exposes a feature; it does not prove interoperability with Supabase, RFC 9728 discovery, DCR, refresh rotation, or revocation.

The canonical domain was rechecked without credentials on 2026-07-14 after deploying Edge Function `brian` version 8 (build marker `207b223821555ba5`). The release smoke now passes both RFC 9728 metadata locations, Supabase authorization-server discovery, PKCE S256 advertisement, the authorization route, and the `/mcp` `401` Bearer challenge. Authenticated client testing remains gated on a safe registration path and an approved test grant; Dynamic Client Registration stays off until the documented abuse controls and monitoring are ready.

On 2026-07-14, a second credential-free production smoke passed and an isolated
Codex 0.144.2 login reproduced the remaining boundary exactly:
`Dynamic client registration not supported`. A loopback control server then
proved that Codex can bypass DCR with a pre-registered public client ID. With
`mcp_oauth_callback_port = 1455`, this version uses the stable exact redirect
`http://127.0.0.1:1455/callback/YL4-rwMAP0YR`, requests `email`, sends PKCE S256,
and includes the configured OAuth resource. Production currently has no rows in
`auth.oauth_clients` and no Brian `agent_connections`, so no browser consent or
authenticated MCP request could occur yet. This makes a manually registered
Codex public client the lowest-risk first proof; it does not require enabling
open DCR.

| Client | Version inspected | Remote HTTP / OAuth evidence | Brian configuration | E2E status |
|---|---|---|---|---|
| Claude Code | 2.1.198 | `claude mcp` exposes HTTP add, login/logout, client ID, callback port, and headless `--no-browser` | CLI writes canonical URL-only HTTP entry; finish with `claude mcp login brian` | Public discovery passed; authenticated run pending |
| Codex CLI | 0.144.2 | `codex mcp` exposes Streamable HTTP, a pre-registered OAuth client ID, explicit OAuth resource, login/logout, and a fixed callback port | CLI writes `url` and exact `oauth_resource`; a pre-registered test also needs the public client ID and fixed callback configuration | Discovery and pre-registration control path passed; production browser consent/authenticated run pending |
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
