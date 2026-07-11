import { createOAuthState, consumeOAuthState } from "./googleOAuth.js";
import { secret } from "../config/secrets.js";

const AUTH_URL = "https://slack.com/oauth/v2/authorize";
const TOKEN_URL = "https://slack.com/api/oauth.v2.access";
export const SLACK_SCOPES = ["channels:history", "groups:history", "users:read", "users:read.email"];

export interface SlackOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

type SecretReader = (key: string) => Promise<string | null | undefined>;

export async function slackOAuthConfig(read: SecretReader = secret): Promise<SlackOAuthConfig | null> {
  const [clientId, clientSecret, explicitRedirect, baseUrl] = await Promise.all([
    read("SLACK_CLIENT_ID"),
    read("SLACK_CLIENT_SECRET"),
    read("SLACK_OAUTH_REDIRECT_URI"),
    read("BRIAN_OAUTH_BASE_URL").then((value) => value || read("BRIAN_URL")),
  ]);
  const redirectUri = explicitRedirect ?? (baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/api/connectors/slack/callback`
    : null);
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function slackAuthorizationUrl(config: SlackOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    scope: SLACK_SCOPES.join(","),
    redirect_uri: config.redirectUri,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeSlackCode(
  code: string,
  config: SlackOAuthConfig,
  fetchFn: typeof fetch = fetch,
): Promise<{ access_token: string; team?: { id?: string; name?: string } }> {
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
  const data = await response.json().catch(() => ({})) as {
    ok?: boolean;
    error?: string;
    access_token?: string;
    team?: { id?: string; name?: string };
  };
  if (!response.ok || !data.ok || !data.access_token) {
    throw new Error(`Slack OAuth exchange failed: ${data.error ?? response.status}`);
  }
  return { access_token: data.access_token, team: data.team };
}

export { createOAuthState, consumeOAuthState };
