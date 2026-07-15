import { describe, it, expect, vi } from "vitest";
import {
  getOAuthAuthorizationDetails,
  looksLikeSupabaseToken,
  supabaseAuthFromEnv,
  verifySupabaseToken,
} from "./supabase.js";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (payload: object) => `${b64({ alg: "ES256" })}.${b64(payload)}.sig`;
const dashboardToken = (extra: object = {}) => token({
  iss: "https://x.supabase.co/auth/v1",
  sub: "u1",
  aud: "authenticated",
  ...extra,
});
const cfg = (fetchFn: any) => ({ url: "https://x.supabase.co", anonKey: "anon", fetchFn });

describe("supabaseAuthFromEnv", () => {
  it("reads Supabase Edge Function default secrets through Deno.env", () => {
    const previousUrl = process.env.SUPABASE_URL;
    const previousAnonKey = process.env.SUPABASE_ANON_KEY;
    const previousVitest = process.env.VITEST;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.VITEST;
    vi.stubGlobal("Deno", {
      env: {
        get: (name: string) => ({
          SUPABASE_URL: "https://edge.supabase.co",
          SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_edge" }),
        }[name]),
      },
    });

    try {
      expect(supabaseAuthFromEnv()).toMatchObject({
        url: "https://edge.supabase.co",
        anonKey: "sb_publishable_edge",
        dashboardAudience: "authenticated",
      });
    } finally {
      vi.unstubAllGlobals();
      if (previousUrl === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previousUrl;
      if (previousAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
      else process.env.SUPABASE_ANON_KEY = previousAnonKey;
      if (previousVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = previousVitest;
    }
  });
});

describe("looksLikeSupabaseToken", () => {
  it("matches only three-part JWTs with a Supabase Auth issuer", () => {
    expect(looksLikeSupabaseToken(dashboardToken())).toBe(true);
    expect(looksLikeSupabaseToken(token({ iss: "https://elsewhere.example", sub: "u1" }))).toBe(false);
    expect(looksLikeSupabaseToken("static-agent-bearer")).toBe(false);
    expect(looksLikeSupabaseToken("a.b")).toBe(false);
  });
});

describe("verifySupabaseToken", () => {
  it("returns only server-verified human identity and ignores app_metadata authorization", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: "u1", email: "a@b.c", app_metadata: { tenant_id: "attacker-choice", role: "owner" },
    }), { status: 200 }));
    const raw = dashboardToken();
    const user = await verifySupabaseToken(raw, cfg(fetchFn));
    expect(user).toEqual({ id: "u1", email: "a@b.c" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://x.supabase.co/auth/v1/user");
    expect(init.headers.apikey).toBe("anon");
    expect(init.headers.authorization).toBe(`Bearer ${raw}`);
  });

  it("rejects OAuth-client and wrong-audience tokens before contacting /user", async () => {
    const fetchFn = vi.fn();
    expect(await verifySupabaseToken(dashboardToken({ client_id: "mcp-client" }), cfg(fetchFn))).toBeNull();
    expect(await verifySupabaseToken(dashboardToken({ aud: "https://api.brianthebrain.app/mcp" }), cfg(fetchFn))).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns null on 401 and on network failure", async () => {
    expect(await verifySupabaseToken(dashboardToken(), cfg(async () => new Response("{}", { status: 401 })))).toBeNull();
    expect(await verifySupabaseToken(dashboardToken(), cfg(async () => { throw new Error("down"); }))).toBeNull();
  });
});

describe("getOAuthAuthorizationDetails", () => {
  it("binds authorization details to the verified browser user", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      authorization_id: "auth_123",
      redirect_uri: "http://127.0.0.1:9911/callback",
      scope: "email",
      client: { id: "client-1", name: "Codex", uri: "https://openai.com" },
      user: { id: "u1", email: "a@b.c" },
    })));
    const details = await getOAuthAuthorizationDetails(
      "auth_123", "browser-token", "u1", cfg(fetchFn),
    );
    expect(details?.client.id).toBe("client-1");
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toContain("/oauth/authorizations/auth_123");
  });

  it("rejects another user's or already-consented redirect response", async () => {
    const other = vi.fn(async () => new Response(JSON.stringify({
      authorization_id: "auth_123", redirect_uri: "https://x.test/cb", scope: "email",
      client: { id: "c", name: "Client" }, user: { id: "u2", email: "x@y.z" },
    })));
    expect(await getOAuthAuthorizationDetails("auth_123", "t", "u1", cfg(other))).toBeNull();
    const redirect = vi.fn(async () => new Response(JSON.stringify({ redirect_url: "https://client/cb?code=secret" })));
    expect(await getOAuthAuthorizationDetails("auth_123", "t", "u1", cfg(redirect))).toBeNull();
  });
});
