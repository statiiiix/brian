import { beforeEach, describe, expect, it, vi } from "vitest";

const prepareAgentConnection = vi.hoisted(() => vi.fn());

vi.mock("../identity/repo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../identity/repo.js")>()),
  prepareAgentConnection,
}));

import { buildApp } from "./app.js";
import { testClient } from "../test/http.js";
import type { HumanRole, PrincipalStore } from "../auth/principal.js";

const USER = "13000000-0000-4000-8000-000000000001";
const TENANT = "13000000-0000-4000-8000-000000000010";
const CLIENT = "oauth-policy-client";
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const dashboardToken = `${b64({ alg: "ES256" })}.${b64({
  iss: "https://x.supabase.co/auth/v1",
  sub: USER,
  aud: "authenticated",
})}.sig`;
const auth = { authorization: `Bearer ${dashboardToken}` };

function policyClient(role: HumanRole = "admin", redirectUri = "http://127.0.0.1:8787/callback") {
  const principalStore: PrincipalStore = {
    resolveDashboard: vi.fn(async () => ({
      tenantId: TENANT,
      userId: USER,
      role,
      membershipId: "13000000-0000-4000-8000-000000000020",
    })),
    listMemberships: vi.fn(async () => []),
    resolveMcp: vi.fn(async () => null),
    resolveLegacy: vi.fn(async () => null),
    touchConnection: vi.fn(async () => undefined),
  };
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: USER, email: "oauth-policy@example.test" }));
    }
    if (url.endsWith("/auth/v1/oauth/authorizations/auth_1")) {
      return new Response(JSON.stringify({
        authorization_id: "auth_1",
        redirect_uri: redirectUri,
        scope: "email",
        client: { id: CLIENT, name: "Verified Client", uri: "https://verified.example" },
        user: { id: USER, email: "oauth-policy@example.test" },
      }));
    }
    return new Response("{}", { status: 404 });
  });
  return testClient(buildApp({
    authRequired: true,
    supabaseAuth: { url: "https://x.supabase.co", anonKey: "anon", fetchFn },
    mcpOAuth: null,
    mcpOAuthApprovalsEnabled: true,
    principalStore,
    httpLogSink: false,
  }));
}

async function prepare(permissions: unknown, role: HumanRole = "admin") {
  return policyClient(role).inject({
    method: "POST",
    url: "/api/oauth/grants/prepare",
    headers: auth,
    payload: {
      authorizationId: "auth_1",
      tenantId: TENANT,
      permissions,
      oauthClientId: "attacker-client",
      clientName: "Attacker Name",
      redirectUri: "https://attacker.example/callback",
    },
  });
}

describe("OAuth grant permission boundary", () => {
  beforeEach(() => {
    prepareAgentConnection.mockReset();
    prepareAgentConnection.mockResolvedValue({
      id: "13000000-0000-4000-8000-000000000030",
      permissions: [],
      status: "pending",
    });
  });

  it("accepts exact defaults while retaining Supabase-verified client metadata", async () => {
    const response = await prepare(["skills:read", "context:read", "executions:write"]);
    expect(response.statusCode).toBe(201);
    expect(prepareAgentConnection).toHaveBeenCalledWith(expect.objectContaining({
      clientId: CLIENT,
      clientName: "Verified Client",
      clientUri: "https://verified.example",
      redirectUri: "http://127.0.0.1:8787/callback",
      permissions: ["skills:read", "context:read", "executions:write"],
    }));
  });

  it("uses only the closed default permission set for an older consent page that omits permissions", async () => {
    const response = await prepare(undefined);
    expect(response.statusCode).toBe(201);
    expect(prepareAgentConnection).toHaveBeenCalledWith(expect.objectContaining({
      permissions: ["skills:read", "context:read", "executions:write"],
    }));
  });

  it("accepts explicit knowledge capture for experts", async () => {
    const response = await prepare([
      "skills:read",
      "context:read",
      "executions:write",
      "knowledge:write",
    ], "expert");
    expect(response.statusCode).toBe(201);
    expect(prepareAgentConnection).toHaveBeenCalledWith(expect.objectContaining({
      permissions: ["skills:read", "context:read", "knowledge:write", "executions:write"],
    }));
  });

  it("accepts explicit business actions for an admin", async () => {
    const response = await prepare([
      "skills:read",
      "context:read",
      "executions:write",
      "actions:execute",
    ]);
    expect(response.statusCode).toBe(201);
    expect(prepareAgentConnection).toHaveBeenCalledWith(expect.objectContaining({
      permissions: ["skills:read", "context:read", "executions:write", "actions:execute"],
    }));
  });

  it("rejects business actions for an expert", async () => {
    const response = await prepare([
      "skills:read",
      "context:read",
      "executions:write",
      "actions:execute",
    ], "expert");
    expect(response.statusCode).toBe(403);
    expect(prepareAgentConnection).not.toHaveBeenCalled();
  });

  it("rejects a remote insecure redirect even when Supabase returned it", async () => {
    const response = await policyClient("admin", "http://agent.example/oauth/callback").inject({
      method: "POST",
      url: "/api/oauth/grants/prepare",
      headers: auth,
      payload: {
        authorizationId: "auth_1",
        tenantId: TENANT,
        permissions: ["skills:read", "context:read", "executions:write"],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "unsafe OAuth redirect" });
    expect(prepareAgentConnection).not.toHaveBeenCalled();
  });

  it.each([
    ["skills:read", "non-array"],
    [["skills:read"], "missing defaults"],
    [["skills:read", "context:read", "executions:write", "unknown:permission"], "unknown"],
    [["skills:read", "context:read", "executions:write", "skills:read"], "duplicate"],
  ])("rejects %s permission input (%s)", async (permissions, _label) => {
    const response = await prepare(permissions);
    expect(response.statusCode).toBe(400);
    expect(prepareAgentConnection).not.toHaveBeenCalled();
  });
});
