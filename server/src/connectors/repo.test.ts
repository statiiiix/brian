import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import { runTenant, FOUNDING_TENANT_ID } from "../db/tenant.js";
import {
  upsertConnector, getConnector, listConnectors,
  insertEvidence, unpromotedEvidence, markPromoted,
} from "./repo.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const OTHER = "00000000-0000-0000-0000-0000000c0006";

async function clean() {
  await pool.query("delete from evidence where summary like '__r006%'");
  await pool.query(
    "delete from connectors where type in ('gmail','slack','notion') and tenant_id in ($1,$2)",
    [FOUNDING_TENANT_ID, OTHER]);
  await pool.query("delete from tenants where id=$1", [OTHER]);
}

d("connectors repo", () => {
  beforeAll(async () => {
    await runMigrations(pool);
    await clean();
    await pool.query(
      "insert into tenants (id,name,slug) values ($1,'Other','__r006-other') on conflict (id) do nothing",
      [OTHER]);
  });
  afterAll(async () => { await clean(); await pool.end(); });

  it("upserts + gets a connector, merging fields on re-upsert", async () => {
    await runTenant(FOUNDING_TENANT_ID, async () => {
      await upsertConnector("gmail", { status: "connected", credentials: { refresh_token: "r" } });
      let c = await getConnector("gmail");
      expect(c?.status).toBe("connected");
      expect(c?.credentials).toEqual({ refresh_token: "r" });

      await upsertConnector("gmail", { cursor: { historyId: "42" } }); // must not clobber creds
      c = await getConnector("gmail");
      expect(c?.credentials).toEqual({ refresh_token: "r" });
      expect(c?.cursor).toEqual({ historyId: "42" });
    });
  });

  it("stores tenant-scoped selections outside encrypted credentials", async () => {
    await runTenant(FOUNDING_TENANT_ID, async () => {
      await upsertConnector("notion", {
        status: "connected", credentials: { access_token: "__r006-secret" },
        settings: { selected_page_ids: ["page-1"] }, cursor: { opaque: "cursor" },
      });
      const connector = await getConnector("notion");
      expect(connector?.credentials).toEqual({ access_token: "__r006-secret" });
      expect(connector?.settings).toEqual({ selected_page_ids: ["page-1"] });
      const raw = await pool.query("select credentials,settings from connectors where tenant_id=$1 and type='notion'", [FOUNDING_TENANT_ID]);
      expect(JSON.stringify(raw.rows[0].credentials)).not.toContain("__r006-secret");
      expect(raw.rows[0].settings).toEqual({ selected_page_ids: ["page-1"] });
    });
  });

  it("insertEvidence dedupes by thread_id; unpromoted + markPromoted work", async () => {
    await runTenant(FOUNDING_TENANT_ID, async () => {
      const c = await upsertConnector("slack", { status: "connected" });
      const first = await insertEvidence({
        connector_id: c.id, source_ref: { thread_id: "TT1" }, kind: "skill_evidence",
        summary: "__r006 a", confidence: 0.9,
      });
      expect(first).not.toBeNull();
      const dup = await insertEvidence({
        connector_id: c.id, source_ref: { thread_id: "TT1", permalink: "p" }, kind: "skill_evidence",
        summary: "__r006 b",
      });
      expect(dup).toBeNull(); // deduped on thread_id

      expect((await unpromotedEvidence("skill_evidence")).some((e) => e.id === first!.id)).toBe(true);
      await markPromoted([first!.id], "skill", "00000000-0000-0000-0000-000000000009");
      expect((await unpromotedEvidence("skill_evidence")).some((e) => e.id === first!.id)).toBe(false);
    });
  });

  it("is tenant-isolated: another tenant sees none of it", async () => {
    await runTenant(OTHER, async () => {
      expect(await listConnectors()).toHaveLength(0);
      expect(await unpromotedEvidence("skill_evidence")).toHaveLength(0);
    });
  });
});
