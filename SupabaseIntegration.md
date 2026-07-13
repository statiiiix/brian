# Supabase integration — implemented multi-tenant and OAuth architecture

> Updated: 2026-07-13
> Status: migrations and application code are implemented locally. Migrations 010-014, OAuth provider configuration, branded-domain routing, and the non-owner production runtime still require staging and production deployment.

## 1. Architecture

Brian uses one Supabase/Postgres project with shared tenant-owned tables. Every owned row has `tenant_id`; every repository query has an explicit tenant predicate; RLS uses transaction-local `app.tenant_id` as a backstop. Enterprise dedicated projects remain possible later because the same migrations are replayable.

The browser talks directly to Supabase only for Auth/OAuth session lifecycle. All company data goes through Brian's Hono API. Supabase authenticates humans and runs the OAuth 2.1 authorization server; Brian remains authoritative for tenants, memberships, roles, agent grants, permissions, and revocation.

## 2. Migration history

| Migration | Purpose |
|---|---|
| 005 | Tenants, legacy hashed API tokens, `tenant_id` backfill |
| 006-009 | Tenant-owned connectors/evidence, RLS backstop, owner-only config, connector OAuth state |
| 010 | Memberships, invitations, agent connections, audit events, onboarding, ownership/permission constraints, RLS/grants |
| 011 | Supabase Auth provisioning trigger, trusted founder backfill, public-signup gate, identity report |
| 012 | Narrow principal/invitation resolvers and custom MCP access-token hook |
| 013 | Legacy-token expiry/usage tracking, narrow resolution, migration report, retirement controls |
| 014 | Account/company deletion lifecycle, creator attribution, immediate revocation, retention support |

Migrations are convergent and schema-aware: tests substitute a schema-local Auth users table; production binds the trigger to `auth.users`. A session advisory lock serializes the complete ordered replay so concurrent deploys cannot interleave files.

## 3. Human identity and company provisioning

Dashboard tokens must have the exact Supabase issuer, expected `authenticated` audience, no OAuth `client_id`, and no Brian MCP token type. Brian refetches `/auth/v1/user`, then resolves an active default `tenant_memberships` row. A valid identity with no membership fails `403`; it never falls back to the founding tenant.

Self-signup is disabled by default in `app_config`. When enabled, the Auth trigger accepts only printable `company_name` user metadata, creates a collision-safe tenant, owner membership, onboarding state, and audit event. User-provided tenant/role/admin metadata is ignored. Trusted backfills use server-controlled `raw_app_meta_data` only.

Invitations contain a random token but store only its hash. Before Auth signup, a rate-limited boolean-only preflight binds the token to the submitted email without returning tenant or role data. Tenant, role, expiry, revocation, and single-use status still come exclusively from the database row. Invalid invitation possession raises an error instead of silently creating a new company.

## 4. MCP OAuth

The stable protected resource is `https://api.brianthebrain.app/mcp`. Both RFC 9728 metadata locations and the unauthenticated Bearer challenge point clients to Supabase's authorization server. Clients use authorization code + PKCE and must bind the exact resource in authorization and token exchange.

Brian's consent screen refetches verified client details from Supabase, selects an active membership, explains permissions, and prepares a short-lived pending `agent_connections` grant. Supabase's custom access-token hook activates an unambiguous grant and writes exact tenant, role, permission, connection, audience/resource, and MCP token-type claims.

The resource server verifies an ES256/RS256 JWKS signature and exact token contract, then calls `resolve_mcp_principal`. Claims must exactly equal the current active grant/membership. This live lookup makes revocation or suspension immediate.

Supabase currently documents standard identity scopes; Brian advertises `email`. Brian capabilities are stored and enforced separately (`skills:read`, `context:read`, `knowledge:write`, `executions:write`, `actions:execute`).

Detailed protocol behavior is in [docs/mcp-oauth.md](docs/mcp-oauth.md), and the rationale is in [docs/architecture/mcp-auth.md](docs/architecture/mcp-auth.md).

## 5. Database enforcement

The application must connect as `brian_app`, which is not a table owner and has no `BYPASSRLS`. Migration execution remains an owner operation. `db()` runs tenant-owned work in a transaction and applies:

