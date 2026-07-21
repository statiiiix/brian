import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ConnectorRow } from "./types.js";

vi.mock("./repo.js", () => ({ upsertConnector: vi.fn(async () => ({})) }));
vi.mock("../config/secrets.js", () => ({
  secret: vi.fn(async (key: string) => ({
    HUBSPOT_CLIENT_ID: "id",
    HUBSPOT_CLIENT_SECRET: "secret",
    BRIAN_OAUTH_BASE_URL: "https://brian.example",
  })[key] ?? null),
}));

import { credentialsNeedRefresh, ensureFreshCredentials, tokenExpiresAt } from "./tokenRefresh.js";
import { upsertConnector } from "./repo.js";

function row(credentials: Record<string, unknown>, type = "hubspot"): ConnectorRow {
  return {
    id: "c1", tenant_id: "t1", type: type as ConnectorRow["type"], status: "connected",
    credentials, settings: {}, cursor: {}, last_synced_at: null, last_error: null,
    created_at: "", updated_at: "",
  };
}

beforeEach(() => vi.clearAllMocks());

describe("token expiry math", () => {
  it("is null for non-expiring tokens", () => {
    expect(tokenExpiresAt({ access_token: "x" })).toBeNull();
    expect(credentialsNeedRefresh({ access_token: "x" })).toBe(false);
  });

  it("flags tokens inside the refresh margin", () => {
    const creds = { expires_in: 1800, obtained_at: new Date(Date.now() - 1700_000).toISOString() };
    expect(credentialsNeedRefresh(creds)).toBe(true);
    const fresh = { expires_in: 1800, obtained_at: new Date().toISOString() };
    expect(credentialsNeedRefresh(fresh)).toBe(false);
  });
});

describe("ensureFreshCredentials", () => {
  it("passes through non-generic providers untouched", async () => {
    const creds = { provider: "gmail", access_token: "a" };
    expect(await ensureFreshCredentials(row(creds, "gmail"))).toBe(creds);
    expect(upsertConnector).not.toHaveBeenCalled();
  });

  it("passes through unexpired or refreshless credentials", async () => {
    const noRefresh = { provider: "hubspot", access_token: "a", expires_in: 1, obtained_at: "2020-01-01T00:00:00Z" };
    expect(await ensureFreshCredentials(row(noRefresh))).toBe(noRefresh);
    const unexpired = { provider: "hubspot", access_token: "a", refresh_token: "r", expires_in: 999999, obtained_at: new Date().toISOString() };
    expect(await ensureFreshCredentials(row(unexpired))).toBe(unexpired);
  });

  it("refreshes, merges, persists, and keeps the old refresh token if not rotated", async () => {
    const stale = {
      provider: "hubspot", access_token: "old", refresh_token: "keep-me",
      expires_in: 1800, obtained_at: "2020-01-01T00:00:00Z", hub_id: 999,
    };
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "new-token", expires_in: 1800 }),
    })) as unknown as typeof fetch;
    const merged = await ensureFreshCredentials(row(stale), fetchFn);
    expect(merged.access_token).toBe("new-token");
    expect(merged.refresh_token).toBe("keep-me");
    expect(merged.hub_id).toBe(999);
    expect(upsertConnector).toHaveBeenCalledWith("hubspot", { credentials: merged });
    const [url, init] = (fetchFn as any).mock.calls[0];
    expect(String(url)).toContain("hubapi.com/oauth/v3/token");
    expect(String(init.body)).toContain("grant_type=refresh_token");
  });
});
