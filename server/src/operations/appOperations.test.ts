import { describe, expect, it } from "vitest";
import { buildApp } from "../api/app.js";
import { testClient } from "../test/http.js";
import type { OperationalLog } from "./http.js";

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "rate-test", version: "1" },
  },
};

const mcpHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "x-forwarded-for": "203.0.113.10",
};

describe("application operations middleware", () => {
  it("limits unauthenticated MCP bursts by trusted client address", async () => {
    const client = testClient(buildApp({
      authRequired: true,
      authToken: "legacy-test-token",
      mcpRateLimits: { preAuthRequests: 1, authenticatedRequests: 10, windowMs: 60_000 },
      httpLogSink: false,
    }));
    const first = await client.inject({ method: "POST", url: "/mcp", headers: mcpHeaders, payload: initialize });
    expect(first.statusCode).toBe(401);
    const second = await client.inject({ method: "POST", url: "/mcp", headers: mcpHeaders, payload: initialize });
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBeDefined();
  });

  it("limits authenticated MCP calls by resolved tenant or connection", async () => {
    const client = testClient(buildApp({
      authRequired: true,
      authToken: "legacy-test-token",
      legacyAgentTokensEnabled: true,
      mcpRateLimits: { preAuthRequests: 10, authenticatedRequests: 1, windowMs: 60_000 },
      httpLogSink: false,
    }));
    const headers = { ...mcpHeaders, authorization: "Bearer legacy-test-token" };
    const first = await client.inject({ method: "POST", url: "/mcp", headers, payload: initialize });
    expect(first.statusCode).toBe(200);
    const second = await client.inject({ method: "POST", url: "/mcp", headers, payload: initialize });
    expect(second.statusCode).toBe(429);
  });

  it("emits discovery and sanitized MCP initialize metrics without request secrets", async () => {
    const logs: OperationalLog[] = [];
    const client = testClient(buildApp({
      authRequired: true,
      authToken: "legacy-test-token",
      legacyAgentTokensEnabled: true,
      mcpRateLimits: false,
      httpLogSink: (entry) => logs.push(entry),
    }));

    const discovery = await client.inject({
      method: "GET",
      url: "/.well-known/oauth-protected-resource/mcp?state=discovery-secret",
      headers: {
        authorization: "Bearer discovery-bearer-secret",
        "x-request-id": "Bearer-caller-request-id-secret",
      },
    });
    expect(discovery.statusCode).toBe(200);

    const response = await client.inject({
      method: "POST",
      url: "/mcp?code=callback-code-secret",
      headers: { ...mcpHeaders, authorization: "Bearer legacy-test-token" },
      payload: {
        ...initialize,
        params: {
          ...initialize.params,
          clientInfo: { name: "Claude Desktop", version: "1.2.3" },
          password: "body-password-secret",
          pkceVerifier: "body-pkce-secret",
        },
      },
    });
    expect(response.statusCode).toBe(200);

    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: "domain_metric",
        metric: "oauth_discovery",
        outcome: "success",
        category: "protected_resource_metadata",
        route_class: "public",
      }),
      expect.objectContaining({
        event: "domain_metric",
        metric: "mcp_initialize",
        outcome: "success",
        category: "mcp_request",
        route_class: "mcp",
        client_name: "Claude Desktop",
        client_version: "1.2.3",
      }),
    ]));
    const serialized = JSON.stringify(logs);
    for (const secret of [
      "discovery-secret",
      "discovery-bearer-secret",
      "Bearer-caller-request-id-secret",
      "callback-code-secret",
      "legacy-test-token",
      "body-password-secret",
      "body-pkce-secret",
    ]) expect(serialized).not.toContain(secret);
  });
});
