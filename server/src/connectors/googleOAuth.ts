import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { secret } from "../config/secrets.js";
import { db, tenantOrFounding } from "../db/tenant.js";
import { pool } from "../db/pool.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

type SecretReader = (key: string) => Promise<string | null | undefined>;

async function firstSecret(keys: string[], read: SecretReader): Promise<string | null> {
  for (const key of keys) {
    const value = await read(key);
    if (value) return value;
  }
  return null;
}

export async function googleOAuthConfig(read: SecretReader = secret): Promise<GoogleOAuthConfig | null> {
  const [clientId, clientSecret, explicitRedirect, baseUrl] = await Promise.all([
    firstSecret(["GOOGLE_CLIENT_ID", "GMAIL_CLIENT_ID"], read),
    firstSecret(["GOOGLE_CLIENT_SECRET", "GMAIL_CLIENT_SECRET"], read),
    firstSecret(["GOOGLE_OAUTH_REDIRECT_URI", "GMAIL_OAUTH_REDIRECT_URI"], read),
    firstSecret(["BRIAN_OAUTH_BASE_URL", "BRIAN_URL"], read),
  ]);
  const redirectUri = explicitRedirect ?? (baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/api/connectors/google/callback`
    : null);
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export async function createOAuthState(
  provider: string,
  connectorTypes: string[],
  metadata: Record<string, string> = {},
  p = db(),
): Promise<string> {
  const nonce = randomBytes(32).toString("hex");
  // Metadata is non-secret routing context (for example a Zendesk subdomain).
  // Its integrity is protected because the complete state is hashed in the DB.
  const encoded = Object.keys(metadata).length
    ? `.${Buffer.from(JSON.stringify(metadata)).toString("base64url")}`
    : "";
  const state = `${nonce}${encoded}`;
  await p.query(
    `insert into oauth_states (tenant_id, provider, connector_types, state_hash, expires_at)
     values ($1,$2,$3::jsonb,$4,now() + interval '10 minutes')`,
    [tenantOrFounding(), provider, JSON.stringify(connectorTypes), hashOAuthState(state)],
  );
  return state;
}

export async function consumeOAuthState(state: string): Promise<{
  tenantId: string;
  provider: string;
  connectorTypes: string[];
  metadata: Record<string, string>;
} | null> {
  const { rows } = await pool.query(
    `update oauth_states
        set used_at=now()
      where state_hash=$1 and used_at is null and expires_at > now()
      returning tenant_id, provider, connector_types`,
    [hashOAuthState(state)],
  );
  const row = rows[0] as { tenant_id: string; provider: string; connector_types: string[] } | undefined;
  if (!row) return null;
  let metadata: Record<string, string> = {};
  const encoded = state.split(".")[1];
  if (encoded) {
    try {
      const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) metadata = decoded;
    } catch {
      metadata = {};
    }
  }
  return { tenantId: row.tenant_id, provider: row.provider, connectorTypes: row.connector_types, metadata };
}

export function googleAuthorizationUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: GOOGLE_SCOPES.join(" "),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCode(
  code: string,
  config: GoogleOAuthConfig,
  fetchFn: typeof fetch = fetch,
): Promise<GoogleTokenResponse> {
  const response = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  const data = await response.json().catch(() => ({})) as Partial<GoogleTokenResponse> & { error?: string; error_description?: string };
  if (!response.ok || !data.access_token) {
    throw new Error(`Google OAuth exchange failed: ${data.error_description ?? data.error ?? response.status}`);
  }
  return data as GoogleTokenResponse;
}
