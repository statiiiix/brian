# MCP OAuth connection

Brian's hosted MCP resource is exactly:

```text
https://api.brianthebrain.app/mcp
```

Do not configure the raw Supabase Edge Function URL and do not add an Authorization header. A standards-capable MCP client discovers OAuth from the unauthenticated response and stores its own access and refresh credentials.

## Discovery contract

Brian serves both RFC 9728 locations used by current clients:

```text
GET https://api.brianthebrain.app/.well-known/oauth-protected-resource/mcp
GET https://api.brianthebrain.app/.well-known/oauth-protected-resource
```

Both return the exact resource, the Supabase authorization-server issuer, the standard `email` scope, and bearer-header transport. An unauthenticated MCP request returns `401` with:

```text
WWW-Authenticate: Bearer resource_metadata="https://api.brianthebrain.app/.well-known/oauth-protected-resource/mcp", scope="email"
```

The client then discovers the authorization and token endpoints, creates a PKCE S256 challenge, sends the exact `resource` parameter in authorization and token requests, and opens Brian's browser consent flow.

## Browser consent

`/oauth/consent?authorization_id=...` requires a Supabase browser session. Brian obtains verified authorization details through `supabase.auth.oauth.getAuthorizationDetails`, loads the user's active memberships, and displays the client, verified redirect origin, company, and exact Brian capabilities.

Approval prepares a ten-minute pending `agent_connections` row. The backend refetches the authorization request from Supabase, verifies the user and selected membership, sanitizes client display metadata, and allows only HTTPS or loopback HTTP redirect origins. The browser then calls the Supabase approval SDK and follows only its returned redirect. The access-token hook atomically activates the grant while issuing the first token.

Denial marks a prepared grant denied and calls Supabase's denial SDK. Viewers cannot approve. An expert cannot approve `actions:execute`.

## Enforced permissions

| Permission | MCP capability |
|---|---|
| `skills:read` | `find_skill`, `get_skill` |
| `context:read` | `find_context` |
| `knowledge:write` | `capture` |
| `executions:write` | `log_execution` |
| `actions:execute` | business-action adapter tools |

Only granted tools appear in `tools/list`, and every `tools/call` checks again. The server's current grant and membership must exactly match the signed claims on every request.

## Revocation

Settings → Agents & connections lists status, client, approving user, permissions, approval time, and last use. Owners/admins manage all tenant connections; experts manage their own. Permission reductions and renames are allowed in place, but expansion requires new consent. A fresh consent reuses the client's one open connection as a ten-minute pending grant, so existing tokens stop resolving until the access-token hook activates the newly approved permissions; a failed approval denies that pending grant.

Brian-side revocation immediately makes its principal resolver return no row, so the next MCP call fails even if the JWT is unexpired. When the approving user revokes their own connection in the dashboard, the UI also asks Supabase to revoke the OAuth grant so refresh sessions are invalidated. Administrators revoking another user's connection should additionally follow the provider-side incident procedure when full refresh-token invalidation is required.

