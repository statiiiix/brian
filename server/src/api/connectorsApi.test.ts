import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { buildApp, oauthReconnectPatch, publicConnector } from "./app.js";
import { testClient } from "../test/http.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import { FOUNDING_TENANT_ID, runTenant } from "../db/tenant.js";
import type { PrincipalStore } from "../auth/principal.js";
import { createSkill } from "../skills/repo.js";
import { getConnector, upsertConnector, insertEvidence, markPromoted } from "../connectors/repo.js";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: async () => new Array(1536).fill(0.01),
}));

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const ACME = "00000000-0000-0000-0000-0000000c0009";
const FOUNDING_USER = "c0900000-0000-4000-8000-000000000001";
const ACME_USER = "c0900000-0000-4000-8000-000000000002";
const VIEWER_USER = "c0900000-0000-4000-8000-000000000003";
const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const dashboardToken = (userId: string) => `${b64({ alg: "ES256" })}.${b64({
  iss: "https://connectors-test.supabase.co/auth/v1", sub: userId, aud: "authenticated",
})}.sig`;
const FOUNDING_TOKEN = dashboardToken(FOUNDING_USER);
const ACME_TOKEN = dashboardToken(ACME_USER);
const VIEWER_TOKEN = dashboardToken(VIEWER_USER);
const H = (t: string) => ({ authorization: `Bearer ${t}` });

describe("connector sync error redaction", () => {
  it("does not expose internal provider or source content", async () => {
    const app = testClient(buildApp({
      sync: async () => { throw new Error("private provider diagnostic and source content"); },
    }));
    const response = await app.inject({
      method: "POST",
      url: "/api/connectors/notion/sync",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "connector sync failed" });
    expect(response.body).not.toContain("private provider diagnostic");
  });
});

describe("generic OAuth reconnect patch", () => {
  it("clears stale Notion selection and cursors without changing other providers", () => {
    const credentials = { access_token: "new-token" };
    expect(oauthReconnectPatch("notion", credentials)).toEqual({
      status: "connected", credentials, settings: {}, cursor: {},
    });
    expect(oauthReconnectPatch("linear", credentials)).toEqual({ status: "connected", credentials });
  });
});

