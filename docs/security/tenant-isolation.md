# Tenant isolation

Brian uses shared tables with mandatory `tenant_id`, explicit SQL predicates, and PostgreSQL RLS. Identity resolution happens before a tenant context exists and is limited to narrowly granted security-definer functions.

## Invariants

1. A valid Supabase user without an active default membership receives `403 membership_required`.
2. A request parameter, user metadata, arbitrary header, redirect query, or MCP argument never selects the tenant.
3. Dashboard requests resolve a verified Supabase subject to an active membership. MCP requests require exact signed Brian claims and a matching active grant, membership, and tenant.
4. Every tenant-owned repository query includes an explicit tenant predicate.
5. Every database request uses a transaction-scoped `SET LOCAL app.tenant_id`; identity resolvers also require matching `SET LOCAL app.user_id`.
6. RLS is a backstop, not a replacement for application predicates.
7. Tenant, membership, or connection suspension/revocation takes effect on the next request.

## Request binding

The auth middleware creates one of four typed principals:

- `human`: user, membership, role, and tenant;
- `mcp`: user, OAuth client, connection, role, permissions, and tenant;
- `legacy-agent`: migration-only tenant principal;
- `system`: local/stdin development principal only.

The principal is stored in `AsyncLocalStorage`. `db()` begins a transaction and applies transaction-local identity/tenant settings before repository code runs. Values disappear at transaction end and therefore cannot leak through a connection pool.

Human and MCP routes use different validators. Dashboard tokens must have the expected Supabase issuer, the `authenticated` audience, no OAuth `client_id`, and no Brian MCP token type; the server also refetches the user from Supabase. MCP JWTs require the exact canonical audience/resource and all connection claims. Legacy credentials are accepted only by MCP/agent routes while explicitly enabled.

## Pre-tenant resolvers

Migration 012 removes broad pre-tenant RLS policies and exposes only:

- `resolve_dashboard_principal(uuid, uuid)`;
- `list_user_memberships(uuid)`;
- `resolve_mcp_principal(uuid, uuid, text)`;
- `resolve_legacy_agent_token(text)`;
- `consume_tenant_invitation(uuid, text)`.
- `is_valid_tenant_invitation(text, text)` (boolean-only signup preflight).

Migration 014 adds three equally narrow, subject-bound privacy functions:

- `request_data_deletion(uuid, uuid, text, integer)`;
- `list_my_data_deletion_requests(uuid)`;
- `cancel_data_deletion_request(uuid, uuid)`.

Functions use a fixed search path, validate inputs, and are executable only by `brian_app`. Human/MCP membership resolvers require `app.user_id` to equal the already verified JWT subject. The access-token hook is not executable by `brian_app`; it is granted only to `supabase_auth_admin` when that role exists.

## Data controls

Migrations 010-014 add or harden RLS for memberships, invitations, agent connections, onboarding, audit events, skill links, deletion requests, legacy credentials, and existing tenant-owned tables. Agent execution rows record both actor user and connection where applicable. Connector credentials are loaded from the current tenant's row and never selected by a client argument. Runtime roles cannot enumerate deletion requests or change tenant lifecycle status directly.

The API prevents the last active owner from being removed. Invitation tenant and role are derived only from the hashed server-created row. One open agent grant per user/OAuth client avoids an ambiguous token-hook tenant decision.

## Test strategy

The database suite runs in a dedicated non-public schema and replays all convergent migrations. Coverage includes:

- provisioning and slug collisions;
- ignored user-controlled tenant/role metadata;
- valid, expired, revoked, wrong-email, and single-use invitations;
- custom-hook claims and inactive/ambiguous grants;
- suspended/revoked tenant, membership, and connection resolution;
- last-owner protection;
- dashboard/MCP/legacy credential confusion;
- every new table in the RLS leak inventory;
- Acme/Globex read, search, write, execution, connection, and connector boundaries.

Run the security-focused local slice with an isolated `TEST_DATABASE_URL`:

```bash
cd server
node --env-file=.env ./node_modules/vitest/vitest.mjs run \
  src/db/migrate010.test.ts \
  src/db/migrate011.test.ts \
  src/db/migrate012.test.ts \
  src/db/migrate013.test.ts \
  src/db/migrate014.test.ts \
  src/db/rlsLeak.test.ts \
  src/api/tenancy.test.ts \
  src/api/identityApi.test.ts \
  src/api/privacyApi.test.ts
```

The test connection must resolve to a non-`public` schema; tests abort rather than touch production tables.

## Deployment verification

Before enabling signup or OAuth:

1. Apply migrations as the owner, then connect the application using `brian_app`.
2. Verify `current_user` is not a table owner and does not have `BYPASSRLS`.
3. Run the owner-only `identity_membership_report`; investigate every row.
4. Create two clean staging companies and prove bidirectional denial for IDs, vector search, writes, executions, audit data, onboarding, agent connections, and connector actions.
5. Revoke an active grant and suspend a membership while its JWT remains valid; the next MCP call must fail.
6. Preserve request IDs and redacted authorization-denial categories in evidence.

Running the application as `postgres`, a service role, or another table owner makes RLS ineffective and is a release blocker even if application tests pass.
