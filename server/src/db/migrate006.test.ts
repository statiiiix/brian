import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runMigrations } from "./migrate.js";
import { pool } from "./pool.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const FOUNDING = "00000000-0000-0000-0000-000000000001";

d("migration 006: connectors + evidence", () => {
  beforeAll(async () => {
    await runMigrations(pool);
    await pool.query("delete from evidence where summary like '__t006%'");
    await pool.query("delete from connectors where type in ('__t006a','__t006b')");
  });
  afterAll(async () => {
    await pool.query("delete from evidence where summary like '__t006%'");
    await pool.query("delete from connectors where type in ('__t006a','__t006b')");
    await pool.end();
  });

  it("connectors defaults to the founding tenant + disabled, unique per (tenant,type)", async () => {
    const { rows } = await pool.query(
      "insert into connectors (type) values ('__t006a') returning tenant_id, status",
    );
    expect(rows[0].tenant_id).toBe(FOUNDING);
    expect(rows[0].status).toBe("disabled");
    await expect(
      pool.query("insert into connectors (type) values ('__t006a')"),
    ).rejects.toThrow(); // (founding, '__t006a') already exists
  });

  it("applies migration 017 in the isolated test schema with safe settings defaults", async () => {
    const { rows } = await pool.query(
      "insert into connectors (type) values ('__t006settings') returning settings",
    );
    expect(rows[0].settings).toEqual({});
  });

  it("evidence dedupes on (tenant, connector, thread_id)", async () => {
    const c = (await pool.query("insert into connectors (type) values ('__t006b') returning id")).rows[0].id;
    await pool.query(
      "insert into evidence (connector_id, source_ref, kind, summary) values ($1, $2, 'skill_evidence', '__t006 e1')",
      [c, JSON.stringify({ thread_id: "T1" })],
    );
    await expect(
      pool.query(
        "insert into evidence (connector_id, source_ref, kind, summary) values ($1, $2, 'skill_evidence', '__t006 e2')",
        [c, JSON.stringify({ thread_id: "T1", permalink: "p" })],
      ),
    ).rejects.toThrow(); // same thread_id under the same connector
  });

  it("enables RLS on connectors + evidence", async () => {
    const { rows } = await pool.query(
      `select c.relrowsecurity from pg_class c
        where c.oid in (to_regclass('connectors'), to_regclass('evidence'))`,
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.relrowsecurity).toBe(true);
  });

  it("is convergent (re-runs cleanly)", async () => {
    await runMigrations(pool);
  });
});
