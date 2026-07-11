import { createHash, createHmac } from "node:crypto";
import { Buffer } from "node:buffer";
import { secret } from "../config/secrets.js";
import type { AuthorizedSourceType } from "./types.js";

export const GENERIC_OAUTH_PROVIDER_IDS = [
  "notion", "confluence", "sharepoint", "onedrive", "jira", "linear", "github",
  "asana", "clickup", "zendesk", "intercom", "hubspot", "salesforce", "gong",
  "microsoft_teams", "outlook", "zoom",
] as const satisfies readonly AuthorizedSourceType[];

export type GenericOAuthProviderId = (typeof GENERIC_OAUTH_PROVIDER_IDS)[number];
type TokenStyle = "form" | "json" | "basic-json" | "basic-form" | "basic-query";
type SecretReader = (key: string) => Promise<string | null | undefined>;

interface OAuthProviderSpec {
  id: GenericOAuthProviderId;
  label: string;
  credentialPrefix: string;
  callbackSlug: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  scopeSeparator?: " " | ",";
  authorizationParams?: Record<string, string>;
  tokenStyle?: TokenStyle;
  omitResponseType?: boolean;
  omitGrantType?: boolean;
  omitRedirectInToken?: boolean;
  pkce?: boolean;
  requiresWorkspace?: boolean;
}

const MICROSOFT_AUTHORIZE = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MICROSOFT_PARAMS = { response_mode: "query", prompt: "select_account" };
const ATLASSIAN_PARAMS = { audience: "api.atlassian.com", prompt: "consent" };

const SPECS: Record<GenericOAuthProviderId, OAuthProviderSpec> = {
  notion: {
    id: "notion", label: "Notion", credentialPrefix: "NOTION", callbackSlug: "notion",
    authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token", scopes: [],
    authorizationParams: { owner: "user" }, tokenStyle: "basic-json",
  },
  confluence: {
    id: "confluence", label: "Confluence", credentialPrefix: "ATLASSIAN", callbackSlug: "atlassian",
    authorizationUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    scopes: ["read:confluence-content.all", "read:confluence-space.summary", "read:me", "offline_access"],
    authorizationParams: ATLASSIAN_PARAMS, tokenStyle: "json",
  },
  sharepoint: {
    id: "sharepoint", label: "SharePoint", credentialPrefix: "MICROSOFT", callbackSlug: "microsoft",
    authorizationUrl: MICROSOFT_AUTHORIZE, tokenUrl: MICROSOFT_TOKEN,
    scopes: ["offline_access", "User.Read", "Sites.Read.All", "Files.Read.All"],
    authorizationParams: MICROSOFT_PARAMS,
  },
  onedrive: {
    id: "onedrive", label: "OneDrive", credentialPrefix: "MICROSOFT", callbackSlug: "microsoft",
    authorizationUrl: MICROSOFT_AUTHORIZE, tokenUrl: MICROSOFT_TOKEN,
    scopes: ["offline_access", "User.Read", "Files.Read.All"], authorizationParams: MICROSOFT_PARAMS,
  },
  jira: {
    id: "jira", label: "Jira", credentialPrefix: "ATLASSIAN", callbackSlug: "atlassian",
    authorizationUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    scopes: ["read:jira-work", "read:jira-user", "read:me", "offline_access"],
    authorizationParams: ATLASSIAN_PARAMS, tokenStyle: "json",
  },
  linear: {
    id: "linear", label: "Linear", credentialPrefix: "LINEAR", callbackSlug: "linear",
    authorizationUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token", scopes: ["read"], scopeSeparator: ",",
    authorizationParams: { prompt: "consent" }, pkce: true,
  },
  github: {
    id: "github", label: "GitHub", credentialPrefix: "GITHUB", callbackSlug: "github",
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token", scopes: ["read:user", "read:org"], pkce: true,
  },
  asana: {
    id: "asana", label: "Asana", credentialPrefix: "ASANA", callbackSlug: "asana",
    authorizationUrl: "https://app.asana.com/-/oauth_authorize",
    tokenUrl: "https://app.asana.com/-/oauth_token", scopes: ["projects:read", "tasks:read"], pkce: true,
  },
  clickup: {
    id: "clickup", label: "ClickUp", credentialPrefix: "CLICKUP", callbackSlug: "clickup",
    authorizationUrl: "https://app.clickup.com/api",
    tokenUrl: "https://api.clickup.com/api/v2/oauth/token", scopes: [],
    omitResponseType: true, omitGrantType: true, omitRedirectInToken: true,
  },
  zendesk: {
    id: "zendesk", label: "Zendesk", credentialPrefix: "ZENDESK", callbackSlug: "zendesk",
    authorizationUrl: "https://{workspace}.zendesk.com/oauth/authorizations/new",
    tokenUrl: "https://{workspace}.zendesk.com/oauth/tokens", scopes: ["tickets:read"],
    requiresWorkspace: true,
  },
  intercom: {
    id: "intercom", label: "Intercom", credentialPrefix: "INTERCOM", callbackSlug: "intercom",
    authorizationUrl: "https://app.intercom.com/oauth",
    tokenUrl: "https://api.intercom.io/auth/eagle/token", scopes: [],
    omitResponseType: true, omitGrantType: true, omitRedirectInToken: true,
  },
  hubspot: {
    id: "hubspot", label: "HubSpot", credentialPrefix: "HUBSPOT", callbackSlug: "hubspot",
    authorizationUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v3/token",
    scopes: ["oauth", "crm.objects.contacts.read", "crm.objects.companies.read", "crm.objects.deals.read"],
  },
  salesforce: {
    id: "salesforce", label: "Salesforce", credentialPrefix: "SALESFORCE", callbackSlug: "salesforce",
    authorizationUrl: "https://login.salesforce.com/services/oauth2/authorize",
    tokenUrl: "https://login.salesforce.com/services/oauth2/token", scopes: ["api", "refresh_token"],
  },
  gong: {
    id: "gong", label: "Gong", credentialPrefix: "GONG", callbackSlug: "gong",
    authorizationUrl: "https://app.gong.io/oauth2/authorize",
    tokenUrl: "https://app.gong.io/oauth2/generate-customer-token",
    scopes: ["api:calls:read:basic"], tokenStyle: "basic-query",
  },
  microsoft_teams: {
    id: "microsoft_teams", label: "Microsoft Teams", credentialPrefix: "MICROSOFT", callbackSlug: "microsoft",
    authorizationUrl: MICROSOFT_AUTHORIZE, tokenUrl: MICROSOFT_TOKEN,
    scopes: ["offline_access", "User.Read", "Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Read.All"],
    authorizationParams: MICROSOFT_PARAMS,
  },
  outlook: {
    id: "outlook", label: "Outlook", credentialPrefix: "MICROSOFT", callbackSlug: "microsoft",
    authorizationUrl: MICROSOFT_AUTHORIZE, tokenUrl: MICROSOFT_TOKEN,
    scopes: ["offline_access", "User.Read", "Mail.Read"], authorizationParams: MICROSOFT_PARAMS,
  },
  zoom: {
    id: "zoom", label: "Zoom", credentialPrefix: "ZOOM", callbackSlug: "zoom",
    authorizationUrl: "https://zoom.us/oauth/authorize", tokenUrl: "https://zoom.us/oauth/token",
    scopes: [], tokenStyle: "basic-form",
  },
};

