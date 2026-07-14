import { describe, expect, it, vi } from "vitest";

import { buildApp } from "./app.js";
import { testClient } from "../test/http.js";
import type { OperationalLog } from "../operations/http.js";

describe("legacy auth login configuration", () => {
  it("exposes only boolean signup and MCP OAuth release markers without authentication", async () => {
    const disabled = testClient(buildApp({
      authRequired: true,
      authToken: "static-tok",
      supabaseAuth: null,
      publicSignupEnabled: false,
    }));
    const off = await disabled.inject({ method: "GET", url: "/api/public/config" });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toEqual({
      publicSignup: false,
      mcpOAuth: true,
      mcpOAuthApprovals: false,
      mcpDcr: false,
    });
    await disabled.close();

    const enabled = testClient(buildApp({
      authRequired: true,
      authToken: "static-tok",
      supabaseAuth: null,
      publicSignupEnabled: true,
      mcpOAuthEnabled: true,
      mcpOAuthApprovalsEnabled: true,
      mcpDcrEnabled: true,
    }));
    const on = await enabled.inject({ method: "GET", url: "/api/public/config" });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toEqual({
      publicSignup: true,
      mcpOAuth: true,
      mcpOAuthApprovals: true,
      mcpDcr: true,
    });
    await enabled.close();
  });

  it("keeps DCR, new approvals, existing OAuth validation, and signup independent", async () => {
    const app = testClient(buildApp({
      authRequired: true,
      supabaseAuth: null,
      publicSignupEnabled: false,
      mcpOAuthEnabled: true,
      mcpOAuthApprovalsEnabled: false,
      mcpDcrEnabled: true,
    }));
    const response = await app.inject({ method: "GET", url: "/api/public/config" });
    expect(response.json()).toEqual({
      publicSignup: false,
      mcpOAuth: true,
      mcpOAuthApprovals: false,
      mcpDcr: true,
    });
    await app.close();
  });

  it("keeps invitation preflight public, boolean-only, and burst-limited", async () => {
    const logs: OperationalLog[] = [];
    const app = testClient(buildApp({
      authRequired: true,
      authToken: "static-tok",
      supabaseAuth: null,
      signupPreflightRateLimits: { preAuthRequests: 1, windowMs: 60_000, maxKeys: 10 },
      httpLogSink: (entry) => logs.push(entry),
    }));
    const first = await app.inject({
      method: "POST", url: "/api/public/invitations/validate?token=query-secret",
      payload: { email: 42, token: { raw: "body-token-secret" }, password: "password-secret" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ valid: false });
    expect(logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: "domain_metric",
        metric: "invitation",
        outcome: "invalid",
        category: "invitation_preflight",
        route_class: "public",
      }),
      expect.objectContaining({
        event: "http_request",
        path: "/api/public/invitations/validate",
        route_class: "public",
      }),
    ]));
    expect(JSON.stringify(logs)).not.toContain("query-secret");
    expect(JSON.stringify(logs)).not.toContain("body-token-secret");
    expect(JSON.stringify(logs)).not.toContain("password-secret");
    const limited = await app.inject({
      method: "POST", url: "/api/public/invitations/validate", payload: {},
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: "rate_limited" });
    expect(limited.headers["retry-after"]).toBeDefined();
    await app.close();
  });

  it("keeps the password-proxy endpoint disabled by default", async () => {
    const a = testClient(buildApp({ authToken: "static-tok", jwtSecret: null, supabaseAuth: null }));
    const res = await a.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "founder@test.io", password: "hunter22" },
    });

    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({
      error: "password login moved to the Supabase browser client",
      code: "legacy_password_login_disabled",
    });
    await a.close();
  });

  it("uses Supabase Auth on /api/auth/login when Supabase is configured", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      access_token: "supabase-token",
      user: {
        id: "u1",
        email: "founder@test.io",
        app_metadata: { role: "admin" },
      },
    }), { status: 200 }));
    const a = testClient(buildApp({
      authToken: "static-tok",
      jwtSecret: null,
      legacyPasswordLoginEnabled: true,
      supabaseAuth: { url: "https://x.supabase.co", anonKey: "anon", fetchFn },
    }));

    const res = await a.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "founder@test.io", password: "hunter22" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      token: "supabase-token",
      user: { id: "u1", email: "founder@test.io", role: "admin" },
    });
    expect(fetchFn).toHaveBeenCalledWith(
      "https://x.supabase.co/auth/v1/token?grant_type=password",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json", apikey: "anon" },
        body: JSON.stringify({ email: "founder@test.io", password: "hunter22" }),
      }),
    );
    await a.close();
  });

  it("keeps Supabase confirmation failures readable", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      error_description: "Email not confirmed",
    }), { status: 400 }));
    const a = testClient(buildApp({
      authToken: "static-tok",
      jwtSecret: null,
      legacyPasswordLoginEnabled: true,
      supabaseAuth: { url: "https://x.supabase.co", anonKey: "anon", fetchFn },
    }));

    const res = await a.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "founder@test.io", password: "hunter22" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Please confirm your email before logging in." });
    await a.close();
  });
});
