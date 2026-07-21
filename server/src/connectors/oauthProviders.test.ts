import { describe, expect, it } from "vitest";
import {
  GENERIC_OAUTH_PROVIDER_IDS, buildOAuthAuthorizationUrl, callbackMatchesProvider,
  exchangeOAuthCode, normalizeZendeskWorkspace, oauthProviderAvailability, oauthProviderConfig,
  refreshOAuthToken,
} from "./oauthProviders.js";

const read = async (key: string) => {
  const values: Record<string, string> = {
    BRIAN_OAUTH_BASE_URL: "https://api.brian.test",
    ATLASSIAN_CLIENT_ID: "atlassian-id", ATLASSIAN_CLIENT_SECRET: "atlassian-secret",
    MICROSOFT_CLIENT_ID: "microsoft-id", MICROSOFT_CLIENT_SECRET: "microsoft-secret",
  };
  const prefix = key.split("_")[0];
  return values[key] ?? (key.endsWith("_CLIENT_ID") ? `${prefix}-id`
    : key.endsWith("_CLIENT_SECRET") ? `${prefix}-secret` : null);
};

describe("generic OAuth providers", () => {
  it("reports every source while configuring only read-only-capable providers", async () => {
    const availability = await oauthProviderAvailability(read);
    expect(Object.keys(availability).sort()).toEqual([...GENERIC_OAUTH_PROVIDER_IDS].sort());
    expect(Object.entries(availability)
      .filter(([provider]) => provider !== "salesforce")
      .every(([, provider]) => provider.supported && provider.configured)).toBe(true);
  });

  it("builds shared Microsoft and Atlassian callbacks with source-specific read scopes", async () => {
    const sharepoint = (await oauthProviderConfig("sharepoint", read))!;
    const jira = (await oauthProviderConfig("jira", read))!;
    const sharepointUrl = new URL(buildOAuthAuthorizationUrl(sharepoint, "state-1"));
    const jiraUrl = new URL(buildOAuthAuthorizationUrl(jira, "state-2"));

    expect(sharepoint.redirectUri).toBe("https://api.brian.test/api/connectors/microsoft/callback");
    expect(sharepointUrl.searchParams.get("scope")).toContain("Sites.Read.All");
    expect(jira.redirectUri).toBe("https://api.brian.test/api/connectors/atlassian/callback");
    expect(jiraUrl.searchParams.get("audience")).toBe("api.atlassian.com");
    expect(callbackMatchesProvider("atlassian", "jira")).toBe(true);
  });

  it("normalizes a tenant's Zendesk workspace and rejects unsafe hosts", async () => {
    expect(normalizeZendeskWorkspace("https://Acme.zendesk.com/agent")).toBe("acme");
    expect(() => normalizeZendeskWorkspace("acme.example.com")).toThrow("valid Zendesk subdomain");
    const config = (await oauthProviderConfig("zendesk", read))!;
    expect(buildOAuthAuthorizationUrl(config, "state", { workspace: "acme" }))
      .toContain("https://acme.zendesk.com/oauth/authorizations/new?");
  });

  it("uses PKCE for providers that support it and exchanges a code server-side", async () => {
    const config = (await oauthProviderConfig("linear", read))!;
    const authorize = new URL(buildOAuthAuthorizationUrl(config, "state-pkce"));
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");

    let requestBody = "";
    const token = await exchangeOAuthCode(config, "code-1", "state-pkce", {}, async (_url, init) => {
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ access_token: "ACCESS", refresh_token: "REFRESH", expires_in: 3600 }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });
    expect(new URLSearchParams(requestBody).get("code_verifier")).toBeTruthy();
    expect(token).toMatchObject({ provider: "linear", access_token: "ACCESS", refresh_token: "REFRESH" });
  });

  it("uses Gong's Basic-auth query exchange and keeps its customer API base URL", async () => {
    const config = (await oauthProviderConfig("gong", read))!;
    let requestUrl = "";
    let authorization = "";
    const token = await exchangeOAuthCode(config, "gong-code", "state", {}, async (url, init) => {
      requestUrl = String(url);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({ access_token: "GONG", api_base_url_for_customer: "https://acme.api.gong.io" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });
    expect(requestUrl).toContain("grant_type=authorization_code");
    expect(authorization).toMatch(/^Basic /);
    expect(token.api_base_url_for_customer).toBe("https://acme.api.gong.io");
  });

  it("rejects an OAuth scope override outside the provider read-only allowlist", async () => {
    const unsafeRead = async (key: string) => key === "HUBSPOT_OAUTH_SCOPES"
      ? "crm.objects.deals.read crm.objects.contacts.write"
      : read(key);
    expect(await oauthProviderConfig("hubspot", unsafeRead)).toBeNull();
  });

  it("does not configure Salesforce when only its broad api scope is available", async () => {
    expect(await oauthProviderConfig("salesforce", read)).toBeNull();
    const availability = await oauthProviderAvailability(read);
    expect(availability.salesforce).toMatchObject({ supported: false, configured: false });
  });

  it("keeps configuration distinct from dated production verification", async () => {
    const availability = await oauthProviderAvailability(read);
    expect(availability.notion).toMatchObject({ configured: true, verified: false });
  });

  it("redacts provider response bodies from OAuth exchange failures", async () => {
    const config = (await oauthProviderConfig("linear", read))!;
    const exchange = exchangeOAuthCode(config, "bad-code", "state", {}, async () => new Response(
      JSON.stringify({ error_description: "private provider diagnostic" }),
      { status: 400, headers: { "content-type": "application/json" } },
    ));

    await expect(exchange).rejects.toThrow(/^oauth_exchange_failed$/);
    await expect(exchange).rejects.not.toThrow(/private provider diagnostic/);
  });

  it("redacts provider response bodies from OAuth refresh failures", async () => {
    const config = (await oauthProviderConfig("linear", read))!;
    const refresh = refreshOAuthToken(config, "bad-refresh", {}, async () => new Response(
      JSON.stringify({ message: "refresh token belongs to tenant-private@example.test" }),
      { status: 401, headers: { "content-type": "application/json" } },
    ));

    await expect(refresh).rejects.toThrow(/^oauth_refresh_failed$/);
    await expect(refresh).rejects.not.toThrow(/tenant-private@example\.test/);
  });

  it("sends Notion's required current API version during code exchange and refresh", async () => {
    const config = (await oauthProviderConfig("notion", read))!;
    const versions: string[] = [];
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      versions.push(new Headers(init?.headers).get("Notion-Version") ?? "");
      return new Response(JSON.stringify({ access_token: "ACCESS", refresh_token: "REFRESH" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    };

    await exchangeOAuthCode(config, "code", "state", {}, fetchFn);
    await refreshOAuthToken(config, "refresh", {}, fetchFn);
    expect(versions).toEqual(["2026-03-11", "2026-03-11"]);
  });

  it("keeps only a safe Notion provider error code", async () => {
    const config = (await oauthProviderConfig("notion", read))!;
    const exchange = exchangeOAuthCode(config, "bad-code", "state", {}, async () => new Response(
      JSON.stringify({ code: "unauthorized", message: "private provider diagnostic" }),
      { status: 401, headers: { "content-type": "application/json" } },
    ));
    await expect(exchange).rejects.toThrow(/^oauth_exchange_failed_unauthorized$/);
    await expect(exchange).rejects.not.toThrow(/private provider diagnostic/);
  });
});