describe("public connector redaction", () => {
  it("uses an explicit safe allowlist and excludes cursors and errors", () => {
    const result = publicConnector({
      id: "connector-1", tenant_id: "tenant-1", type: "notion", status: "connected",
      credentials: { access_token: "secret" }, settings: { selected_page_ids: ["page-1"] },
      cursor: { opaque: "cursor" }, last_error: "provider body", last_synced_at: "2026-01-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    });
    expect(result).toEqual({
      id: "connector-1", type: "notion", status: "connected", configured: true, selection_ready: true,
      settings: { selected_page_ids: ["page-1"], selected_data_source_ids: [] },
      last_synced_at: "2026-01-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    });
  });
});

describe("connector viewer mutation guards", () => {
  const viewerStore: PrincipalStore = {
    async resolveDashboard() { return { tenantId: FOUNDING_TENANT_ID, userId: VIEWER_USER, role: "viewer", membershipId: VIEWER_USER }; },
    async listMemberships() { return []; }, async resolveMcp() { return null; }, async resolveLegacy() { return null; }, async touchConnection() {},
  };
  const viewerFetch = async () => new Response(JSON.stringify({ id: VIEWER_USER, email: "viewer@example.test" }));
  const app = testClient(buildApp({
    supabaseAuth: { url: "https://connectors-test.supabase.co", anonKey: "anon", fetchFn: viewerFetch as typeof fetch }, principalStore: viewerStore,
  }));

  it.each([
    { method: "PUT", url: "/api/connectors/notion/settings", payload: { selected_page_ids: ["page-1"] } },
    { method: "POST", url: "/api/connectors/notion/disable" },
  ])("denies viewer $method $url before connector state is read or changed", async ({ method, url, payload }) => {
    const response = await app.inject({ method, url, headers: H(VIEWER_TOKEN), payload });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "forbidden" });
  });

  it("requires an authenticated human for Notion boundary discovery", async () => {
    const response = await app.inject({ method: "GET", url: "/api/connectors/notion/boundaries" });
    expect(response.statusCode).toBe(401);
  });
});

const principalStore: PrincipalStore = {
  async resolveDashboard(userId) {
    const tenantId = userId === FOUNDING_USER ? FOUNDING_TENANT_ID : userId === ACME_USER ? ACME : userId === VIEWER_USER ? FOUNDING_TENANT_ID : null;
    return tenantId ? {
      tenantId, userId, role: userId === VIEWER_USER ? "viewer" : "admin", membershipId: userId,
    } : null;
  },
  async listMemberships() { return []; },
  async resolveMcp() { return null; },
  async resolveLegacy() { return null; },
  async touchConnection() {},
};

const supabaseFetch = async (_input: string | URL | Request, init?: RequestInit) => {
  const bearer = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "");
  const userId = bearer === FOUNDING_TOKEN ? FOUNDING_USER : bearer === ACME_TOKEN ? ACME_USER : null;
  return userId
    ? new Response(JSON.stringify({ id: userId, email: `${userId}@example.test` }))
    : new Response("{}", { status: 401 });
};

async function clean() {
  await pool.query(
    `delete from evidence where connector_id in (
       select id from connectors where type in ('gmail','slack') and tenant_id in ($1,$2)
     )`,
    [FOUNDING_TENANT_ID, ACME],
  );
  await pool.query(
    "delete from skills where name='__conn Refund' and tenant_id in ($1,$2)",
    [FOUNDING_TENANT_ID, ACME],
  );
  await pool.query(
    "delete from connectors where type in ('gmail','slack') and tenant_id in ($1,$2)",
    [FOUNDING_TENANT_ID, ACME]);
  await pool.query("delete from api_tokens where tenant_id=$1 or label like '__conn%'", [ACME]);
  await pool.query("delete from tenants where id=$1", [ACME]);
}

d("connectors API", () => {
  const fakeSummary = { fetched: 3, kept: 2, evidence: 2, drafts: 0 };
  const app = testClient(buildApp({
    supabaseAuth: {
      url: "https://connectors-test.supabase.co",
      anonKey: "anon",
      fetchFn: supabaseFetch as typeof fetch,
    },
    principalStore,
    sync: async () => fakeSummary,
  }));

  beforeAll(async () => {
    await runMigrations(pool);
    await clean();
    await pool.query(
      "insert into tenants (id,name,slug) values ($1,'Acme','__conn-acme') on conflict (id) do nothing", [ACME]);
    await app.ready();
  });
  afterAll(async () => { await clean(); await app.close(); await pool.end(); });

  it("connect stores creds (never leaked), list redacts, disable toggles", async () => {
    const c = await app.inject({
      method: "POST", url: "/api/connectors/gmail/connect", headers: H(FOUNDING_TOKEN),
      payload: { credentials: { refresh_token: "SECRET" } },
    });
    expect(c.statusCode).toBe(200);
    expect(c.json().status).toBe("connected");
    expect(c.json().configured).toBe(true);
    expect(JSON.stringify(c.json())).not.toContain("SECRET");

    const list = await app.inject({ method: "GET", url: "/api/connectors", headers: H(FOUNDING_TOKEN) });
    const gmail = (list.json() as Record<string, unknown>[]).find((x) => x.type === "gmail");
    expect(gmail?.credentials).toBeUndefined();

    const dis = await app.inject({ method: "POST", url: "/api/connectors/gmail/disable", headers: H(FOUNDING_TOKEN) });
    expect(dis.json().status).toBe("disabled");
    expect(dis.json().configured).toBe(false);
  });

  it("sync returns the summary; unknown connector 400s", async () => {
    const s = await app.inject({ method: "POST", url: "/api/connectors/gmail/sync", headers: H(FOUNDING_TOKEN) });
    expect(s.json()).toEqual(fakeSummary);
    const bad = await app.inject({ method: "POST", url: "/api/connectors/nope/sync", headers: H(FOUNDING_TOKEN) });
    expect(bad.statusCode).toBe(400);
  });

  it("exposes a stable authorization entrypoint for planned providers", async () => {
    const planned = await app.inject({
      method: "GET", url: "/api/connectors/notion/start", headers: H(FOUNDING_TOKEN),
    });
    expect(planned.statusCode).toBe(503);
    expect(planned.json()).toMatchObject({
      code: "connector_oauth_not_configured", provider: "notion",
    });

    const unknown = await app.inject({
      method: "GET", url: "/api/connectors/not-real/start", headers: H(FOUNDING_TOKEN),
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("reports whether supported OAuth providers are configured without exposing secrets", async () => {
    const providers = await app.inject({ method: "GET", url: "/api/connectors/providers", headers: H(FOUNDING_TOKEN) });
    expect(providers.statusCode).toBe(200);
    expect(providers.json()).toMatchObject({
      google: { label: "Google Workspace", supported: true, configured: expect.any(Boolean) },
      slack: { label: "Slack", supported: true, configured: expect.any(Boolean) },
    });
    expect(JSON.stringify(providers.json())).not.toContain("CLIENT_SECRET");
  });

  it("is tenant-isolated", async () => {
    const acme = await app.inject({ method: "GET", url: "/api/connectors", headers: H(ACME_TOKEN) });
    expect((acme.json() as { type: string }[]).find((x) => x.type === "gmail")).toBeUndefined();

    await app.inject({
      method: "POST", url: "/api/connectors/slack/connect", headers: H(ACME_TOKEN),
      payload: { credentials: { bot_token: "x" } },
    });
    const founding = await app.inject({ method: "GET", url: "/api/connectors", headers: H(FOUNDING_TOKEN) });
    expect((founding.json() as { type: string }[]).find((x) => x.type === "slack")).toBeUndefined();
  });

  it("cannot execute a connector action with another tenant's connector", async () => {
    await runTenant(FOUNDING_TENANT_ID, () => upsertConnector("gmail", {
      status: "connected",
      credentials: { refresh_token: "foreign-secret" },
      cursor: { page: "foreign-cursor" },
    }));
    const before = await runTenant(FOUNDING_TENANT_ID, () => getConnector("gmail"));
    const actionApp = testClient(buildApp({
      supabaseAuth: {
        url: "https://connectors-test.supabase.co",
        anonKey: "anon",
        fetchFn: supabaseFetch as typeof fetch,
      },
      principalStore,
    }));
    const response = await actionApp.inject({
      method: "POST", url: "/api/connectors/gmail/sync", headers: H(ACME_TOKEN),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("connector gmail is not configured");
    const after = await runTenant(FOUNDING_TENANT_ID, () => getConnector("gmail"));
    expect(after?.credentials).toEqual(before?.credentials);
    expect(after?.cursor).toEqual(before?.cursor);
    await actionApp.close();
  });

  it("discovers and saves only the current tenant's Notion selection boundary", async () => {
    await runTenant(FOUNDING_TENANT_ID, () => upsertConnector("notion", {
      status: "connected", credentials: { access_token: "notion-secret" },
      settings: { selected_page_ids: ["old-page"] }, cursor: { old: "cursor" },
    }));
    const discovery = vi.fn(async (credentials: Record<string, unknown>) => {
      expect(credentials).toEqual({ access_token: "notion-secret" });
      return { boundaries: [{ id: "page-1", kind: "page" as const, title: "Page", permalink: "https://notion.so/page-1" }], truncated: false };
    });
    const notionApp = testClient(buildApp({
      supabaseAuth: { url: "https://connectors-test.supabase.co", anonKey: "anon", fetchFn: supabaseFetch as typeof fetch },
      principalStore, notionDiscovery: discovery,
    }));
    const boundaries = await notionApp.inject({ method: "GET", url: "/api/connectors/notion/boundaries", headers: H(FOUNDING_TOKEN) });
    expect(boundaries.statusCode).toBe(200);
    expect(JSON.stringify(boundaries.json())).not.toContain("notion-secret");
    const crossTenant = await notionApp.inject({ method: "GET", url: "/api/connectors/notion/boundaries", headers: H(ACME_TOKEN) });
    expect(crossTenant.statusCode).toBe(400);

    const saved = await notionApp.inject({
      method: "PUT", url: "/api/connectors/notion/settings", headers: H(FOUNDING_TOKEN),
      payload: { selected_page_ids: [" page-1 ", "page-1"], selected_data_source_ids: ["source-1"] },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ settings: { selected_page_ids: ["page-1"], selected_data_source_ids: ["source-1"] } });
    const stored = await runTenant(FOUNDING_TENANT_ID, () => getConnector("notion"));
    expect(stored?.cursor).toEqual({});
    expect(stored?.credentials).toEqual({ access_token: "notion-secret" });

    const malformed = await notionApp.inject({ method: "PUT", url: "/api/connectors/notion/settings", headers: H(FOUNDING_TOKEN), payload: { selected_page_ids: [] } });
    expect(malformed.statusCode).toBe(400);
    const viewer = await notionApp.inject({ method: "PUT", url: "/api/connectors/notion/settings", headers: H(VIEWER_TOKEN), payload: { selected_page_ids: ["page-2"] } });
    expect(viewer.statusCode).toBe(403);
    await notionApp.close();
  });

  it("fails closed on Notion revocation, then clears secret state after success", async () => {
    await runTenant(FOUNDING_TENANT_ID, () => upsertConnector("notion", {
      status: "connected", credentials: { access_token: "notion-secret" },
      settings: { selected_page_ids: ["page-1"] }, cursor: { opaque: "cursor" },
    }));
    const failedApp = testClient(buildApp({
      supabaseAuth: { url: "https://connectors-test.supabase.co", anonKey: "anon", fetchFn: supabaseFetch as typeof fetch },
      principalStore, notionOAuthConfig: async () => ({ clientId: "id", clientSecret: "secret" }),
      notionRevoke: async () => { throw new Error("private provider body"); },
    }));
    const failed = await failedApp.inject({ method: "POST", url: "/api/connectors/notion/disable", headers: H(FOUNDING_TOKEN) });
    expect(failed.statusCode).toBe(502);
    expect(failed.body).not.toContain("private provider body");
    expect((await runTenant(FOUNDING_TENANT_ID, () => getConnector("notion")))?.status).toBe("connected");
    await failedApp.close();

    const successfulApp = testClient(buildApp({
      supabaseAuth: { url: "https://connectors-test.supabase.co", anonKey: "anon", fetchFn: supabaseFetch as typeof fetch },
      principalStore, notionOAuthConfig: async () => ({ clientId: "id", clientSecret: "secret" }), notionRevoke: async () => {},
    }));
    const disabled = await successfulApp.inject({ method: "POST", url: "/api/connectors/notion/disable", headers: H(FOUNDING_TOKEN) });
    expect(disabled.statusCode).toBe(200);
    const stored = await runTenant(FOUNDING_TENANT_ID, () => getConnector("notion"));
    expect(stored).toMatchObject({ status: "disabled", credentials: {}, settings: {}, cursor: {} });
    await successfulApp.close();
  });

  it("exposes connector provenance for a drafted skill", async () => {
    const skillId = await runTenant(FOUNDING_TENANT_ID, async () => {
      const conn = await upsertConnector("gmail", { status: "connected" });
      const skill = await createSkill({
        name: "__conn Refund", trigger: "refund", inputs: [], procedure: "escalate",
        hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null,
      });
      const ev = await insertEvidence({
        connector_id: conn.id, source_ref: { thread_id: "__connEv1", permalink: "http://x" },
        kind: "skill_evidence", summary: "__conn refund evidence", confidence: 0.8,
        embedding: new Array(1536).fill(0.01),
      });
      await markPromoted([ev!.id], "skill", skill.id);
      return skill.id;
    });

    const res = await app.inject({ method: "GET", url: `/api/skills/${skillId}/evidence`, headers: H(FOUNDING_TOKEN) });
    expect(res.statusCode).toBe(200);
    const evidence = res.json() as { summary: string; source_ref: { thread_id: string } }[];
    expect(evidence).toHaveLength(1);
    expect(evidence[0].summary).toBe("__conn refund evidence");
    expect(evidence[0].source_ref.thread_id).toBe("__connEv1");

    await pool.query("delete from evidence where summary = '__conn refund evidence'");
    await pool.query("delete from skills where id = $1", [skillId]);
  });
});
