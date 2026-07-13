import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { buildApp } from "./app.js";
import { testClient } from "../test/http.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import type { HttpLogSink, OperationalLog } from "../operations/http.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const USER = "13000000-0000-4000-8000-000000000001";
const TENANT = "13000000-0000-4000-8000-000000000010";
const CLIENT = "identity-api-client";
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const dashboardToken = `${b64({ alg: "ES256" })}.${b64({
  iss: "https://x.supabase.co/auth/v1", sub: USER, aud: "authenticated",
})}.sig`;

async function cleanup() {
  await pool.query(
    "delete from data_deletion_requests where tenant_id=$1 or requested_by_user_id=$2 or target_user_id=$2",
    [TENANT, USER],
  );
  await pool.query("delete from security_audit_events where tenant_id=$1 or actor_user_id=$2", [TENANT, USER]);
  await pool.query("delete from agent_connections where tenant_id=$1 or user_id=$2", [TENANT, USER]);
  await pool.query("delete from onboarding_state where tenant_id=$1", [TENANT]);
  await pool.query("delete from tenant_memberships where tenant_id=$1 or user_id=$2", [TENANT, USER]);
  await pool.query("delete from brian_auth_users_test where id=$1", [USER]);
  await pool.query("delete from tenants where id=$1", [TENANT]);
}

async function resolveMcpGrant() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id',$1,true)", [USER]);
    const { rows } = await client.query(
      "select * from resolve_mcp_principal($1,$2,$3)",
      [USER, TENANT, CLIENT],
    );
    await client.query("rollback");
    return rows;
  } catch (error) {
    try { await client.query("rollback"); } catch { /* connection-level failure */ }
    throw error;
  } finally {
    client.release();
  }
}

