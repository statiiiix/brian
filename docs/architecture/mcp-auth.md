# ADR: Supabase OAuth for Brian's hosted MCP

> Date: 2026-07-12
> Status: Accepted and implemented in this repository; production rollout validation is still required.

## Context

Brian serves many companies from one hosted MCP resource. A browser login proves a human identity, but it must not silently authorize an AI client, choose a company, or grant agent capabilities. Static bearer tokens also cannot provide the browser consent, short-lived credentials, refresh rotation, or per-client revocation expected by current MCP clients.

## Decision

Brian uses four deliberately separate responsibilities:

1. Supabase Auth authenticates humans and provides the OAuth 2.1 authorization server, authorization-code flow, PKCE, consent SDK, access tokens, rotating refresh tokens, discovery, and dynamic client registration.
2. Brian Postgres owns tenants, memberships, roles, agent grants, permissions, revocation, onboarding, and audit events.
3. `https://api.brianthebrain.app/mcp` is the single protected resource. It validates every OAuth token and re-resolves the current server-side grant and membership before binding a tenant.
4. `@brianthebrain/cli` installs the canonical URL only. OAuth credentials remain in the MCP client, never in Brian configuration files.

The implementation follows the stable [MCP 2025-11-25 authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), RFC 9728 protected-resource metadata, RFC 8707 resource indicators, and Supabase's [OAuth server](https://supabase.com/docs/guides/auth/oauth-server) and [custom access-token hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook).

## Credential boundaries

| Credential | Accepted by Brian | Tenant source |
|---|---|---|
| Supabase dashboard token | Human `/api/*` routes only | Current active `tenant_memberships` row |
| Supabase MCP OAuth token | `/mcp` and agent-only routes only | Exact signed claims plus a current `agent_connections` and membership lookup |
| Legacy Brian token | `/mcp` and agent-only routes while the migration flag is enabled | Narrow hashed-token resolver |
| Connector credential | Connector adapter only | Server-side tenant-owned connector row |

Dashboard and MCP credentials are intentionally non-interchangeable. Brian never forwards its bearer tokens to Google, Slack, or another downstream service.

## OAuth token contract

The custom access-token hook adds Brian-controlled claims only when an unambiguous pending or active grant exists for the OAuth `client_id` and user:

```json
{
  "aud": "https://api.brianthebrain.app/mcp",
  "tenant_id": "<uuid>",
  "brian_role": "owner|admin|expert|viewer",
  "brian_permissions": ["skills:read", "context:read", "executions:write"],
  "brian_connection_id": "<uuid>",
  "brian_resource": "https://api.brianthebrain.app/mcp",
  "brian_token_type": "mcp"
}
```

The resource server verifies an asymmetric Supabase signature, exact issuer, expiry and issued-at times, a maximum one-hour declared lifetime, exact string audience, subject, OAuth client, Brian resource/type, tenant, connection, role, and permissions. It then requires the database resolver to return the same active values. Revocation, tenant suspension, or membership suspension therefore blocks the next request even while a JWT remains cryptographically valid.

## Capability model

Supabase currently documents standard identity scopes, while custom OAuth scopes remain an open platform capability. Brian advertises only `email`. Agent capabilities live in `agent_connections.permissions`, appear as custom claims, and are enforced both when tools are listed and again when a tool is called:

- `skills:read`
- `context:read`
- `knowledge:write`
- `executions:write`
- `actions:execute`

The default grant is `skills:read`, `context:read`, and `executions:write`. Permission expansion requires new consent; an existing grant can only be renamed, reduced, denied, or revoked.

## Tenant and consent rules

- Tenant selection comes only from an active membership selected on the consent screen and revalidated by the server.
- Client details are fetched again from Supabase by the backend; browser-supplied names, URIs, and client IDs are ignored for authority.
- Redirects must be HTTPS, except loopback HTTP callbacks. Brian redirects only to the URL returned by the Supabase SDK.
- One open grant per user and OAuth client is allowed in v1. This prevents an ambiguous custom-hook decision when one client is connected to multiple companies.
- Viewers cannot approve connections. Experts cannot grant `actions:execute`. Owners/admins can manage all tenant connections; experts manage only their own.

## Consequences

This keeps Brian out of OAuth cryptography and refresh-token storage, gives each client an explicit revocable grant, and makes tenant isolation independent of client behavior. It also makes Supabase OAuth availability, asymmetric signing keys, the custom hook, and RFC 8707 behavior production dependencies.

## Production gates

Code and isolated-schema tests are complete. General availability still requires all of the following external work:

- apply the complete current migration set through 016 to staging, then production;
- connect the runtime as the non-owner `brian_app` role so RLS is an effective backstop;
- enable Supabase OAuth, configure the Brian consent path, asymmetric signing, custom hook, redirect allowlists, and abuse controls;
- prove `resource` propagation, refresh rotation, DCR, revocation, and the access-token hook against staging;
- attach the branded API domain/proxy and verify streaming/header preservation;
- run the dated client compatibility matrix and a real cross-tenant OAuth smoke;
- publish legal pages, configure CAPTCHA/rate limits, metrics, alerts, and incident ownership.

If Supabase cannot meet the Phase 0 protocol tests, Brian will use a maintained authorization server or MCP auth gateway. It will not weaken audience, grant, membership, or tenant validation.
