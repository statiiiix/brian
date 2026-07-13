# Public signup, MCP OAuth connection, and Brian CLI — implementation plan

> Date: 2026-07-12
> Status: Implemented in the repository; external staging/production gates remain
> Scope: Public company signup, Supabase-backed tenancy, standards-compliant MCP OAuth, agent connection management, and a public CLI
> Primary outcome: A new user can discover Brian from an MCP-capable agent, create or sign in to a Brian account in the browser, explicitly authorize the agent for one company, return to the agent with a short-lived credential, and safely use only that company's skills and data.

## 1. Executive summary

Build the public connection experience around four separate responsibilities:

1. **Supabase Auth authenticates humans.** It owns signup, email verification, login, password recovery, sessions, OAuth authorization codes, access tokens, refresh-token rotation, PKCE, OAuth discovery, and dynamic client registration.
2. **Brian owns companies and authorization.** Brian owns tenants, memberships, roles, agent connection grants, permissions, revocation, auditing, and onboarding state.
3. **Brian's hosted MCP is the protected resource.** It validates OAuth access tokens, resolves the approved tenant, binds that tenant to the request, enforces permissions, and relies on PostgreSQL RLS as a second isolation layer.
4. **The Brian CLI installs and diagnoses the connection.** It detects local AI clients, writes the hosted MCP URL without embedding long-lived bearer tokens, triggers the standards-based browser authorization flow where supported, and provides a compatibility bridge only for clients that cannot perform remote MCP OAuth themselves.

The target experience is:

```text
User chooses "Connect Brian" in an MCP client
  -> client calls https://api.brianthebrain.app/mcp without a token
  -> Brian returns 401 + OAuth protected-resource metadata
  -> client discovers Supabase OAuth 2.1 endpoints
  -> client uses PKCE and opens the browser
  -> user signs up or logs in to Brian
  -> Brian shows the requesting client, company, and permissions
  -> user approves
  -> Supabase returns an authorization code to the client
  -> client exchanges it for short-lived access + rotating refresh tokens
  -> client retries the MCP request
  -> Brian validates issuer, audience, client, grant, membership, and tenant
  -> MCP tools see only that tenant's skills/context/connectors/executions
```

The web login by itself does **not** connect an agent. It creates a human browser session. The agent becomes connected only after a separate, explicit OAuth consent grant.

## 2. Why this architecture

Brian already has:

- Supabase Auth login support.
- A shared multi-tenant schema with `tenant_id` on tenant-owned data.
- Per-request tenant binding through `AsyncLocalStorage`.
- PostgreSQL RLS using transaction-scoped `app.tenant_id`.
- A hosted Streamable HTTP MCP endpoint in a Supabase Edge Function.
- Hashed, long-lived `api_tokens` for the current manual bearer-token flow.
- A tested local onboarder that edits Claude, Cursor, and Codex configuration.

Brian does not yet have:

- Public self-service signup and tenant provisioning.
- A first-class `tenant_memberships` source of truth for Supabase users.
- A fail-closed policy for valid Supabase users without a tenant.
- MCP OAuth protected-resource discovery and correct `WWW-Authenticate` challenges.
- A consent page for an agent connection.
- OAuth access-token audience and agent-grant validation at `/mcp`.
- A dashboard page for active agent connections and revocation.
- A publishable CLI package.
- A verified compatibility matrix for the OAuth behavior of each supported agent.

Supabase Auth now provides an OAuth 2.1 authorization server with authorization code + PKCE, refresh tokens, custom consent UI, dynamic client registration, and MCP-oriented discovery. Use it rather than implementing an authorization server inside Brian. The MCP server remains a resource server and must still enforce Brian-specific company and permission rules.

## 3. Standards and source material

Implementation must be checked against the latest stable MCP authorization specification at execution time. This plan was written against the 2025-11-25 MCP authorization specification and current Supabase OAuth 2.1 documentation:

- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [Supabase OAuth 2.1 server](https://supabase.com/docs/guides/auth/oauth-server)
- [Supabase OAuth flows](https://supabase.com/docs/guides/auth/oauth-server/oauth-flows)
- [Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)
- [Supabase OAuth authorization UI](https://supabase.com/docs/guides/auth/oauth-server/getting-started)
- [Supabase OAuth token security and RLS](https://supabase.com/docs/guides/auth/oauth-server/token-security)
- [Supabase custom access-token hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)

Mandatory protocol requirements include:

- OAuth authorization code flow with PKCE for public clients.
- Protected Resource Metadata per RFC 9728.
- Authorization-server metadata discovery.
- The `resource` parameter in authorization and token requests.
- Exact token audience/resource validation by Brian.
- Short-lived access tokens and refresh-token rotation.
- Explicit per-client user consent.
- HTTPS everywhere except loopback redirects during local CLI development.
- No token passthrough to downstream services.

## 4. Product decisions

### 4.1 Decisions accepted by this plan

1. **One hosted MCP service serves all companies.** Isolation is request-scoped by tenant; do not deploy one MCP server per user.
2. **A company/tenant owns data.** Skills, context, connectors, evidence, interviews, and executions belong to a tenant, not directly to a human user.
3. **A human may eventually belong to multiple companies.** Introduce memberships now even if the first UI supports one company per self-signup.
4. **OAuth replaces manual agent tokens for normal public onboarding.** Keep `api_tokens` temporarily for migration, service accounts, and emergency compatibility.
5. **Dashboard and MCP credentials are not interchangeable.** They use distinct validation policies and audiences.
6. **The consent screen always shows the selected company and requesting client.** Approval is never implied merely because the user has a Brian browser session.
7. **The CLI is the primary installer, not the identity provider.** The agent or compatibility bridge owns its OAuth session.
8. **No native desktop app in this project phase.** The Node CLI supports Apple Silicon and Intel Macs without separate binaries. Reconsider a desktop companion only after measuring onboarding problems the CLI cannot solve.
9. **The canonical MCP resource is stable from day one.** Use `https://api.brianthebrain.app/mcp`, even if it proxies internally to the current Supabase Edge Function URL.

### 4.2 Explicit non-goals

- Building a new AI chat desktop application.
- Implementing OAuth 2.1 cryptography or refresh-token storage ourselves.
- Enterprise SAML/SCIM in the first public release.
- User-selected arbitrary OAuth scopes that are not backed by tool enforcement.
- Allowing users to join an existing tenant by supplying a tenant ID during signup.
- Removing legacy `api_tokens` before existing installations have migrated.
- Supporting offline use through hosted OAuth. Offline/self-hosted remains the stdio mode.

## 5. Security invariants

These are release-blocking invariants, not suggestions:

1. A valid Supabase user without an active Brian membership receives `403`; they never fall back to the founding tenant.
2. The tenant used for an MCP request is derived only from server-issued token claims plus a current server-side grant/membership check.
3. A request parameter, user-editable metadata field, MCP argument, header other than the bearer token, or redirect query must never select the tenant.
4. Every tenant-owned repository query keeps its explicit `tenant_id` predicate.
5. RLS remains enabled and uses transaction-local `app.tenant_id` as a second line of defense.
6. MCP access tokens must have the expected issuer, signature, expiry, audience/resource, client ID, user ID, and Brian tenant claim.
7. Dashboard tokens are rejected at `/mcp` unless they were issued through the approved MCP OAuth flow with the MCP resource audience and an active agent grant.
8. MCP tokens are rejected on administrative dashboard routes.
9. Revoking an agent connection blocks new MCP calls even if an access token has not yet expired.
10. Suspending a tenant or membership blocks both dashboard and MCP access.
11. Authorization codes, access tokens, refresh tokens, PKCE verifiers, bearer headers, and connector secrets are never logged.
12. Consent is per user, tenant, and OAuth client. A prior approval for one client must not silently approve another.
13. Redirect URIs are validated by Supabase; Brian displays them but never constructs a redirect from an untrusted arbitrary URL.
14. Any pre-tenant database lookup is exposed through a narrow security-definer function, not a broad RLS `SELECT using (true)` policy.

## 6. Target architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Local machine                                                       │
│                                                                     │
│  Claude / Cursor / Codex / other MCP client                         │
│       │                                                             │
│       │ HTTPS Streamable HTTP + OAuth access token                  │
│       ▼                                                             │
└───────┼─────────────────────────────────────────────────────────────┘
        │
        ▼
https://api.brianthebrain.app/mcp
        │
        ├── 401 WWW-Authenticate + resource metadata when unauthenticated
        ├── validates Supabase OAuth JWT and Brian grant
        ├── binds tenant and principal to async request context
        └── serves MCP initialize/tools/list/tools/call
        │
        ▼
Supabase Postgres
        ├── tenants
        ├── tenant_memberships
        ├── agent_connections / oauth grants
        ├── skills / context / connectors / executions
        ├── explicit tenant predicates
        └── RLS backstop

Browser during authorization
        │
        ├── https://brianthebrain.app/signup
        ├── https://brianthebrain.app/login
        ├── https://brianthebrain.app/oauth/consent
        └── Supabase Auth OAuth 2.1 authorization server
```

### 6.1 Credential separation

| Credential | Issuer | Audience/resource | Holder | Accepted by |
|---|---|---|---|---|
| Dashboard access token | Supabase Auth | Brian dashboard/API audience | Browser | Human dashboard routes |
| MCP OAuth access token | Supabase Auth OAuth server | `https://api.brianthebrain.app/mcp` | MCP client | `/mcp` and agent-only supporting routes |
| MCP refresh token | Supabase Auth OAuth server | OAuth client | MCP client secure storage | Supabase token endpoint only |
| Legacy agent bearer | Brian `api_tokens` | Implicit legacy Brian API | Existing installation | Temporary compatibility path |
| Connector OAuth tokens | Google/Slack/etc. | Provider API | Brian server-side encrypted storage | Connector adapters only |

Never pass a Brian MCP token to Google, Slack, or another downstream connector.

## 7. End-to-end user journeys

### 7.1 New user starts inside an agent

1. User chooses **Connect Brian** or adds `https://api.brianthebrain.app/mcp` in the agent.
2. Agent sends an unauthenticated MCP request.
3. Brian returns `401 Unauthorized` with:
   - `WWW-Authenticate: Bearer resource_metadata="https://api.brianthebrain.app/.well-known/oauth-protected-resource/mcp"`
   - the minimum required scope, if the chosen Supabase scope design passes the compatibility spike.
4. Agent fetches protected-resource metadata.
5. Agent discovers Supabase OAuth authorization-server metadata.
6. Agent registers dynamically, or uses a pre-registered client where DCR is unsupported.
7. Agent creates `state`, PKCE verifier/challenge, and sends the canonical `resource` parameter.
8. Agent opens the system browser.
9. Brian's consent route sees no browser session and redirects to `/signup`, preserving only a validated relative return target or opaque `authorization_id`.
10. User enters name, work email, password, and company name; accepts terms/privacy.
11. Supabase creates the user and sends email confirmation.
12. Brian's signup trigger creates a new tenant and an admin membership. It never accepts a requested existing tenant ID.
13. User confirms email and returns through `/auth/callback`.
14. Callback exchanges the auth code for a browser session and returns to the consent flow.
15. If the OAuth authorization request expired while email was being confirmed, Brian shows a friendly message: “Return to your agent and click Connect again.” It does not attempt to resurrect an expired authorization code.
16. Consent page loads the requesting client details from Supabase using `authorization_id`.
17. Consent page displays:
    - Agent/client name.
    - Verified redirect origin/domain.
    - Selected company.
    - Requested capabilities in plain language.
    - What Brian can expose and what it cannot do.
    - Approve and Deny buttons.
18. Before calling Supabase approval, Brian records a pending grant for `(user, tenant, client_id)` with the exact permissions shown.
19. User approves.
20. Supabase redirects to the agent with a short-lived authorization code.
21. Agent exchanges the code using its PKCE verifier and `resource` parameter.
22. Supabase's custom access-token hook reads the active pending/approved grant and adds server-controlled Brian claims.
23. Agent receives short-lived access and rotating refresh tokens.
24. Agent retries MCP initialization with the access token.
25. Brian validates the token and current membership/grant, binds the tenant, and returns the tenant-neutral MCP instructions and allowed tools.
26. Dashboard onboarding continues independently and prompts the user to create the first skill if the tenant has no active skills.

### 7.2 Existing user connects a new agent

1. Agent begins the same OAuth discovery and PKCE flow.
2. Browser reuses the existing Supabase session.
3. Brian still shows consent for this specific OAuth client.
4. User selects a company if they belong to more than one.
5. User approves.
6. Agent receives tokens and connects.

Do not skip consent just because the user is logged in or has approved a different client previously.

### 7.3 User signs up from the website first

1. User visits `/signup` directly.
2. Completes company signup and email verification.
3. Lands in `/onboarding`.
4. Creates or imports the first skill.
5. Optionally connects sources.
6. Reaches **Connect your agent**.
7. UI shows:
   - “Open in” buttons for known MCP clients where deep links are trustworthy.
   - The canonical MCP URL.
   - `npx @brianthebrain/cli connect`.
   - Manual configuration as a fallback.
8. The actual authorization still happens in the agent's OAuth flow.

### 7.4 Invited teammate

1. Tenant admin invites an email address.
2. Brian creates a hashed, expiring invitation tied to the tenant and role.
3. Supabase sends an invite or Brian sends an invite link through the configured provider.
4. The invitee authenticates.
5. The server consumes the invitation exactly once and creates a membership.
6. User cannot alter the tenant or role through URL or user metadata.
7. The invitee may connect their own agents if their role permits it.

### 7.5 Revocation

1. Admin opens **Settings → Agents & connections**.
2. Admin sees client name, approving user, permissions, created time, last use, and status.
3. Admin revokes a connection.
4. Brian marks the grant revoked and writes an audit event.
5. Every subsequent MCP request fails immediately at the grant lookup.
6. Where Supabase exposes a supported grant/token revocation API, invoke it as defense in depth.
7. The agent receives `401` or `403` and must run authorization again.

## 8. Data model

### 8.1 Migration `010_identity_and_agent_connections.sql`

Create `tenant_memberships`:

```sql
create table tenant_memberships (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner', 'admin', 'expert', 'viewer')),
  status      text not null default 'active' check (status in ('invited', 'active', 'suspended', 'removed')),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, user_id)
);
```

Add:

- Index on `(user_id, status)`.
- A constraint or partial unique index ensuring at most one default active membership per user.
- RLS enabled.
- No user-write policy for roles or tenant assignment.
- Read access only through Brian's authenticated API or narrowly scoped policies.

Create `agent_connections`:

```sql
create table agent_connections (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  oauth_client_id    text not null,
  client_name        text not null,
  client_uri         text,
  redirect_origins   jsonb not null default '[]'::jsonb,
  permissions        text[] not null,
  status             text not null default 'pending'
                     check (status in ('pending', 'active', 'denied', 'revoked')),
  approved_at        timestamptz,
  last_used_at       timestamptz,
  expires_at         timestamptz,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
```

Add:

- Index on `(tenant_id, status)`.
- Index on `(user_id, oauth_client_id)`.
- A uniqueness rule preventing duplicate active grants for the same user, tenant, and client unless the compatibility spike shows each installation needs multiple grants.
- RLS enabled with tenant isolation.
- No exposure of OAuth access or refresh tokens; Supabase owns those.

Create `tenant_invitations`:

```sql
create table tenant_invitations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  email        citext not null,
  role         text not null,
  token_hash   text not null unique,
  invited_by   uuid not null references auth.users(id),
  expires_at   timestamptz not null,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
```

Create `security_audit_events`:

```sql
create table security_audit_events (
  id             bigint generated always as identity primary key,
  tenant_id      uuid references tenants(id),
  actor_user_id  uuid references auth.users(id),
  event_type     text not null,
  target_type    text,
  target_id      text,
  metadata       jsonb not null default '{}'::jsonb,
  request_id     text,
  created_at     timestamptz not null default now()
);
```

Audit metadata must never contain credentials, authorization codes, raw query strings from OAuth callbacks, or full bearer headers.

### 8.2 Migration `011_signup_provisioning.sql`

Implement a `security definer` trigger for `auth.users` creation:

1. If the user matches a valid server-created invitation, create/activate that membership.
2. Otherwise, if signup mode is self-service, create a new tenant and owner membership.
3. Generate a collision-safe slug from a validated company-name metadata field.
4. Ignore any user-supplied `tenant_id`, `role`, `is_admin`, permissions, or existing tenant slug.
5. Make the trigger idempotent so retries cannot create duplicate tenants.
6. Fix `search_path` inside the function.
7. Revoke direct execute permission from public roles where appropriate.
8. Write an audit event.

Treat company name as display input, not authorization input. Validate it again in the application before signup, but keep the database function safe when called with malformed metadata.

### 8.3 Migration `012_oauth_claims_and_principal_resolution.sql`

Implement:

- A Supabase Custom Access Token Hook that:
  - Detects OAuth-issued tokens using the supported authentication method/client claims.
  - Reads the approved `agent_connections` record for `(user_id, client_id)`.
  - Adds `tenant_id`, `brian_role`, `brian_permissions`, and a canonical Brian resource/audience claim.
  - Fails token issuance if the grant or membership is absent, pending, revoked, suspended, or ambiguous.
  - Leaves normal dashboard token semantics separate.
- A narrow `resolve_mcp_principal(user_id, tenant_id, client_id)` security-definer function returning only:
  - Active tenant ID.
  - Active user ID.
  - Role.
  - Granted permissions.
  - Connection ID.
- A narrow `resolve_legacy_agent_token(token_hash)` function to replace broad pre-tenant table visibility during migration.
- Removal of `pre_tenant_lookup ... using (true)` policies once callers use the resolver functions.

The hook and resolver must be tested with a non-owner `brian_app` database role.

### 8.4 Existing data migration

1. Create a membership linking the founding Supabase user to the founding tenant as `owner`.
2. Backfill memberships for any other known users only from trusted administrative records.
3. Do not infer membership from email domains.
4. Leave legacy `users` rows in place temporarily for rollback.
5. Add a migration report query listing Supabase users with zero or multiple active default memberships; deployment fails until reviewed.

## 9. Authentication and authorization refactor

### 9.1 Separate route security policies

The current global guard accepts several token types and then applies them to all protected routes. Replace it with explicit route groups/middleware:

1. **Public routes**
   - Signup start/callback support.
   - Login callback support.
   - OAuth consent page assets.
   - OAuth well-known metadata.
   - Provider callbacks that already use signed one-time state.

2. **Human dashboard API**
   - Accept only valid Supabase human sessions with a supported dashboard audience.
   - Resolve active membership.
   - Bind tenant and role.
   - Enforce route-level roles.

3. **MCP resource route**
   - Accept valid MCP OAuth tokens with exact resource audience and active `agent_connections` grant.
   - Temporarily accept legacy agent bearer tokens behind a feature flag.
   - Reject ordinary dashboard tokens.

4. **Agent-supporting HTTP routes**
   - `/api/agent/briefing` follows MCP credential policy, not dashboard policy.
   - Any future agent REST endpoint uses the same MCP principal resolver.

Suggested files:

- Create `server/src/auth/principal.ts`.
- Create `server/src/auth/oauthJwt.ts`.
- Create `server/src/auth/middleware.ts`.
- Create `server/src/auth/permissions.ts`.
- Refactor `server/src/auth/supabase.ts` to distinguish dashboard validation from MCP OAuth validation.
- Refactor `server/src/api/app.ts` to mount route groups with their respective middleware.
- Extend the async tenant context in `server/src/db/tenant.ts` with `userId`, `role`, `connectionId`, and permissions.

### 9.2 JWT validation

Use a maintained JOSE implementation compatible with Node and the Supabase Edge runtime. Do not rely only on decoding the payload or calling `/auth/v1/user` for MCP authorization.

Validate:

- Signature against Supabase JWKS.
- Exact issuer.
- `exp` and `nbf` with minimal documented clock skew.
- Exact MCP audience/resource.
- `sub`/user ID.
- OAuth `client_id`.
- Server-controlled `tenant_id`.
- Required Brian permissions.
- Supported authentication method/token type.
- Current active membership and agent connection from the resolver function.

Cache JWKS according to response caching rules, with safe refresh on unknown key ID. Fail closed if verification or principal resolution fails.

### 9.3 Role and permission model

Start with these human roles:

| Role | Manage company | Manage members | Manage agents | Edit skills | View skills/runs |
|---|---:|---:|---:|---:|---:|
| Owner | Yes | Yes | Yes | Yes | Yes |
| Admin | Limited | Yes | Yes | Yes | Yes |
| Expert | No | No | Own connection only | Yes | Yes |
| Viewer | No | No | No by default | No | Yes |

Start with these agent permissions:

- `skills:read` — `find_skill`, `get_skill`.
- `context:read` — `find_context`.
- `knowledge:write` — `capture`.
- `executions:write` — `log_execution`.
- `actions:execute` — business adapters such as Gmail draft creation.

Consent defaults should grant read + execution logging. `knowledge:write` and especially `actions:execute` must be plainly disclosed. If Supabase's current OAuth server does not accept custom MCP scopes, store these permissions in `agent_connections`, include them through the access-token hook, advertise only a supported minimal OAuth scope, and enforce Brian permissions at the resource server. Do not claim scope-level interoperability until the compatibility spike proves it.

### 9.4 Tool-level enforcement

Refactor `buildMcpServer()` to accept an authenticated principal:

```ts
buildMcpServer({ tenantId, userId, connectionId, permissions })
```

Then:

1. Filter `tools/list` so the client sees only allowed tools.
2. Check permission again inside every `tools/call` handler.
3. Map every adapter to a required permission/risk classification.
4. Do not rely on the model to respect the permission description.
5. Record `connection_id` and `actor_user_id` on executions/captures for auditability.
6. Return OAuth-compliant insufficient-scope errors where the protocol supports step-up authorization.

## 10. MCP OAuth resource-server implementation

### 10.1 Canonical public endpoint

Provision:

```text
https://api.brianthebrain.app/mcp
```

Requirements:

- Stable across Supabase project or hosting migrations.
- Reverse-proxy POST bodies and response streaming/content types without mutation.
- Preserve `Authorization`, `MCP-Protocol-Version`, and relevant MCP headers.
- Do not log bearer headers.
- Apply rate limiting by connection/tenant after authentication and by IP before authentication.
- Provide request IDs through the proxy and Edge Function.

The current raw Supabase function URL remains an internal deployment target, not the URL written into public agent configurations.

### 10.2 Protected Resource Metadata

Serve both the path-specific and root-compatible metadata needed by current clients:

```text
GET /.well-known/oauth-protected-resource/mcp
GET /.well-known/oauth-protected-resource
```

Metadata includes:

- `resource`: exact canonical MCP URI.
- `authorization_servers`: the Supabase OAuth issuer/authorization-server base.
- `scopes_supported`: only verified scopes Brian actually enforces.
- Bearer-token transport method information where supported.

Unauthenticated `/mcp` responses include a valid `WWW-Authenticate` challenge pointing to this metadata.

### 10.3 Supabase OAuth server configuration

In a staging Supabase project first:

1. Enable OAuth 2.1 server capabilities.
2. Migrate JWT signing from symmetric HS256 to an asymmetric algorithm supported by Supabase, preferably ES256 or RS256.
3. Configure Site URL as the production/staging Brian web origin.
4. Configure authorization path `/oauth/consent`.
5. Add exact redirect allowlists for Brian web auth callbacks.
6. Enable Dynamic Client Registration only after DCR abuse controls and monitoring are prepared.
7. Configure the custom access-token hook.
8. Confirm the authorization and token endpoints accept and preserve the MCP `resource` parameter.
9. Confirm custom scope behavior; do not assume custom scopes work because OIDC scopes work.
10. Confirm refresh-token rotation, revocation behavior, code lifetime, and client-registration cleanup.

### 10.4 Required compatibility spike

Before committing the production schema/API to Supabase OAuth beta behavior, test end to end with the latest versions of:

- Claude Code.
- Claude Desktop.
- Cursor.
- Codex CLI/app.
- MCP Inspector or the official SDK client.

For each client record:

- Does it support remote Streamable HTTP MCP?
- Does it parse the 401 `WWW-Authenticate` header?
- Does it fetch RFC 9728 metadata?
- Does it support authorization-server discovery at Supabase's issuer path?
- Does it support DCR or require a pre-registered client?
- Does it send PKCE S256?
- Does it include `resource` in authorization and token requests?
- Which callback URI shape does it use?
- Where does it store access/refresh tokens?
- Does reconnect/refresh work after access-token expiry?
- Does revocation trigger a fresh authorization flow?
- Does it support custom headers only as a legacy fallback?

Write results to `docs/mcp-client-compatibility.md` with versions and test dates. Any unsupported client gets a documented CLI bridge strategy rather than a weakened server auth path.

## 11. Full signup and browser session implementation

### 11.1 Frontend dependency and session model

Add `@supabase/supabase-js` and create one browser client configured for PKCE and automatic session refresh.

Suggested files:

- Create `src/lib/supabase.js`.
- Rewrite `src/app/auth.js` as an asynchronous auth/session provider.
- Create `src/app/AuthProvider.js`.
- Replace synchronous `isLoggedIn()` routing with an async loading/authenticated/unauthenticated state.
- Remove the standalone `brian_token` localStorage contract after migration.

Do not build new authentication flows with raw `fetch` calls when the supported Supabase client handles PKCE/session lifecycle.

### 11.2 Signup page

Create `src/pages/Signup.js` and `Signup.css` with:

- Full name.
- Work email.
- Password and requirements.
- Company name.
- Optional company size/use-case fields only if they are actually used; otherwise omit them.
- Terms and Privacy acceptance.
- Bot protection/CAPTCHA integration supported by Supabase.
- Clear existing-account link.
- Preservation of an OAuth authorization continuation.

Validation:

- Normalize email for display/lookup without making unsafe assumptions about provider-specific equivalence.
- Trim and length-limit company/name fields.
- Reject reserved/control characters and unsafe markup.
- Never accept role or tenant ID from the browser.
- Rate limit signup starts and confirmation resends.

States:

- Initial.
- Submitting.
- Check email.
- Already registered.
- Rate limited.
- Invalid/expired continuation.
- Provisioning failed with a safe retry path.

### 11.3 Login and password recovery

Refactor `src/pages/Login.js` to use the shared Supabase client.

Add:

- `/forgot-password`.
- `/reset-password`.
- `/auth/callback`.
- Safe `returnTo` handling restricted to Brian-owned relative paths.
- Preservation of OAuth `authorization_id` through login.
- Email verification resend.
- Logout that calls Supabase sign-out and clears local application state.

### 11.4 Onboarding wizard

Create `/onboarding` with durable server-side progress:

1. Confirm company identity/name.
2. Create the first skill using existing interview/capture functionality.
3. Connect optional sources.
4. Connect an AI agent.
5. Verify the first `find_skill` MCP call.

Store progress in a tenant-owned `onboarding_state` table or derived completion service. Do not make onboarding completion a client-only localStorage flag.

Allow users to skip optional connectors. Do not block agent authorization because a tenant has zero skills; show a warning and a direct next step instead.

### 11.5 Authorization/consent page

Create `src/pages/OAuthConsent.js` and route `/oauth/consent`.

Behavior:

1. Read `authorization_id` from the query.
2. Require a Supabase browser session; redirect to login/signup with continuation if absent.
3. Call `supabase.auth.oauth.getAuthorizationDetails(authorization_id)`.
4. Load active Brian memberships from the backend.
5. If one membership exists, select it.
6. If multiple exist, require an explicit company selection.
7. Derive display permissions from the verified request plus Brian's permission policy.
8. Show client name, client URI/domain, redirect origin, company, and permission explanations.
9. On Approve:
   - Send the selected tenant and authorization details to a Brian API endpoint.
   - Backend verifies the current user belongs to the tenant and is allowed to connect agents.
   - Backend creates/updates a pending grant with a short expiry.
   - Frontend calls `approveAuthorization`.
   - Backend marks the grant active only after approval succeeds, or uses an idempotent reconciliation path if the redirect occurs immediately.
10. On Deny:
    - Record a denial audit event without sensitive request data.
    - Call `denyAuthorization`.
11. Redirect only to the URL returned by the Supabase SDK.

Consent copy must distinguish:

- Reading company-approved skills/context.
- Writing captured knowledge.
- Logging execution outcomes.
- Acting through connected business tools.

### 11.6 Company and membership API

Add endpoints under human-only auth:

- `GET /api/me` — user plus active memberships and current tenant.
- `POST /api/tenants/switch` — optional future multi-company browser selection; validates membership.
- `GET /api/tenants/current`.
- `PATCH /api/tenants/current` — owner/admin only.
- `GET /api/members`.
- `POST /api/invitations` — owner/admin only.
- `POST /api/invitations/:token/accept` — authenticated invitee.
- `DELETE /api/members/:id` or suspension endpoint with last-owner protection.

Keep current `/api/auth/me` temporarily as a compatibility alias, then remove it after the frontend migrates.

## 12. Agent connection management

### 12.1 Backend endpoints

Add human-only endpoints:

- `POST /api/oauth/grants/prepare` — validate consent choice and prepare the grant.
- `POST /api/oauth/grants/:id/deny` — record denial if needed.
- `GET /api/agent-connections` — list current tenant's connections.
- `GET /api/agent-connections/:id`.
- `POST /api/agent-connections/:id/revoke`.
- `PATCH /api/agent-connections/:id` — rename connection and reduce permissions only; permission expansion requires new consent.

Rules:

- Owners/admins can view and revoke all tenant connections.
- Experts can view/revoke only connections they approved, unless policy says otherwise.
- Viewers cannot create agent connections by default.
- Never return tokens or authorization codes.
- Update `last_used_at` asynchronously/rate-limited so every MCP call does not create unnecessary write pressure.

### 12.2 Dashboard UI

Add **Settings → Agents**:

- Connected client name.
- Approved by.
- Company.
- Permissions.
- Created/last-used timestamps.
- Status.
- Rename.
- Revoke with confirmation.
- Reconnect instructions.
- Legacy-token section visible only while migration is enabled.

Add a prominent **Connect agent** action:

- Copy canonical MCP URL.
- Copy CLI command.
- Per-client instructions generated from the compatibility matrix.
- No plaintext long-lived token by default.

## 13. Brian CLI

### 13.1 Packaging

Create a standalone workspace/package rather than publishing `brian-server`:

```text
packages/cli/
  package.json
  src/index.mjs
  src/commands/connect.mjs
  src/commands/status.mjs
  src/commands/doctor.mjs
  src/commands/disconnect.mjs
  src/commands/signup.mjs
  src/platforms/*.mjs
  src/config/*.mjs
  test/*.test.mjs
```

Package requirements:

- Public scoped npm package: `@brianthebrain/cli` unless naming review chooses another available scope.
- Binary name: `brian`.
- Node 20+ or the oldest actively supported version verified in CI.
- ESM.
- Minimal dependencies and no native dependency in the first release.
- Works from `npx @brianthebrain/cli connect` without cloning Brian's repository.
- Works on macOS Apple Silicon and Intel through the same JavaScript package.
- Add Windows/Linux only after platform adapters pass CI fixtures; keep core code portable now.

Extract reusable config-editing logic and tests from `server/scripts/onboard/` rather than duplicating it. Keep the existing internal script as a compatibility wrapper until the package is proven.

### 13.2 CLI commands

#### `brian signup`

- Opens `https://brianthebrain.app/signup?source=cli` in the default browser.
- Prints the URL when browser launch fails or the session is remote/SSH.
- Does not collect passwords in the terminal.

#### `brian connect`

- Detects supported local MCP clients.
- Shows an explicit plan before modifying files.
- Writes the canonical MCP URL.
- For OAuth-capable clients, writes no bearer token; the client performs OAuth on first connection.
- Uses native client registration commands when they are more stable than file editing; otherwise uses safe merge adapters.
- Preserves unrelated configuration.
- Creates timestamped backups.
- Refuses unparseable configuration.
- Supports `--only`, `--dry-run`, `--yes`, and `--json`.
- After installation, either invokes a safe client-specific auth/connect command or tells the user exactly where to click to complete browser authorization.
- Never accepts a secret through `--token` in the public OAuth flow.

#### `brian status`

Displays:

- Client detected.
- MCP URL configured.
- Legacy token present warning.
- OAuth-capable based on tested version.
- Brian instruction/hook status.
- Whether restart is required.
- Last known health check without exposing identity data.

#### `brian doctor`

Checks:

- DNS/TLS reachability of the canonical endpoint.
- Protected-resource metadata validity.
- Authorization-server discovery validity.
- MCP unauthenticated challenge shape.
- Client config parseability.
- Duplicate Brian entries.
- Old raw Supabase endpoint usage.
- Plaintext Brian tokens in supported config locations, reporting paths but never values.
- Hook URL and auth configuration consistency.
- Client version against compatibility notes.

Exit codes must be documented and stable for automation.

#### `brian disconnect`

- Removes only Brian-owned config entries and marker blocks.
- Backs up files first.
- Does not revoke server authorization unless the user explicitly confirms or passes `--revoke` and a supported authenticated path exists.
- Gives a dashboard link for revocation when the CLI has no credential.

### 13.3 OAuth-incompatible client bridge

Do not build the bridge until the compatibility spike identifies a real need.

If required, add:

```text
Local MCP client -> stdio `brian bridge` -> hosted HTTPS MCP
```

Bridge requirements:

- Implements OAuth authorization code + PKCE as a public client.
- Opens a loopback HTTP callback on `127.0.0.1`, never all interfaces.
- Uses random state and an ephemeral port accepted by the registered/DCR client policy.
- Stores refresh credentials in the OS credential store; on macOS use Keychain through an architecture-neutral system interface.
- Never stores refresh tokens inside agent JSON/TOML config.
- Redacts all credentials from logs.
- For SSH/headless use, print a safe URL and provide a documented loopback/copy continuation only if the OAuth provider supports it. Do not invent a device grant that Supabase does not support.
- Proxies only to the configured canonical Brian resource; prevent arbitrary-target SSRF.

### 13.4 Existing hooks

The current Claude Code briefing hook sends a separate HTTP request. Migrate it to one of:

1. Prefer normal MCP usage and remove the extra hook credential if reliable invocation reaches the required standard.
2. If the hook remains necessary, have it call the local authenticated bridge rather than embedding a refresh token.
3. During migration only, retain legacy bearer support behind a visible warning and expiry date.

Do not write a Supabase refresh token into `server/.env`, `AGENTS.md`, shell history, or client config.

### 13.5 CLI testing

Use temporary HOME fixtures for every platform adapter:

- Missing config.
- Valid config with unrelated MCP servers.
- Existing Brian config.
- Malformed JSON/TOML.
- Read-only file.
- Backup creation.
- Idempotent second run.
- Upgrade from raw Supabase URL to canonical URL.
- Upgrade from legacy bearer config to OAuth URL without accidentally deleting the credential before successful reconnection.
- Disconnect preserves unrelated content.
- Paths with spaces.
- macOS Intel and Apple Silicon path behavior is identical.

CI matrix:

- macOS arm64 where available.
- macOS x64 where available.
- Linux x64 for core tests.
- Supported Node versions.

## 14. API and frontend test plan

### 14.1 Unit tests

Add tests for:

- JWT issuer/audience/resource/client validation.
- Expired/not-yet-valid/wrong-key tokens.
- Missing and malformed claims.
- Dashboard token rejected at MCP.
- MCP token rejected on admin routes.
- Permission mapping per MCP tool.
- Membership and grant resolvers.
- Signup validation and continuation validation.
- Consent permission display mapping.
- Audit redaction.
- Slug collision handling.

### 14.2 Database tests

Add migration tests for:

- Tables, constraints, indexes, and RLS enabled.
- New auth user creates exactly one tenant and membership.
- Retry is idempotent.
- User metadata cannot select an existing tenant or privileged role.
- Invitation consumption joins only the invited tenant and role.
- Expired/revoked invitation fails.
- Last owner cannot be removed without ownership transfer.
- Custom access-token hook emits claims only for active grants.
- Resolver returns no principal for revoked grant, suspended member, or suspended tenant.
- Non-owner DB role cannot read cross-tenant agent connections/memberships.
- Existing cross-tenant leak tests include every new table.

### 14.3 API integration tests

Test the complete matrix:

| Token | Dashboard skills API | Agent briefing | MCP |
|---|---:|---:|---:|
| Valid dashboard token | Allowed by role | Rejected | Rejected |
| Valid MCP OAuth token | Rejected | Allowed by scope | Allowed |
| Valid legacy token, flag on | Rejected or narrowly allowed during migration | Allowed | Allowed |
| Valid legacy token, flag off | Rejected | Rejected | Rejected |
| Missing tenant claim | Rejected | Rejected | Rejected |
| Revoked grant | Rejected | Rejected | Rejected |
| Suspended tenant | Rejected | Rejected | Rejected |

Also test:

- Correct `WWW-Authenticate` on unauthenticated MCP.
- Both protected-resource metadata URLs.
- Exact canonical resource value.
- Wrong audience is rejected even with a valid Supabase signature.
- Permissions filter `tools/list` and block direct `tools/call` attempts.
- Acme token cannot retrieve Globex skill by ID or vector search.
- Acme capture/log execution writes Acme tenant ID.
- Connector actions cannot use another tenant's connector.

### 14.4 Browser/E2E tests

Automate in a staging Supabase project:

1. Direct self-signup and email-confirmation test account flow.
2. Signup initiated from expired and valid OAuth requests.
3. Existing-user OAuth approval.
4. Denial.
5. Multi-membership company selection.
6. Viewer forbidden from connecting an agent.
7. Agent connection appears in dashboard.
8. Revocation immediately blocks MCP.
9. Reauthorization restores access with a new grant.
10. Password recovery and OAuth continuation.

Use test inbox infrastructure or Supabase-supported local email capture. Never disable email confirmation in production merely to simplify tests.

### 14.5 Live smoke script

Create `server/scripts/smoke-mcp-oauth.mjs` or a package-level equivalent that verifies, without printing tokens:

- Discovery documents.
- Authorization endpoint reachability.
- A pre-created test OAuth client PKCE flow where automation is appropriate.
- Token audience and claims.
- MCP initialize.
- `tools/list` permission filtering.
- Tenant-specific `find_skill`.
- Revocation failure.

Production smoke must use a dedicated synthetic tenant with harmless data.

## 15. Observability and operations

### 15.1 Metrics

Track:

- Signup started/completed/verified/provisioned.
- OAuth discovery success/failure.
- Consent viewed/approved/denied/expired.
- Token validation failure category without token data.
- MCP initialization success by client/version where safely available.
- Refresh/reconnect failures observable at the resource server.
- Active/revoked agent connections.
- Cross-tenant authorization denials.
- CLI connect/doctor outcomes as opt-in anonymous telemetry only, or no telemetry in v1.

### 15.2 Logs

Structured logs include:

- Request ID.
- Route class.
- Tenant ID after successful resolution.
- Connection ID after successful MCP auth.
- Error category.
- Latency.

Never include:

- Authorization header.
- Raw token, hash, code, refresh token, PKCE verifier, OAuth `state`, connector credential, password, or full OAuth callback URL.

### 15.3 Alerts

Alert on:

- Repeated invalid-audience or invalid-issuer tokens.
- DCR registration spikes.
- Signup/provisioning trigger failures.
- Resolver errors.
- Cross-tenant denial spikes.
- OAuth approval success followed by repeated MCP 401s.
- Edge Function timeout/error-rate regression.

## 16. Abuse prevention and privacy

- Enable Supabase signup rate limits and CAPTCHA.
- Rate limit DCR if Supabase exposes controls; otherwise monitor and periodically clean unused clients.
- Require explicit consent for every newly registered OAuth client.
- Display client name and redirect origin; treat client-supplied branding as untrusted text.
- Escape all metadata in the consent UI.
- Apply CSP, frame-ancestors protection, and anti-clickjacking headers to consent/login/signup pages.
- Use `SameSite`, secure session behavior provided by Supabase and avoid custom auth cookies unless necessary.
- Publish Privacy Policy, Terms, subprocessors, data deletion, and security contact before public signup.
- Provide account/company deletion with a documented grace period and connector credential revocation.
- Define retention for audit events and execution logs.

## 17. Rollout plan

### Phase 0 — ADR and Supabase OAuth compatibility spike

Deliverables:

- Record the architecture decision in `docs/architecture/mcp-auth.md`.
- Create a separate staging Supabase project or branch with OAuth 2.1 enabled.
- Verify PKCE, `resource`, audience customization, custom scopes, DCR, refresh rotation, custom claims, consent API, and revocation.
- Complete the client compatibility matrix.
- Confirm branded resource URL/proxy behavior.

Exit criteria:

- At least one major client completes browser OAuth and calls a tenant-scoped MCP tool.
- A documented fallback exists for every launch client.
- No unresolved question about how `tenant_id` reaches and is validated in the access token.

### Phase 1 — Identity and tenant hardening

Deliverables:

- Migrations 010–012.
- Membership source of truth.
- Founding user backfill.
- Fail-closed missing-membership behavior.
- Separate dashboard/MCP middleware.
- Security-definer principal resolvers.
- Extended RLS leak tests.

Exit criteria:

- A valid user with no membership gets no tenant data.
- All cross-tenant tests pass as `brian_app`.
- Legacy production behavior remains available behind flags.

### Phase 2 — Public signup and onboarding

Deliverables:

- Supabase client/session provider.
- Signup, verification callback, recovery/reset.
- Company provisioning.
- Onboarding wizard.
- Invitation flow if team invites are launch-critical; otherwise keep it feature-flagged but preserve the schema.

Exit criteria:

- A clean browser can create a new company without administrator intervention.
- The new user sees only the new tenant.
- Signup abuse controls and legal pages are active.

### Phase 3 — MCP OAuth and consent

Deliverables:

- Protected-resource discovery.
- OAuth-compliant 401 challenge.
- Consent screen.
- Grant preparation and auditing.
- Custom access-token hook.
- JWT/resource/grant validation.
- Tool-level permissions.
- Connections dashboard and revocation.

Exit criteria:

- “Connect Brian” completes end to end in launch clients.
- Revocation is immediate at Brian.
- Dashboard/MCP credential confusion tests pass.

### Phase 4 — Public CLI

Deliverables:

- Publishable package.
- `signup`, `connect`, `status`, `doctor`, `disconnect`.
- Extracted adapters and fixture tests.
- OAuth-capable configurations without static tokens.
- Compatibility bridge only where required.

Exit criteria:

- `npx @brianthebrain/cli connect` works on a clean Apple Silicon Mac and a clean Intel Mac.
- Second run is zero-diff.
- Uninstall/disconnect preserves unrelated configuration.
- No secret appears in command history or config for OAuth-native clients.

### Phase 5 — Existing-user migration

Deliverables:

- Dashboard and CLI notices for legacy token installations.
- One-click/reconnect OAuth path.
- Per-token last-used tracking.
- Admin report of remaining legacy credentials.
- Date-based deprecation plan.

Sequence:

1. Enable OAuth while legacy tokens remain accepted.
2. Migrate internal/founding machines first.
3. Invite design partners to reconnect.
4. Warn on legacy token usage.
5. Stop issuing new legacy tokens.
6. Disable legacy tokens tenant by tenant.
7. Remove static founding token path after rollback window.

### Phase 6 — General availability

Deliverables:

- Production domain and monitoring.
- Support/runbooks.
- Incident response and token-compromise procedure.
- Backup/restore test.
- Security review.
- Public documentation.

Do not call the feature generally available while the underlying Supabase OAuth-server dependency remains operationally unsuitable for Brian's requirements. If the beta fails Phase 0 criteria, choose a mature external authorization server or a maintained MCP auth gateway; do not build ad hoc OAuth endpoints.

## 18. Feature flags and rollback

Add server-controlled flags:

- `PUBLIC_SIGNUP_ENABLED`.
- `MCP_OAUTH_ENABLED`.
- `MCP_OAUTH_APPROVALS_ENABLED` (fail closed for new grants while existing-token validation remains available).
- `MCP_DCR_ENABLED` if controllable at the application boundary.
- `LEGACY_AGENT_TOKENS_ENABLED`.
- `AGENT_CONNECTIONS_UI_ENABLED`.
- `CLI_OAUTH_BRIDGE_ENABLED`.

Rollback strategy:

- Schema migrations are additive until the legacy flow is fully retired.
- Disable public signup without disabling existing sessions.
- Disable new OAuth approvals while continuing to validate existing short-lived tokens during incident triage, if safe.
- Restore legacy agent access only for explicitly selected tenants and time-box it.
- Never roll back by removing tenant enforcement or accepting missing claims.

## 19. Documentation deliverables

Create/update:

- `README.md` — public hosted MCP and quick start.
- `docs/signup.md` — account/company lifecycle.
- `docs/mcp-oauth.md` — discovery, authorization, consent, and troubleshooting.
- `docs/mcp-client-compatibility.md` — exact tested versions and limitations.
- `docs/cli.md` — commands, exit codes, config paths, backups, uninstall.
- `docs/security/tenant-isolation.md` — invariants and test strategy.
- `docs/security/token-handling.md` — credential types and storage rules.
- `docs/runbooks/oauth-outage.md`.
- `docs/runbooks/compromised-agent-connection.md`.
- `docs/onboard.md` — migrate from internal `npm run onboard` to public CLI.
- `SupabaseIntegration.md` — replace aspirational token/UI sections with the implemented OAuth architecture.
- `Nextstep.md` — phase status and deployment facts.

## 20. Definition of done

The project is complete only when all of the following are true:

### Signup

- A new user can create a verified Brian account and company without manual database work.
- Provisioning is idempotent.
- A missing membership fails closed.
- Invitations cannot be forged or redirected to another tenant.

### OAuth connection

- An MCP client discovers authorization from an unauthenticated Brian request.
- Browser login/signup and consent preserve the authorization flow safely.
- Consent identifies client, company, and capabilities.
- PKCE and the MCP `resource` parameter are enforced.
- Supabase issues short-lived access and rotating refresh tokens.
- Brian validates exact issuer/audience/client/grant/membership/tenant.

### Isolation

- Two independently created companies cannot read, search, write, execute, or enumerate each other's data.
- App-level predicates and RLS both enforce tenant boundaries.
- Tool permissions are enforced in code, not only shown in consent copy.

### Revocation

- A human can see and revoke connected agents.
- Revocation blocks the next MCP request.
- Audit events explain who approved/revoked what without containing credentials.

### CLI

- One public command safely configures supported local clients.
- OAuth-native clients receive no static bearer in config.
- Apple Silicon and Intel Macs use the same package and both pass clean-machine tests.
- Dry-run, status, doctor, idempotency, backups, and disconnect work.

### Operations

- Production uses the canonical branded MCP URL.
- Logs redact secrets.
- Metrics and alerts cover signup, consent, validation, and connection failures.
- Rollback flags and runbooks have been exercised.
- Legacy tokens have a measured, time-boxed retirement plan.

## 21. Recommended implementation sequence by file

1. Add migrations `010_identity_and_agent_connections.sql`, `011_signup_provisioning.sql`, and `012_oauth_claims_and_principal_resolution.sql` plus migration/RLS tests.
2. Add principal types and route-specific middleware under `server/src/auth/`; eliminate founding-tenant fallback for authenticated requests.
3. Add JWT/JWKS/resource validation and MCP protected-resource metadata.
4. Refactor `server/src/mcp/server.ts` to accept a principal and enforce tool permissions.
5. Add memberships, grants, connections, invitation, and tenant services/repositories.
6. Add corresponding human-only APIs to the Hono app, splitting route mounting if `app.ts` becomes unwieldy.
7. Replace the frontend's raw token/localStorage authentication with a Supabase PKCE session provider.
8. Add signup, auth callback, recovery, onboarding, and OAuth consent routes.
9. Add Agents & connections settings UI and revocation.
10. Run the client compatibility spike against staging and lock the public configuration shapes.
11. Extract the onboarder into `packages/cli`, update remote entries to OAuth URL-only configuration, and publish a prerelease.
12. Migrate founding/internal installations, then design partners, then public users.

## 22. Open questions that Phase 0 must close

1. Does the currently deployed Supabase OAuth 2.1 server fully honor RFC 8707 `resource` for the authorization and token endpoints?
2. Can the access-token hook set an exact MCP audience without breaking ordinary dashboard sessions?
3. Are custom Brian scopes accepted, returned, and refreshed correctly, or must capabilities live solely in Brian's grant record/claims?
4. Does Supabase DCR support the client metadata and redirect patterns emitted by every launch MCP client?
5. What supported API exists for listing/revoking a user's OAuth grants and registered clients?
6. How quickly does Supabase propagate custom hook and signing-key changes at the Edge Function?
7. Which launch clients can complete OAuth natively, and which require the stdio bridge?
8. Can the branded proxy preserve all Streamable HTTP behavior and OAuth metadata paths without client-specific exceptions?
9. What is the final dashboard audience, MCP resource URI, and issuer after custom-domain decisions?
10. Should `actions:execute` be excluded from initial consent until each business adapter has its own risk/approval model?

These questions are intentionally not answered by assumption. Each has a concrete spike or test above, and each affects security or interoperability enough to block production rollout.
