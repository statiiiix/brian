import { describe, it, expect, vi } from "vitest";
import { looksLikeSupabaseToken, verifySupabaseToken } from "./supabase.js";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const supabaseishToken = (iss: string) => `${b64({ alg: "ES256" })}.${b64({ iss, sub: "u1" })}.sig`;

describe("looksLikeSupabaseToken", () => {
  it("matches only three-part JWTs with a supabase auth issuer", () => {
    expect(looksLikeSupabaseToken(supabaseishToken("https://x.supabase.co/auth/v1"))).toBe(true);
    expect(looksLikeSupabaseToken(supabaseishToken("https://elsewhere.example"))).toBe(false);
    expect(looksLikeSupabaseToken("static-agent-bearer")).toBe(false);
    expect(looksLikeSupabaseToken("a.b")).toBe(false);
  });
});

describe("verifySupabaseToken", () => {
  const cfg = (fetchFn: any) => ({ url: "https://x.supabase.co", anonKey: "anon", fetchFn });

  it("returns the user with tenant/role from app_metadata on 200", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      id: "u1", email: "a@b.c", app_metadata: { tenant_id: "t-1", role: "expert" },
    }), { status: 200 }));
    const u = await verifySupabaseToken("tok", cfg(fetchFn));
    expect(u).toEqual({ id: "u1", email: "a@b.c", role: "expert", tenantId: "t-1" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://x.supabase.co/auth/v1/user");
    expect(init.headers.apikey).toBe("anon");
    expect(init.headers.authorization).toBe("Bearer tok");
  });

  it("defaults role=admin, tenantId=null when app_metadata is empty", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ id: "u1", email: "a@b.c" }), { status: 200 }));
    const u = await verifySupabaseToken("tok", cfg(fetchFn));
    expect(u).toEqual({ id: "u1", email: "a@b.c", role: "admin", tenantId: null });
  });

  it("returns null on 401 and on network failure", async () => {
    expect(await verifySupabaseToken("tok", cfg(async () => new Response("{}", { status: 401 })))).toBeNull();
    expect(await verifySupabaseToken("tok", cfg(async () => { throw new Error("down"); }))).toBeNull();
  });
});
