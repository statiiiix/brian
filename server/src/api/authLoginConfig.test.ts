import { describe, expect, it, vi } from "vitest";

import { buildApp } from "./app.js";
import { testClient } from "../test/http.js";

describe("legacy auth login configuration", () => {
  it("does not report an internal error when legacy JWT auth is disabled", async () => {
    const a = testClient(buildApp({ authToken: "static-tok", jwtSecret: null, supabaseAuth: null }));
    const res = await a.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "founder@test.io", password: "hunter22" },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: "legacy password login is not configured; use Supabase Auth",
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
