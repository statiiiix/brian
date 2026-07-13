import { decodeJwt } from "jose";

// Human browser-session validation. MCP access tokens use oauthJwt.ts and are
// never accepted by this validator.
export interface SupabaseAuthConfig {
  url: string;
  anonKey: string;
  dashboardAudience?: string;
  fetchFn?: typeof fetch;
}

export interface SupabaseUser {
  id: string;
  email: string;
}

export interface OAuthAuthorizationDetails {
  authorization_id: string;
  redirect_uri: string;
  scope: string;
  client: {
    id: string;
    name: string;
    uri?: string | null;
    logo_uri?: string | null;
  };
  user: { id: string; email: string };
}

export function supabaseAuthFromEnv(): SupabaseAuthConfig | null {
  if (process.env.VITEST) return null;
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  return url && anonKey
    ? { url, anonKey, dashboardAudience: process.env.DASHBOARD_JWT_AUDIENCE ?? "authenticated" }
    : null;
}

export function looksLikeSupabaseToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = decodeJwt(token);
    return typeof payload.iss === "string" && payload.iss.endsWith("/auth/v1");
  } catch {
    return false;
  }
}

function hasExpectedDashboardClaims(token: string, cfg: SupabaseAuthConfig): boolean {
  try {
    const claims = decodeJwt(token);
    const issuer = `${cfg.url.replace(/\/$/, "")}/auth/v1`;
    const expectedAudience = cfg.dashboardAudience ?? "authenticated";
    return claims.iss === issuer
      && claims.aud === expectedAudience
      && typeof claims.sub === "string"
      && claims.client_id === undefined
      && claims.brian_token_type === undefined;
  } catch {
    return false;
  }
}

export async function verifyDashboardToken(
  token: string,
  cfg: SupabaseAuthConfig,
): Promise<SupabaseUser | null> {
  if (!hasExpectedDashboardClaims(token, cfg)) return null;
  const subject = decodeJwt(token).sub;
  const f = cfg.fetchFn ?? fetch;
  try {
    const res = await f(`${cfg.url.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: cfg.anonKey, authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string; email?: string };
    if (!user.id || !user.email || user.id !== subject) return null;
    return { id: user.id, email: user.email };
  } catch {
    return null;
  }
}

// Compatibility export for existing callers. It intentionally follows the
// dashboard-only policy and no longer reads authorization from app_metadata.
export const verifySupabaseToken = verifyDashboardToken;

export async function getOAuthAuthorizationDetails(
  authorizationId: string,
  accessToken: string,
  expectedUserId: string,
  cfg: SupabaseAuthConfig,
): Promise<OAuthAuthorizationDetails | null> {
  if (!authorizationId || authorizationId.length > 512 || !/^[-A-Za-z0-9_.~]+$/.test(authorizationId)) {
    return null;
  }
  const f = cfg.fetchFn ?? fetch;
  try {
    const res = await f(
      `${cfg.url.replace(/\/$/, "")}/auth/v1/oauth/authorizations/${encodeURIComponent(authorizationId)}`,
      { headers: { apikey: cfg.anonKey, authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<OAuthAuthorizationDetails> & { redirect_url?: string };
    if (data.redirect_url || data.authorization_id !== authorizationId) return null;
    if (data.user?.id !== expectedUserId || !data.client?.id || !data.client.name || !data.redirect_uri) return null;
    return data as OAuthAuthorizationDetails;
  } catch {
    return null;
  }
}
