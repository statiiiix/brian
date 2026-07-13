import { beforeAll, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";

vi.mock("../skills/repo.js", () => ({
  NotFoundError: class NotFoundError extends Error {},
  createSkill: vi.fn(),
  findSkillsWithDistance: vi.fn(async () => []),
  getSkill: vi.fn(async () => null),
  listSkills: vi.fn(async () => []),
  listVersions: vi.fn(async () => []),
  setStatus: vi.fn(),
  updateSkill: vi.fn(),
}));
vi.mock("../context/repo.js", () => ({
  createContext: vi.fn(),
  findContextWithDistance: vi.fn(async () => null),
  getContext: vi.fn(async () => null),
  listContext: vi.fn(async () => []),
  listContextVersions: vi.fn(async () => []),
  retireContext: vi.fn(),
  updateContext: vi.fn(),
}));
import { buildApp } from "../api/app.js";
import { testClient } from "../test/http.js";
import { MCP_RESOURCE, MCP_RESOURCE_METADATA } from "./constants.js";
import { permissionsForOAuthScope } from "./permissions.js";
import { signUserToken } from "./jwt.js";
import type { McpPrincipal, PrincipalStore } from "./principal.js";
import type { HttpLogSink, OperationalLog } from "../operations/http.js";

const USER = "10000000-0000-0000-0000-000000000001";
const TENANT = "20000000-0000-0000-0000-000000000002";
const CONNECTION = "30000000-0000-0000-0000-000000000003";
const ISSUER = "https://x.supabase.co/auth/v1";
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const dashboardToken = `${b64({ alg: "ES256" })}.${b64({ iss: ISSUER, sub: USER, aud: "authenticated" })}.sig`;

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  },
};

const mcpHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

function mcpResponse(body: string): any {
  const eventData = body.split(/\r?\n/)
    .find((line) => line.startsWith("data:"))
    ?.slice(5).trim();
  return JSON.parse(eventData || body);
}