export interface OAuthProviderConfig {
  spec: OAuthProviderSpec;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

export interface OAuthProviderContext {
  workspace?: string;
}

export interface OAuthTokenCredentials extends Record<string, unknown> {
  provider: GenericOAuthProviderId;
  access_token: string;
  obtained_at: string;
}

export function isGenericOAuthProvider(value: string): value is GenericOAuthProviderId {
  return (GENERIC_OAUTH_PROVIDER_IDS as readonly string[]).includes(value);
}

export function getOAuthProviderSpec(provider: GenericOAuthProviderId): OAuthProviderSpec {
  return SPECS[provider];
}

async function firstSecret(keys: string[], read: SecretReader): Promise<string | null> {
  for (const key of keys) {
    const value = await read(key);
    if (value) return value;
  }
  return null;
}

export async function oauthProviderConfig(
  provider: GenericOAuthProviderId,
  read: SecretReader = secret,
): Promise<OAuthProviderConfig | null> {
  const spec = SPECS[provider];
  const providerPrefix = provider.toUpperCase();
  const [clientId, clientSecret, explicitRedirect, baseUrl, scopeOverride] = await Promise.all([
    firstSecret([`${providerPrefix}_CLIENT_ID`, `${spec.credentialPrefix}_CLIENT_ID`], read),
    firstSecret([`${providerPrefix}_CLIENT_SECRET`, `${spec.credentialPrefix}_CLIENT_SECRET`], read),
    firstSecret([`${providerPrefix}_OAUTH_REDIRECT_URI`, `${spec.credentialPrefix}_OAUTH_REDIRECT_URI`], read),
    firstSecret(["BRIAN_OAUTH_BASE_URL", "BRIAN_URL"], read),
    firstSecret([`${providerPrefix}_OAUTH_SCOPES`, `${spec.credentialPrefix}_OAUTH_SCOPES`], read),
  ]);
  const redirectUri = explicitRedirect ?? (baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/api/connectors/${spec.callbackSlug}/callback`
    : null);
  if (!clientId || !clientSecret || !redirectUri) return null;
  const separator = spec.scopeSeparator ?? " ";
  const scopes = scopeOverride
    ? scopeOverride.split(separator === "," ? /\s*,\s*/ : /\s+/).filter(Boolean)
    : spec.scopes;
  return { spec, clientId, clientSecret, redirectUri, scopes };
}

export async function oauthProviderAvailability(read: SecretReader = secret) {
  const entries = await Promise.all(GENERIC_OAUTH_PROVIDER_IDS.map(async (provider) => {
    const spec = SPECS[provider];
    return [provider, {
      label: spec.label,
      supported: true,
      configured: Boolean(await oauthProviderConfig(provider, read)),
      requires_workspace: Boolean(spec.requiresWorkspace),
      callback_slug: spec.callbackSlug,
    }] as const;
  }));
  return Object.fromEntries(entries);
}

export function normalizeZendeskWorkspace(value: string | undefined): string {
  if (!value) throw new Error("Zendesk subdomain is required");
  const candidate = value.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\.zendesk\.com.*$/, "")
    .replace(/\/$/, "");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(candidate)) {
    throw new Error("Enter a valid Zendesk subdomain");
  }
  return candidate;
}

function endpoint(template: string, context: OAuthProviderContext): string {
  if (!template.includes("{workspace}")) return template;
  return template.replace("{workspace}", normalizeZendeskWorkspace(context.workspace));
}

export function codeVerifierForState(config: OAuthProviderConfig, state: string): string {
  return createHmac("sha256", config.clientSecret).update(state).digest("base64url");
}

export function buildOAuthAuthorizationUrl(
  config: OAuthProviderConfig,
  state: string,
  context: OAuthProviderContext = {},
): string {
  const { spec } = config;
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
  });
  if (!spec.omitResponseType) params.set("response_type", "code");
  if (config.scopes.length) params.set("scope", config.scopes.join(spec.scopeSeparator ?? " "));
  for (const [key, value] of Object.entries(spec.authorizationParams ?? {})) params.set(key, value);
  if (spec.pkce) {
    const verifier = codeVerifierForState(config, state);
    params.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    params.set("code_challenge_method", "S256");
  }
  return `${endpoint(spec.authorizationUrl, context)}?${params.toString()}`;
}

function tokenParams(
  config: OAuthProviderConfig,
  code: string,
  state: string,
): Record<string, string> {
  const { spec } = config;
  const params: Record<string, string> = { code, client_id: config.clientId, client_secret: config.clientSecret };
  if (!spec.omitGrantType) params.grant_type = "authorization_code";
  if (!spec.omitRedirectInToken) params.redirect_uri = config.redirectUri;
  if (spec.pkce) params.code_verifier = codeVerifierForState(config, state);
  if (spec.id === "gong") params.validity_duration = "86400";
  return params;
}

export async function exchangeOAuthCode(
  config: OAuthProviderConfig,
  code: string,
  state: string,
  context: OAuthProviderContext = {},
  fetchFn: typeof fetch = fetch,
): Promise<OAuthTokenCredentials> {
  const { spec } = config;
  const style = spec.tokenStyle ?? "form";
  const params = tokenParams(config, code, state);
  const headers: Record<string, string> = { accept: "application/json" };
  let url = endpoint(spec.tokenUrl, context);
  let body: string | undefined;

  if (style.startsWith("basic-")) {
    headers.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
    delete params.client_id;
    delete params.client_secret;
  }
  if (style === "json" || style === "basic-json") {
    headers["content-type"] = "application/json";
    body = JSON.stringify(params);
  } else if (style === "basic-query") {
    url = `${url}?${new URLSearchParams(params).toString()}`;
  } else {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(params).toString();
  }

  const response = await fetchFn(url, { method: "POST", headers, ...(body ? { body } : {}) });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  const accessToken = typeof data.access_token === "string"
    ? data.access_token
    : typeof data.token === "string" ? data.token : null;
  if (!response.ok || !accessToken) {
    const message = data.error_description ?? data.message ?? data.error ?? response.status;
    throw new Error(`${spec.label} OAuth exchange failed: ${String(message)}`);
  }
  return {
    ...data,
    provider: spec.id,
    access_token: accessToken,
    obtained_at: new Date().toISOString(),
    ...(context.workspace ? { workspace: normalizeZendeskWorkspace(context.workspace) } : {}),
  } as OAuthTokenCredentials;
}

export function callbackMatchesProvider(callbackSlug: string, provider: GenericOAuthProviderId): boolean {
  return SPECS[provider].callbackSlug === callbackSlug;
}