d("identity and agent-connection API", () => {
  beforeAll(async () => {
    const schema = (await pool.query("select current_schema() as schema")).rows[0].schema;
    if (schema === "public") throw new Error("identity API tests require the isolated test schema");
    await runMigrations(pool);
  });
  beforeEach(async () => {
    await cleanup();
    await pool.query(
      "insert into app_config(key,value) values ('PUBLIC_SIGNUP_ENABLED','false') on conflict(key) do update set value='false'",
    );
    await pool.query(
      "insert into brian_auth_users_test(id,email) values ($1,'identity-api@example.test')",
      [USER],
    );
    await pool.query("insert into tenants(id,name,slug) values ($1,'Identity API','__identity-api')", [TENANT]);
    await pool.query(
      `insert into tenant_memberships(tenant_id,user_id,role,status,is_default)
       values ($1,$2,'admin','active',true)`,
      [TENANT, USER],
    );
    await pool.query("insert into onboarding_state(tenant_id) values ($1)", [TENANT]);
  });
  afterAll(async () => { await cleanup(); await pool.end(); });

  function client(
    mcpOAuthApprovalsEnabled = true,
    scope = "email",
    httpLogSink: HttpLogSink | false = false,
  ) {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: USER, email: "identity-api@example.test" }));
      }
      if (url.endsWith("/auth/v1/oauth/authorizations/auth_1")) {
        return new Response(JSON.stringify({
          authorization_id: "auth_1",
          redirect_uri: "http://127.0.0.1:8787/callback",
          scope,
          client: { id: CLIENT, name: "Identity Test Client", uri: "https://client.example" },
          user: { id: USER, email: "identity-api@example.test" },
        }));
      }
      return new Response("{}", { status: 404 });
    });
    return testClient(buildApp({
      authRequired: true,
      supabaseAuth: { url: "https://x.supabase.co", anonKey: "anon", fetchFn },
      mcpOAuth: null,
      mcpOAuthApprovalsEnabled,
      httpLogSink,
    }));
  }

  const auth = { authorization: `Bearer ${dashboardToken}` };

  it("returns membership-backed /api/me without trusting browser metadata", async () => {
    const response = await client().inject({ method: "GET", url: "/api/me", headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.json().currentTenant).toMatchObject({ id: TENANT, name: "Identity API" });
    expect(response.json().memberships).toEqual([expect.objectContaining({
      tenantId: TENANT, role: "admin", isDefault: true,
    })]);
    expect(response.json().featureFlags).toMatchObject({
      mcpOAuthApprovals: true,
      mcpDcr: false,
      cliOauthBridge: false,
    });
  });

  it("prepares, activates, lists, and immediately revokes an agent grant", async () => {
    const logs: OperationalLog[] = [];
    const api = client(true, "email", (entry) => logs.push(entry));
    const prepared = await api.inject({
      method: "POST", url: "/api/oauth/grants/prepare", headers: auth,
      payload: {
        authorizationId: "auth_1",
        tenantId: TENANT,
        // Browser permission escalation is ignored. The verified authorization
        // has only the standard email scope, so Brian's safe defaults win.
        permissions: ["skills:read", "actions:execute", "unknown:permission"],
        // These are deliberately ignored in favor of server-fetched details.
        oauthClientId: "attacker-client",
        clientName: "Attacker Name",
        redirectUri: "https://attacker.example/callback",
        authorizationCode: "authorization-code-secret",
        password: "body-password-secret",
      },
    });
    expect(prepared.statusCode).toBe(201);
    const grant = prepared.json().grant;
    expect(grant).toMatchObject({
      oauthClientId: CLIENT,
      clientName: "Identity Test Client",
      status: "pending",
      permissions: ["skills:read", "context:read", "executions:write"],
    });

    const event = {
      user_id: USER,
      claims: { sub: USER, aud: "authenticated", role: "authenticated", client_id: CLIENT },
    };
    await pool.query("select custom_access_token_hook($1::jsonb)", [JSON.stringify(event)]);

    const listed = await api.inject({ method: "GET", url: "/api/agent-connections", headers: auth });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().connections).toEqual([expect.objectContaining({ id: grant.id, status: "active" })]);

    const revoked = await api.inject({
      method: "POST", url: `/api/agent-connections/${grant.id}/revoke`, headers: auth,
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json().status).toBe("revoked");
    expect((await pool.query("select status from agent_connections where id=$1", [grant.id])).rows[0].status)
      .toBe("revoked");
    const audit = await pool.query(
      "select event_type,connection_id from security_audit_events where target_id=$1 order by id",
      [grant.id],
    );
    expect(audit.rows).toEqual([
      { event_type: "agent_connection.prepared", connection_id: grant.id },
      { event_type: "agent_connection.activated", connection_id: grant.id },
      { event_type: "agent_connection.revoked", connection_id: grant.id },
    ]);
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: "domain_metric",
        metric: "oauth_consent",
        outcome: "prepared",
        category: "authorization_request",
        tenant_id: TENANT,
        connection_id: grant.id,
      }),
      expect.objectContaining({
        event: "domain_metric",
        metric: "agent_connection",
        outcome: "prepared",
        connection_id: grant.id,
      }),
      expect.objectContaining({
        event: "domain_metric",
        metric: "agent_connection",
        outcome: "revoked",
        connection_id: grant.id,
      }),
    ]));
    const serializedMetrics = JSON.stringify(logs.filter((entry) => entry.event === "domain_metric"));
    expect(serializedMetrics).not.toContain("authorization-code-secret");
    expect(serializedMetrics).not.toContain("body-password-secret");
    expect(serializedMetrics).not.toContain("attacker.example");
  });

  it("reuses one open row for expanded reauthorization and invalidates old tokens until activation", async () => {
    const inserted = await pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,permissions,status,approved_at)
       values ($1,$2,$3,'Existing Client',array['skills:read'],'active',now())
       returning id`,
      [TENANT, USER, CLIENT],
    );
    const connectionId = inserted.rows[0].id;
    expect(await resolveMcpGrant()).toEqual([expect.objectContaining({
      connection_id: connectionId,
      permissions: ["skills:read"],
    })]);

    const prepared = await client(true, "email skills:read actions:execute").inject({
      method: "POST",
      url: "/api/oauth/grants/prepare",
      headers: auth,
      payload: { authorizationId: "auth_1", tenantId: TENANT },
    });
    expect(prepared.statusCode).toBe(201);
    expect(prepared.json().grant).toMatchObject({
      id: connectionId,
      status: "pending",
      approvedAt: null,
      permissions: ["skills:read", "actions:execute"],
    });
    expect(prepared.json().grant.expiresAt).toEqual(expect.any(String));
    expect(await resolveMcpGrant()).toEqual([]);
    expect((await pool.query(
      `select count(*)::int as count from agent_connections
        where user_id=$1 and oauth_client_id=$2 and status in ('pending','active')`,
      [USER, CLIENT],
    )).rows[0].count).toBe(1);

    const event = {
      user_id: USER,
      claims: { sub: USER, aud: "authenticated", role: "authenticated", client_id: CLIENT },
    };
    await pool.query("select custom_access_token_hook($1::jsonb)", [JSON.stringify(event)]);
    expect((await pool.query(
      `select status,approved_at is not null as approved,expires_at,permissions
         from agent_connections where id=$1`,
      [connectionId],
    )).rows[0]).toEqual({
      status: "active",
      approved: true,
      expires_at: null,
      permissions: ["skills:read", "actions:execute"],
    });
    expect(await resolveMcpGrant()).toEqual([expect.objectContaining({
      connection_id: connectionId,
      permissions: ["skills:read", "actions:execute"],
    })]);
  });

  it("denies a failed reauthorization and leaves only a later retry open", async () => {
    const inserted = await pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,permissions,status,approved_at)
       values ($1,$2,$3,'Existing Client',array['skills:read'],'active',now())
       returning id`,
      [TENANT, USER, CLIENT],
    );
    const originalId = inserted.rows[0].id;

    const prepared = await client().inject({
      method: "POST",
      url: "/api/oauth/grants/prepare",
      headers: auth,
      payload: { authorizationId: "auth_1", tenantId: TENANT },
    });
    expect(prepared.statusCode).toBe(201);
    expect(prepared.json().grant).toMatchObject({ id: originalId, status: "pending" });
    expect(await resolveMcpGrant()).toEqual([]);

    const denied = await client().inject({
      method: "POST",
      url: `/api/oauth/grants/${originalId}/deny`,
      headers: auth,
      payload: { tenantId: TENANT },
    });
    expect(denied.statusCode).toBe(200);
    expect(denied.json()).toEqual({ denied: true });
    expect((await pool.query(
      "select status,approved_at,expires_at from agent_connections where id=$1",
      [originalId],
    )).rows[0]).toEqual({ status: "denied", approved_at: null, expires_at: null });
    expect(await resolveMcpGrant()).toEqual([]);

    const retried = await client().inject({
      method: "POST",
      url: "/api/oauth/grants/prepare",
      headers: auth,
      payload: { authorizationId: "auth_1", tenantId: TENANT },
    });
    expect(retried.statusCode).toBe(201);
    expect(retried.json().grant.id).not.toBe(originalId);
    expect((await pool.query(
      `select count(*)::int as total,
              count(*) filter (where status in ('pending','active'))::int as open
         from agent_connections where user_id=$1 and oauth_client_id=$2`,
      [USER, CLIENT],
    )).rows[0]).toEqual({ total: 2, open: 1 });
  });

  it("audits a verified denial without preparing or mutating an active grant", async () => {
    const logs: OperationalLog[] = [];
    await pool.query(
      "update tenant_memberships set role='viewer' where tenant_id=$1 and user_id=$2",
      [TENANT, USER],
    );
    const inserted = await pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,display_name,client_uri,
         redirect_origins,permissions,status,approved_at)
       values ($1,$2,$3,'Existing Active Client','Existing display','https://old.example',
               '["https://old.example"]'::jsonb,array['skills:read','actions:execute'],'active',now())
       returning id`,
      [TENANT, USER, CLIENT],
    );
    const connectionId = inserted.rows[0].id;
    const before = (await pool.query(
      `select status,client_name,display_name,client_uri,redirect_origins,permissions,
              approved_at,updated_at
         from agent_connections where id=$1`,
      [connectionId],
    )).rows[0];

    const suppliedRequestId = "Bearer-secret-request-id-must-not-be-recorded";
    const response = await client(true, "email", (entry) => logs.push(entry)).inject({
      method: "POST",
      url: "/api/oauth/authorizations/deny",
      headers: { ...auth, "x-request-id": suppliedRequestId },
      payload: {
        authorizationId: "auth_1",
        tenantId: TENANT,
        oauthClientId: "attacker-client",
        redirectUri: "https://attacker.example/callback?code=secret",
        authorizationCode: "must-not-be-audited",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ recorded: true });
    const requestId = response.headers["x-request-id"];
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestId).not.toBe(suppliedRequestId);

    const after = (await pool.query(
      `select status,client_name,display_name,client_uri,redirect_origins,permissions,
              approved_at,updated_at
         from agent_connections where id=$1`,
      [connectionId],
    )).rows[0];
    expect(after).toEqual(before);
    expect((await pool.query(
      "select count(*)::int as count from agent_connections where user_id=$1 and oauth_client_id=$2",
      [USER, CLIENT],
    )).rows[0].count).toBe(1);

    const audit = (await pool.query(
      `select actor_user_id,connection_id,event_type,target_type,target_id,metadata,request_id
         from security_audit_events where event_type='oauth.authorization.denied'`,
    )).rows;
    expect(audit).toEqual([{
      actor_user_id: USER,
      connection_id: null,
      event_type: "oauth.authorization.denied",
      target_type: "oauth_client",
      target_id: CLIENT,
      metadata: {
        clientName: "Identity Test Client",
        clientOrigin: "https://client.example",
        redirectOrigin: "http://127.0.0.1:8787",
        permissions: ["skills:read", "context:read", "executions:write"],
      },
      request_id: requestId,
    }]);
    const serializedAudit = JSON.stringify(audit);
    expect(serializedAudit).not.toContain("auth_1");
    expect(serializedAudit).not.toContain("callback");
    expect(serializedAudit).not.toContain("must-not-be-audited");
    expect(serializedAudit).not.toContain("attacker.example");
    expect(serializedAudit).not.toContain(suppliedRequestId);
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: "domain_metric",
        metric: "oauth_consent",
        outcome: "denied",
        category: "authorization_request",
        tenant_id: TENANT,
      }),
    ]));
    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain("must-not-be-audited");
    expect(serializedLogs).not.toContain("attacker.example");
  });

  it("categorizes an authorization request that Supabase reports invalid or expired", async () => {
    const logs: OperationalLog[] = [];
    const response = await client(true, "email", (entry) => logs.push(entry)).inject({
      method: "POST",
      url: "/api/oauth/grants/prepare?state=expired-query-secret",
      headers: auth,
      payload: {
        authorizationId: "expired_authorization_secret",
        tenantId: TENANT,
        verifier: "pkce-verifier-secret",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/invalid or expired/i);
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: "domain_metric",
        metric: "oauth_consent",
        outcome: "invalid_or_expired",
        category: "authorization_request",
        tenant_id: TENANT,
      }),
    ]));
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain("expired_authorization_secret");
    expect(serialized).not.toContain("expired-query-secret");
    expect(serialized).not.toContain("pkce-verifier-secret");
  });

  it("prevents viewers from preparing agent grants", async () => {
    await pool.query(
      "update tenant_memberships set role='viewer' where tenant_id=$1 and user_id=$2",
      [TENANT, USER],
    );
    const response = await client().inject({
      method: "POST", url: "/api/oauth/grants/prepare", headers: auth,
      payload: { authorizationId: "auth_1", tenantId: TENANT },
    });
    expect(response.statusCode).toBe(403);
  });

  it("returns a stable conflict when pending account deletion blocks a replacement grant", async () => {
    const api = client();
    const scheduled = await api.inject({
      method: "POST",
      url: "/api/privacy/deletion-requests",
      headers: auth,
      payload: { scope: "account" },
    });
    expect(scheduled.statusCode).toBe(201);

    const response = await api.inject({
      method: "POST",
      url: "/api/oauth/grants/prepare",
      headers: auth,
      payload: { authorizationId: "auth_1", tenantId: TENANT },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "Cancel the pending account-deletion request before connecting another agent.",
      code: "account_deletion_pending",
    });
  });

  it("fails closed for new approvals without disabling the denial audit path", async () => {
    const api = client(false);
    const prepared = await api.inject({
      method: "POST",
      url: "/api/oauth/grants/prepare",
      headers: auth,
      payload: { authorizationId: "auth_1", tenantId: TENANT },
    });
    expect(prepared.statusCode).toBe(503);
    expect(prepared.json().error).toMatch(/paused/i);
    expect((await pool.query(
      "select count(*)::int as count from agent_connections where user_id=$1",
      [USER],
    )).rows[0].count).toBe(0);

    const denied = await api.inject({
      method: "POST",
      url: "/api/oauth/authorizations/deny",
      headers: auth,
      payload: { authorizationId: "auth_1", tenantId: TENANT },
    });
    expect(denied.statusCode).toBe(200);
    expect(denied.json()).toEqual({ recorded: true });
  });
});