describe("route-specific authentication", () => {
  let privateKey: CryptoKey;
  let publicJwk: JWK;

  beforeAll(async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    privateKey = pair.privateKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "key-1", alg: "ES256", use: "sig" };
  });

  const principal: McpPrincipal = {
    kind: "mcp",
    tenantId: TENANT,
    userId: USER,
    clientId: "client-1",
    connectionId: CONNECTION,
    role: "expert",
    permissions: ["skills:read", "context:read", "executions:write"],
  };

  const store = (active = true): PrincipalStore => ({
    resolveDashboard: vi.fn(async (userId) => active ? ({
      tenantId: TENANT, userId, role: "expert" as const, membershipId: "40000000-0000-0000-0000-000000000004",
    }) : null),
    listMemberships: vi.fn(async () => []),
    resolveMcp: vi.fn(async () => active ? principal : null),
    resolveLegacy: vi.fn(async () => null),
    touchConnection: vi.fn(async () => undefined),
  });

  const app = (
    active = true,
    mcpOAuthEnabled = true,
    httpLogSink: HttpLogSink | false = false,
  ) => testClient(buildApp({
    authRequired: true,
    authToken: "legacy-static",
    legacyAgentTokensEnabled: true,
    principalStore: store(active),
    supabaseAuth: {
      url: "https://x.supabase.co",
      anonKey: "anon",
      fetchFn: vi.fn(async () => new Response(JSON.stringify({ id: USER, email: "user@example.com" }))),
    },
    mcpOAuth: { issuer: ISSUER, jwks: { keys: [publicJwk] } },
    mcpOAuthEnabled,
    httpLogSink,
  }));

  const mcpToken = async () => new SignJWT({
    aud: MCP_RESOURCE,
    client_id: principal.clientId,
    tenant_id: TENANT,
    brian_connection_id: CONNECTION,
    brian_role: "expert",
    brian_permissions: principal.permissions,
    brian_resource: MCP_RESOURCE,
    brian_token_type: "mcp",
  })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(ISSUER)
    .setSubject(USER)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  const mcpTokenWithoutTenant = async () => new SignJWT({
    aud: MCP_RESOURCE,
    client_id: principal.clientId,
    brian_connection_id: CONNECTION,
    brian_role: "expert",
    brian_permissions: principal.permissions,
    brian_resource: MCP_RESOURCE,
    brian_token_type: "mcp",
  })
    .setProtectedHeader({ alg: "ES256", kid: "key-1" })
    .setIssuer(ISSUER)
    .setSubject(USER)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  it("serves RFC 9728 metadata and challenges unauthenticated MCP requests", async () => {
    const client = app();
    const metadata = await client.inject({ method: "GET", url: "/.well-known/oauth-protected-resource/mcp" });
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json().resource).toBe(MCP_RESOURCE);
    const response = await client.inject({ method: "POST", url: "/mcp", headers: mcpHeaders, payload: initialize });
    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toContain(`resource_metadata="${MCP_RESOURCE_METADATA}"`);
  });

  it("accepts an exact-resource MCP token and rechecks the current grant", async () => {
    const raw = await mcpToken();
    const ok = await app().inject({
      method: "POST", url: "/mcp",
      headers: { ...mcpHeaders, authorization: `Bearer ${raw}` }, payload: initialize,
    });
    expect(ok.statusCode).toBe(200);
    const listed = await app().inject({
      method: "POST", url: "/mcp",
      headers: { ...mcpHeaders, authorization: `Bearer ${raw}` },
      payload: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    });
    expect(listed.statusCode).toBe(200);
    const toolNames = mcpResponse(listed.body).result.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining(["find_skill", "get_skill", "find_context", "log_execution"]));
    expect(toolNames).not.toEqual(expect.arrayContaining(["capture", "issue_refund", "send_email"]));
    for (const hiddenTool of ["capture", "issue_refund", "send_email"]) {
      const direct = await app().inject({
        method: "POST", url: "/mcp",
        headers: { ...mcpHeaders, authorization: `Bearer ${raw}` },
        payload: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: hiddenTool, arguments: {} } },
      });
      expect(direct.statusCode).toBe(200);
      const directBody = mcpResponse(direct.body);
      expect(directBody.error ?? directBody.result?.isError).toBeTruthy();
      expect(JSON.stringify(directBody)).not.toContain("body-secret");
    }
    const revoked = await app(false).inject({
      method: "POST", url: "/mcp",
      headers: { ...mcpHeaders, authorization: `Bearer ${raw}` }, payload: initialize,
    });
    expect(revoked.statusCode).toBe(401);
  });

  it("uses MCP_OAUTH_ENABLED only as the existing-token validation hard stop", async () => {
    const raw = await mcpToken();
    const disabled = await app(true, false).inject({
      method: "POST", url: "/mcp",
      headers: { ...mcpHeaders, authorization: `Bearer ${raw}` }, payload: initialize,
    });
    expect(disabled.statusCode).toBe(401);
    expect(disabled.headers["www-authenticate"]).toContain("invalid_token");
  });

  it("emits a bounded failure category without logging bearer-token material", async () => {
    const logs: OperationalLog[] = [];
    const wrongAudience = await new SignJWT({
      aud: "authenticated",
      client_id: principal.clientId,
      tenant_id: TENANT,
      brian_connection_id: CONNECTION,
      brian_role: "expert",
      brian_permissions: principal.permissions,
      brian_resource: MCP_RESOURCE,
      brian_token_type: "mcp",
    })
      .setProtectedHeader({ alg: "ES256", kid: "key-1" })
      .setIssuer(ISSUER)
      .setSubject(USER)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const response = await app(true, true, (event) => logs.push(event)).inject({
      method: "POST",
      url: "/mcp?secret=must-not-appear",
      headers: { ...mcpHeaders, authorization: `Bearer ${wrongAudience}` },
      payload: initialize,
    });
    expect(response.statusCode).toBe(401);
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "auth_failure", error_category: "wrong_audience", path: "/mcp" }),
    ]));
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(wrongAudience);
    expect(serialized).not.toContain("must-not-appear");
  });

  it("emits a resolver denial metric without copying verified token claims", async () => {
    const logs: OperationalLog[] = [];
    const raw = await mcpToken();
    const response = await app(false, true, (event) => logs.push(event)).inject({
      method: "POST",
      url: "/mcp?state=resolver-state-secret",
      headers: { ...mcpHeaders, authorization: `Bearer ${raw}` },
      payload: { ...initialize, password: "resolver-body-secret" },
    });
    expect(response.statusCode).toBe(401);
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: "domain_metric",
        metric: "principal_resolution",
        outcome: "denied",
        category: "mcp_grant_or_membership",
        route_class: "mcp",
        tenant_id: null,
        connection_id: null,
      }),
    ]));
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(raw);
    expect(serialized).not.toContain(TENANT);
    expect(serialized).not.toContain(CONNECTION);
    expect(serialized).not.toContain("resolver-state-secret");
    expect(serialized).not.toContain("resolver-body-secret");
  });

  it("records a tenant-boundary denial without logging the requested tenant or body", async () => {
    const logs: OperationalLog[] = [];
    const scopedStore = store(true);
    scopedStore.resolveDashboard = vi.fn(async (userId, requestedTenantId) => requestedTenantId
      ? null
      : {
          tenantId: TENANT,
          userId,
          role: "expert" as const,
          membershipId: "40000000-0000-0000-0000-000000000004",
        });
    const client = testClient(buildApp({
      authRequired: true,
      principalStore: scopedStore,
      supabaseAuth: {
        url: "https://x.supabase.co",
        anonKey: "anon",
        fetchFn: vi.fn(async () => new Response(JSON.stringify({ id: USER, email: "user@example.com" }))),
      },
      mcpOAuth: null,
      httpLogSink: (event) => logs.push(event),
    }));
    const requestedTenant = "90000000-0000-0000-0000-000000000009";
    const response = await client.inject({
      method: "POST",
      url: "/api/tenants/switch?state=tenant-state-secret",
      headers: { authorization: `Bearer ${dashboardToken}` },
      payload: { tenantId: requestedTenant, password: "tenant-body-secret" },
    });
    expect(response.statusCode).toBe(403);
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: "domain_metric",
        metric: "tenant_authorization",
        outcome: "denied",
        category: "requested_tenant_not_accessible",
        tenant_id: TENANT,
      }),
    ]));
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(requestedTenant);
    expect(serialized).not.toContain("tenant-state-secret");
    expect(serialized).not.toContain("tenant-body-secret");
  });

  it("rejects dashboard tokens at MCP and MCP tokens on dashboard routes", async () => {
    const client = app();
    const dashboardAtMcp = await client.inject({
      method: "POST", url: "/mcp",
      headers: { ...mcpHeaders, authorization: `Bearer ${dashboardToken}` }, payload: initialize,
    });
    expect(dashboardAtMcp.statusCode).toBe(401);
    const mcpAtDashboard = await client.inject({
      method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${await mcpToken()}` },
    });
    expect(mcpAtDashboard.statusCode).toBe(401);
  });

  it("fails closed when a valid human has no active membership", async () => {
    const response = await app(false).inject({
      method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${dashboardToken}` },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("membership_required");
  });

  it("resolves legacy dashboard JWTs through current membership and ignores their role claim", async () => {
    const raw = signUserToken({ id: USER, email: "legacy@example.test", role: "owner" }, "legacy-secret");
    const activeStore = store(true);
    const accepted = await testClient(buildApp({
      authRequired: true,
      jwtSecret: "legacy-secret",
      principalStore: activeStore,
      supabaseAuth: null,
      mcpOAuth: null,
      httpLogSink: false,
    })).inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${raw}` },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ id: USER, role: "expert" });
    expect(activeStore.resolveDashboard).toHaveBeenCalledWith(USER);

    const denied = await testClient(buildApp({
      authRequired: true,
      jwtSecret: "legacy-secret",
      principalStore: store(false),
      supabaseAuth: null,
      mcpOAuth: null,
      httpLogSink: false,
    })).inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: `Bearer ${raw}` },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("membership_required");
  });

  it("allows a verified membership-less identity only onto the invitation bootstrap route", async () => {
    const response = await app(false).inject({
      method: "POST",
      url: "/api/invitations/accept",
      headers: { authorization: `Bearer ${dashboardToken}` },
      payload: { token: "valid-shape-invitation-token-12345" },
    });
    // With no test database the invitation cannot resolve, but authentication
    // reached the narrow bootstrap handler instead of the membership 403.
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/invitation/i);
  });

  it("keeps the legacy bearer agent-only", async () => {
    const client = app();
    const dashboard = await client.inject({
      method: "GET", url: "/api/skills", headers: { authorization: "Bearer legacy-static" },
    });
    expect(dashboard.statusCode).toBe(401);
    const mcp = await client.inject({
      method: "POST", url: "/mcp",
      headers: { ...mcpHeaders, authorization: "Bearer legacy-static" }, payload: initialize,
    });
    expect(mcp.statusCode).toBe(200);
  });

  it("enforces the complete dashboard, briefing, and MCP token matrix", async () => {
    const validMcp = await mcpToken();
    const missingTenant = await mcpTokenWithoutTenant();
    const scenarios = [
      { name: "dashboard", token: dashboardToken, active: true, legacy: true, expected: [200, 401, 401] },
      { name: "OAuth MCP", token: validMcp, active: true, legacy: true, expected: [401, 200, 200] },
      { name: "legacy on", token: "legacy-static", active: true, legacy: true, expected: [401, 200, 200] },
      { name: "legacy off", token: "legacy-static", active: true, legacy: false, expected: [401, 401, 401] },
      { name: "missing tenant", token: missingTenant, active: true, legacy: true, expected: [401, 401, 401] },
      { name: "revoked grant", token: validMcp, active: false, legacy: true, expected: [401, 401, 401] },
      // Suspended tenants and grants both fail at current-principal resolution;
      // the database resolver has separate migration coverage for each cause.
      { name: "suspended tenant", token: validMcp, active: false, legacy: true, expected: [401, 401, 401] },
    ];

    for (const scenario of scenarios) {
      const client = testClient(buildApp({
        authRequired: true,
        authToken: "legacy-static",
        legacyAgentTokensEnabled: scenario.legacy,
        principalStore: store(scenario.active),
        supabaseAuth: {
          url: "https://x.supabase.co",
          anonKey: "anon",
          fetchFn: vi.fn(async () => new Response(JSON.stringify({ id: USER, email: "user@example.com" }))),
        },
        mcpOAuth: { issuer: ISSUER, jwks: { keys: [publicJwk] } },
        mcpOAuthEnabled: true,
        httpLogSink: false,
      }));
      const authorization = `Bearer ${scenario.token}`;
      const skills = await client.inject({
        method: "GET", url: "/api/skills", headers: { authorization },
      });
      const briefing = await client.inject({
        method: "POST", url: "/api/agent/briefing",
        headers: { authorization, "content-type": "application/json" },
        payload: { query: "refund" },
      });
      const mcp = await client.inject({
        method: "POST", url: "/mcp",
        headers: { ...mcpHeaders, authorization }, payload: initialize,
      });
      expect(
        [skills.statusCode, briefing.statusCode, mcp.statusCode],
        scenario.name,
      ).toEqual(scenario.expected);
      await client.close();
    }
  });
});

describe("OAuth permission derivation", () => {
  it("uses conservative defaults for identity scopes and accepts only known Brian scopes", () => {
    expect(permissionsForOAuthScope("openid email profile")).toEqual([
      "skills:read", "context:read", "executions:write",
    ]);
    expect(permissionsForOAuthScope("email skills:read actions:execute unknown:scope")).toEqual([
      "skills:read", "actions:execute",
    ]);
  });
});