```sql
set local app.user_id = '<verified subject>';
set local app.tenant_id = '<resolved tenant>';
```

Only fixed-search-path security-definer functions can look up identity before tenant binding. They validate `app.user_id` and are executable only by their intended runtime role. Broad `using (true)` pre-tenant policies are removed.

Running the Edge/API as `postgres` or a service/table-owner role bypasses RLS and blocks release, even though explicit predicates remain.

## 6. Runtime configuration

Frontend:

```text
REACT_APP_SUPABASE_URL
REACT_APP_SUPABASE_PUBLISHABLE_KEY (or legacy REACT_APP_SUPABASE_ANON_KEY)
REACT_APP_TURNSTILE_SITE_KEY
REACT_APP_BRIAN_MCP_URL=https://api.brianthebrain.app/mcp
REACT_APP_SITE_URL=https://brianthebrain.app
```

API/Edge:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_DB_URL or DATABASE_URL   # must authenticate as brian_app in production
BRIAN_APP_URL=https://brianthebrain.app
BRIAN_ALLOWED_RETURN_ORIGINS      # comma-separated additional trusted origins
MCP_OAUTH_ENABLED=true
MCP_OAUTH_APPROVALS_ENABLED=false # fail closed until the staging OAuth flow passes
MCP_DCR_ENABLED=false             # marker only; Supabase is the enforcement boundary
CLI_OAUTH_BRIDGE_ENABLED=false    # v1 CLI ships no credential bridge
LEGACY_AGENT_TOKENS_ENABLED=true  # migration only
PUBLIC_SIGNUP_ENABLED=false       # UI/API marker; DB app_config gate also stays false
SIGNUP_PREFLIGHT_RATE_LIMIT_ENABLED=true
BRIAN_DELETION_GRACE_DAYS=30
SECURITY_AUDIT_RETENTION_DAYS=365
EXECUTION_LOG_RETENTION_DAYS=180
```

Supabase dashboard configuration:

1. enable OAuth 2.1 in staging;
2. use an asymmetric ES256/RS256 signing key;
3. set the Site URL and exact browser callback allowlist;
4. configure `/oauth/consent` as the authorization path;
5. select `public.custom_access_token_hook`;
6. enable/configure Turnstile and Auth rate limits;
7. control/monitor DCR and unused client registrations;
8. verify RFC 8707 resource propagation, refresh rotation, revocation, and hook timing before production.

## 7. Deployment sequence

1. Back up staging and apply 010-014 as owner using a direct or session-pooler migration URL. The replay holds a PostgreSQL session advisory lock and must not run through a transaction-mode pooler.
2. Confirm grants to `brian_app` and `supabase_auth_admin`; query the owner-only `identity_membership_report`.
3. Configure OAuth/asymmetric signing/hook without enabling public signup.
4. Deploy the API/Edge bundle with the non-owner database credential and branded proxy.
5. Run the full database/security suite and two-tenant live isolation test.
6. Complete the dated client compatibility matrix, including expiry/refresh and revocation.
7. Configure reviewed legal pages, CAPTCHA, gateway/provider rate limits, monitoring/alerts, scheduled privacy maintenance, and runbook ownership.
8. Set `MCP_OAUTH_APPROVALS_ENABLED=true` only after the staging consent/token smoke passes.
9. Enable the database `PUBLIC_SIGNUP_ENABLED` value, then the visible product rollout.
10. Migrate existing static-token clients, measure last use, and set `LEGACY_AGENT_TOKENS_ENABLED=false` after the rollback window.

## 8. Current external facts and gates

As checked on 2026-07-13, the live Supabase migration list ends at 009, OAuth discovery reports `feature_disabled`, and the canonical branded API routes return Vercel `DEPLOYMENT_NOT_FOUND`. The deployed Edge artifact predates this working tree. Do not assume 010-014, the custom hook, privacy lifecycle, or current bundle are live merely because they are in Git. The CLI is tarball-tested on the configured CI matrix but is not published. No launch client has completed a real staging OAuth flow in this milestone.

These are deployment/release gates, not reasons to weaken the code. See [docs/security/tenant-isolation.md](docs/security/tenant-isolation.md) and [Nextstep.md](Nextstep.md) for the current checklist.