## Runtime configuration

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<publishable-or-anon-key>
MCP_OAUTH_ENABLED=true
MCP_OAUTH_APPROVALS_ENABLED=false  # set true only after staging authorization passes
MCP_DCR_ENABLED=false              # mirror the Supabase-side DCR release gate
CLI_OAUTH_BRIDGE_ENABLED=false     # v1 ships no compatibility bridge
LEGACY_AGENT_TOKENS_ENABLED=true   # migration only; set false after retirement
MCP_RATE_LIMIT_ENABLED=true
MCP_PREAUTH_RATE_LIMIT_REQUESTS=120
MCP_AUTH_RATE_LIMIT_REQUESTS=600
MCP_RATE_LIMIT_WINDOW_MS=60000
```

`MCP_OAUTH_APPROVALS_ENABLED` is the fail-closed switch for preparing new
agent grants and enabling the consent page's Approve action. Keep
`MCP_OAUTH_ENABLED=true` during a normal approval pause so already-issued
short-lived tokens continue through signature, grant, membership, and tenant
validation. Set `MCP_OAUTH_ENABLED=false` only as the hard stop that rejects
existing OAuth MCP credentials too. Denial remains available while approvals
are paused and records only server-verified, redacted client metadata.
`MCP_DCR_ENABLED` is an application-visible release marker; DCR enforcement
itself remains in Supabase and must stay disabled there until the client matrix
passes. `CLI_OAUTH_BRIDGE_ENABLED` remains false because the public CLI does not
ship a bridge. Setting that marker cannot enable code that is not present.

Dynamic registration is operated through two independent boundaries: the
Supabase OAuth Server DCR setting is authoritative, while
`MCP_DCR_ENABLED` truthfully publishes Brian's current release state. The
hourly registry audit is read-only. Daily cleanup requires protected production
approval plus `--delete-stale --yes`, and deletes only dynamic clients older
than 24 hours after exact schema attestation proves they have no pending/active
Brian connection, unexpired Supabase session/authorization, or protected-ID
match. Maintenance logs are count-only and client IDs appear only as SHA-256
hashes.

If registrations exceed 5× the trailing seven-day same-hour baseline or reach
100 in 10 minutes, disable DCR in Supabase first, set the Brian marker false,
leave existing OAuth validation enabled, keep public signup off, run a
read-only audit, and verify both the public marker and `brian doctor`. The full
sequence is in the [OAuth outage runbook](./runbooks/oauth-outage.md).

Rejected OAuth credentials emit only a bounded reason (`wrong_issuer`,
`wrong_audience`, `expired`, `not_yet_valid`, `signature_or_key`,
`invalid_resource_or_type`, `invalid_lifetime`, `malformed_claims`, or
`principal_resolution`) plus request/path metadata. The bearer value, claims,
headers, body, and query string are never logged. Alert on sustained category
rates rather than sampling credentials. The closed `domain_metric` contract,
authoritative Supabase/database signals, and initial alert thresholds are
defined in the [monitoring and alerts runbook](./runbooks/monitoring-alerts.md).

The Edge runtime applies a fixed-window burst limit by trusted gateway client
address before authentication and by resolved connection (or legacy tenant)
after authentication. Defaults are 120 and 600 requests per minute. This
isolate-local protection is intentionally bounded and must be paired with a
globally coordinated rate limit at the branded production gateway; the gateway
must overwrite `CF-Connecting-IP`, `X-Real-IP`, or `X-Forwarded-For` rather than
trusting a caller-supplied value.

Use an asymmetric Supabase signing key supported by the verifier (`ES256` or `RS256`). Configure the Supabase OAuth authorization path as Brian's `/oauth/consent` route and select `public.custom_access_token_hook` as the custom access-token hook after the identity/OAuth migrations 010-012 are applied. Apply the complete current migration set through 014 before releasing the product.

Brian rejects MCP access tokens whose declared lifetime exceeds one hour, even
when their signature is otherwise valid. Configure Supabase access-token
lifetimes at or below that boundary and verify rotating refresh behavior in
staging.

The canonical resource is not a tenant/deployment choice: metadata, token hook, CLI, and verifier all bind `https://api.brianthebrain.app/mcp`. If a legacy `MCP_RESOURCE` environment variable is present, it must equal that value exactly or OAuth validation fails closed.

Brian intentionally advertises only the standard `email` OAuth scope. Custom Brian permissions are grant data and custom claims until Supabase officially supports custom scopes for this flow.

## Safe smoke checks

Public discovery and challenge (no credential required):

```bash
cd server
npm run smoke:mcp-oauth
```

Authenticated staging check without printing the token or response bodies:

```bash
cd server
MCP_SMOKE_ACCESS_TOKEN='<short-lived synthetic token>' \
npm run smoke:mcp-oauth
```

The authenticated smoke always checks `initialize` and permission-filtered `tools/list`. To verify a harmless tenant-specific skill without exposing its result, also set `MCP_SMOKE_FIND_SKILL_QUERY` and, optionally, `MCP_SMOKE_EXPECT_TEXT`; the script compares in memory and prints only pass/fail.

After revoking the synthetic connection, repeat with `MCP_SMOKE_EXPECT_REVOKED=true`; the script expects `401` or `403`. Use a harmless dedicated tenant. Never paste a production refresh token into a shell command.

## Troubleshooting

- **No browser opens:** run the client's explicit MCP login command or its headless/no-browser option. Confirm both metadata URLs and the `WWW-Authenticate` challenge with `brian doctor`.
- **`invalid_token`:** check asymmetric signing/JWKS reachability, exact issuer and audience, `client_id`, `brian_resource`, `brian_token_type`, connection ID, role, and permissions. Array or multi-audience tokens are rejected intentionally.
- **Approval succeeds but MCP returns 401:** inspect custom-hook execution and confirm the grant was unambiguous and activated. The token must contain every Brian claim.
- **403 after a previously working connection:** check tenant status, membership status, and connection status. These are live server-side checks.
- **Client omits `resource`:** do not relax Brian's exact audience validation. Record the client as incompatible and use a maintained client version or a future audited local bridge.

Production readiness and client-specific results are tracked in [mcp-client-compatibility.md](./mcp-client-compatibility.md).
