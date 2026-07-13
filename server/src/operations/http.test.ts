import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.js";
import {
  FixedWindowRateLimiter,
  mcpAuthenticatedRateLimitKey,
  mcpPreAuthRateLimitKey,
  rateLimitMiddleware,
  requestLogMiddleware,
} from "./http.js";

describe("HTTP operations", () => {
  it("limits a fixed-window key and resets without retaining excess keys", () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter(
      { requests: 2, windowMs: 1_000, maxKeys: 2 },
      () => now,
    );
    expect(limiter.take("a")).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.take("a")).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.take("a")).toMatchObject({ allowed: false, remaining: 0 });
    now = 2_001;
    expect(limiter.take("a")).toMatchObject({ allowed: true, remaining: 1 });
    limiter.take("b");
    limiter.take("c");
    expect(limiter.take("c")).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("uses a trusted address before auth and connection or tenant after auth", async () => {
    const app = new Hono<AuthEnv>();
    app.get("/keys", (c) => {
      c.set("principal", {
        kind: "mcp",
        tenantId: "tenant-a",
        userId: "user-a",
        clientId: "client-a",
        connectionId: "connection-a",
        role: "admin",
        permissions: [],
      });
      return c.json({
        pre: mcpPreAuthRateLimitKey(c),
        post: mcpAuthenticatedRateLimitKey(c),
      });
    });
    const res = await app.request("/keys", { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } });
    await expect(res.json()).resolves.toEqual({
      pre: "ip:203.0.113.9",
      post: "connection:connection-a",
    });
  });

  it("returns a bounded 429 response with retry headers", async () => {
    const app = new Hono<AuthEnv>();
    const limiter = new FixedWindowRateLimiter({ requests: 1, windowMs: 60_000 }, () => 5_000);
    app.use("/mcp", rateLimitMiddleware(limiter, () => "ip:test"));
    app.post("/mcp", (c) => c.json({ ok: true }));
    expect((await app.request("/mcp", { method: "POST" })).status).toBe(200);
    const blocked = await app.request("/mcp", { method: "POST" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    await expect(blocked.json()).resolves.toEqual({ error: "rate_limited" });
  });

  it("logs categorical request data without headers, query values, or bodies", async () => {
    const sink = vi.fn();
    let now = 1_700_000_000_000;
    const app = new Hono<AuthEnv>();
    app.use("*", async (c, next) => {
      c.set("requestId", "request-1");
      await next();
    });
    app.use("*", requestLogMiddleware(sink, () => now += 7));
    app.post("/api/connectors/google/callback", (c) => c.json({ ok: true }));
    const response = await app.request(
      "/api/connectors/google/callback?code=secret-code&state=secret-state",
      {
        method: "POST",
        headers: { authorization: "Bearer secret-token" },
        body: JSON.stringify({ password: "secret-password" }),
      },
    );
    expect(response.status).toBe(200);
    expect(sink).toHaveBeenCalledTimes(1);
    const entry = sink.mock.calls[0][0];
    expect(entry).toMatchObject({
      event: "http_request",
      request_id: "request-1",
      route_class: "public",
      path: "/api/connectors/google/callback",
      status: 200,
      tenant_id: null,
      connection_id: null,
      error_category: null,
      latency_ms: 7,
    });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("secret-code");
    expect(serialized).not.toContain("secret-state");
    expect(serialized).not.toContain("secret-password");
  });

  it("keeps invitation and post-suspension privacy routes in their narrow classes", async () => {
    const logs: any[] = [];
    const app = new Hono<AuthEnv>();
    app.use("*", requestLogMiddleware((entry) => logs.push(entry)));
    app.all("*", (c) => c.json({ ok: true }));

    await app.request("/api/public/invitations/validate", { method: "POST" });
    await app.request("/api/invitations/accept", { method: "POST" });
    await app.request("/api/privacy/deletion-requests", { method: "GET" });
    await app.request("/api/privacy/deletion-requests", { method: "POST" });
    await app.request("/api/privacy/deletion-requests/10000000-0000-0000-0000-000000000001", {
      method: "DELETE",
    });

    expect(logs.map((entry) => entry.route_class)).toEqual([
      "public", "bootstrap", "bootstrap", "human", "bootstrap",
    ]);
  });
});
