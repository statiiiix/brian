# Token and secret handling

Brian treats each credential according to its issuer and holder. Credentials are never interchangeable and are never used as tenant selectors without a current server-side lookup.

## Credential inventory

| Credential | Holder/storage | Allowed destination | Revocation |
|---|---|---|---|
| Supabase dashboard access/refresh session | Browser, managed by `supabase-js` | Supabase Auth and Brian human API | Supabase sign-out/session controls |
| MCP OAuth access token | MCP client credential store | Brian `/mcp` and agent-only routes | Brian grant blocks immediately; expiry/provider revocation ends token family |
| MCP OAuth refresh token | MCP client credential store | Supabase token endpoint only | Supabase OAuth grant revocation |
| Legacy Brian bearer | Existing client configuration during migration | Brian MCP/agent routes only | Revoke hashed `api_tokens` row and retire flag |
| Connector credential | Tenant-owned server-side connector record | Its specific provider adapter | Provider revoke plus connector disable/delete |
| Invitation token | Delivered link; hash in database; never Auth metadata | Brian invitation-accept endpoint | Single use, expiry, or row revocation |

The public CLI writes only `https://api.brianthebrain.app/mcp`. It rejects `--token` and never handles OAuth credentials. Local configuration backups created during a legacy migration can still contain the old bearer; treat them as secrets and delete them after successful OAuth reconnection.

## Browser rules

- Use the shared Supabase PKCE client with automatic refresh and persistent session management.
- The old server-side password proxy is disabled by default. Do not reenable `LEGACY_PASSWORD_LOGIN_ENABLED` for public signup; active migration sessions can be handled separately.
- Never create a separate `brian_token` localStorage value.
- Restrict `returnTo` to Brian-relative paths. Remove one-time auth codes from browser history immediately.
- Never place access tokens, refresh tokens, invitation hashes, PKCE verifiers, or OAuth state in analytics events.
- Terms/privacy pages open separately, but public signup remains disabled until real policies exist.

## Server rules

- Bearers are accepted only from an exact `Authorization: Bearer` header and have a bounded length.
- Dashboard tokens are verified by claims and a live Supabase `/user` lookup.
- MCP tokens are verified locally against the asymmetric JWKS and exact issuer/audience/resource, then checked against the current database grant and membership.
- MCP access tokens with a declared lifetime over one hour are rejected as not short-lived.
- Array/multiple audiences are rejected. `brian_token_type=mcp` and the exact `brian_resource` are mandatory.
- Legacy bearer plaintext is never stored; only SHA-256 hashes are queried through a narrow resolver. The resolver rejects revoked or expired rows and advances per-token `last_used_at` at most once every five minutes.
- Existing legacy rows may retain a null expiry during migration. Every new code-issued legacy token requires an explicit future expiry; the null-expiry bootstrap is reserved for the pre-existing founding environment token.
- Connector credentials never enter MCP results, API responses, audit metadata, or downstream calls for another provider.
- No token passthrough is allowed. A Brian token is not a Google/Slack credential.

## Redaction

Logs and audit metadata may include request ID, route class, tenant/connection ID after successful resolution, event category, and latency. They must not include:

- Authorization headers or cookie/session values;
- JWTs, bearer hashes, OAuth codes, refresh tokens, PKCE verifiers, or OAuth state;
- invitation tokens/hashes;
- connector secrets or passwords;
- full callback URLs containing query parameters.

`sanitizeAuditMetadata` recursively redacts sensitive key names before JSON is persisted. Smoke scripts report only pass/fail categories and HTTP status, never response bodies or claims.

HTTP request telemetry is emitted as one JSON object containing only request
ID, normalized path without its query string, route class, status, latency,
and server-resolved tenant/connection identifiers. The logger never reads
request headers or bodies. Alerting and retention for these platform logs must
still be configured in the production observability provider.

## Rotation and compromise

For one compromised agent connection, revoke that Brian connection first; do not rotate every tenant credential unnecessarily. Then revoke the provider-side OAuth grant, clear the client's stored OAuth session, inspect redacted audit activity, and reauthorize as a new grant. Follow [the compromised connection runbook](../runbooks/compromised-agent-connection.md).

For the non-secret inventory query, per-tenant revocation procedure, and dated shutdown gates, follow [legacy agent-token retirement](../runbooks/legacy-token-retirement.md). Never build the inventory by selecting directly from `api_tokens`.

Rotate Supabase signing keys only for key compromise or a planned signing migration. Key rotation needs a JWKS-overlap test because active access tokens rely on public-key availability. Rotate connector provider secrets with their provider-specific procedure.

## Development hygiene

- Keep `.env` and generated credential material untracked.
- Prefer `node --env-file=.env` for local tests; do not print or source secrets into diagnostic output.
- Never place refresh tokens in `AGENTS.md`, MCP JSON/TOML, shell history, test fixtures, snapshots, or issue text.
- Use synthetic tenants and short-lived credentials for staging smoke tests.
- Do not commit npm tarballs or CLI-created config backups.
