// Supabase Auth for dashboard humans (SupabaseIntegration.md §5a). The guard
// validates a Supabase access token by asking the auth server itself
// (GET /auth/v1/user) — no local JWKS/secret handling, so it works for both
// legacy HS256 and current asymmetric signing. tenant_id and role live in
// app_metadata (set server-side at user creation; not user-editable).
export interface SupabaseAuthConfig {
  url: string;                 // https://<ref>.supabase.co
  anonKey: string;             // publishable key (apikey header)
  fetchFn?: typeof fetch;      // injectable for tests
}

export interface SupabaseUser {
  id: string;
  email: string;
  role: string;
  tenantId: string | null;
}

// Both are auto-provided on the Supabase Edge runtime; set them in server/.env
// for local use. Null when unconfigured (feature off). Under Vitest the env
// is ignored (like pool.ts's VITEST special-case): tests opt in by passing
// the config to buildApp explicitly, so `buildApp()` stays an open app.
export function supabaseAuthFromEnv(): SupabaseAuthConfig | null {
  if (process.env.VITEST) return null;
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

// Cheap pre-filter so we only pay a network call for tokens that are actually
// Supabase-issued JWTs (iss ends in /auth/v1), not agent bearers or legacy JWTs.
export function looksLikeSupabaseToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.iss === "string" && payload.iss.includes("/auth/v1");
  } catch {
    return false;
  }
}

export async function verifySupabaseToken(
  token: string,
  cfg: SupabaseAuthConfig,
): Promise<SupabaseUser | null> {
  const f = cfg.fetchFn ?? fetch;
  try {
    const res = await f(`${cfg.url}/auth/v1/user`, {
      headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as {
      id?: string; email?: string; app_metadata?: { tenant_id?: string; role?: string };
    };
    if (!u.id || !u.email) return null;
    return {
      id: u.id,
      email: u.email,
      role: u.app_metadata?.role ?? "admin",
      tenantId: u.app_metadata?.tenant_id ?? null,
    };
  } catch {
    return null; // auth server unreachable -> token not accepted
  }
}
