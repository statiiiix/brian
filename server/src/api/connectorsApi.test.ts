import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "./app.js";
import { testClient } from "../test/http.js";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import { FOUNDING_TENANT_ID, runTenant } from "../db/tenant.js";
import { ensureToken } from "../auth/apiTokens.js";
import { createSkill } from "../skills/repo.js";
import { upsertConnector, insertEvidence, markPromoted } from "../connectors/repo.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const ACME = "00000000-0000-0000-0000-0000000c0009";
const FOUNDING_TOKEN = "founding-__conn";
const ACME_TOKEN = "acme-__conn";
const H = (t: string) => ({ authorization: `Bearer ${t}` });

async function clean() {
  await pool.query(
    "delete from connectors where type in ('gmail','slack') and tenant_id in ($1,$2)",
    [FOUNDING_TENANT_ID, ACME]);
  await pool.query("delete from api_tokens where label like '__conn%'");
  await pool.query("delete from tenants where id=$1", [ACME]);
}

d("connectors API", () => {
  const fakeSummary = { fetched: 3, kept: 2, evidence: 2, drafts: 0 };
  const app = testClient(buildApp({ authToken: FOUNDING_TOKEN, sync: async () => fakeSummary }));

  beforeAll(async () => {
    await runMigrations(pool);
    await clean();
    await pool.query(
      "insert into tenants (id,name,slug) values ($1,'Acme','__conn-acme') on conflict (id) do nothing", [ACME]);
    await ensureToken(ACME, ACME_TOKEN, "__conn acme");
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
