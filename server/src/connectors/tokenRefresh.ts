import {
  isGenericOAuthProvider,
  oauthProviderConfig,
  refreshOAuthToken,
} from "./oauthProviders.js";
import { upsertConnector } from "./repo.js";
import type { ConnectorRow } from "./types.js";

// Refresh no earlier than this before expiry, so a token can't die mid-sync.
const EXPIRY_MARGIN_MS = 5 * 60_000;

// Absolute expiry of an OAuth access token, from the token response we stored
// (`expires_in` seconds relative to our own `obtained_at` stamp). Null when the
// provider's tokens don't expire (Notion, GitHub OAuth apps, ClickUp, …).
export function tokenExpiresAt(creds: Record<string, unknown>): number | null {
  const expiresIn = Number(creds.expires_in);
  const obtainedAt = typeof creds.obtained_at === "string" ? Date.parse(creds.obtained_at) : NaN;
  if (!Number.isFinite(expiresIn) || expiresIn <= 0 || Number.isNaN(obtainedAt)) return null;
  return obtainedAt + expiresIn * 1000;
}

export function credentialsNeedRefresh(creds: Record<string, unknown>, now = Date.now()): boolean {
  const expiresAt = tokenExpiresAt(creds);
  return expiresAt !== null && expiresAt - EXPIRY_MARGIN_MS <= now;
}

// Return sync-ready credentials for a connector row, refreshing and persisting
// them first when the stored access token is expired or about to expire.
// Falls back to the stored credentials when the provider is not a generic OAuth
// source or has nothing to refresh with.
export async function ensureFreshCredentials(
  row: ConnectorRow,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const creds = row.credentials ?? {};
  const provider = typeof creds.provider === "string" ? creds.provider : row.type;
  if (!isGenericOAuthProvider(provider)) return creds;
  const refreshToken = typeof creds.refresh_token === "string" ? creds.refresh_token : null;
  if (!refreshToken || !credentialsNeedRefresh(creds)) return creds;
  const config = await oauthProviderConfig(provider);
  if (!config) return creds;
  const workspace = typeof creds.workspace === "string" ? creds.workspace : undefined;
  const refreshed = await refreshOAuthToken(config, refreshToken, { workspace }, fetchFn);
  // Some providers rotate the refresh token, others omit it — never lose ours.
  const merged: Record<string, unknown> = {
    ...creds,
    ...refreshed,
    refresh_token: typeof refreshed.refresh_token === "string" ? refreshed.refresh_token : refreshToken,
  };
  await upsertConnector(row.type, { credentials: merged });
  return merged;
}
