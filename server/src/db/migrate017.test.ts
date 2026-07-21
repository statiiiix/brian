import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";
import { pool } from "./pool.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const sql = readFileSync(new URL("./migrations/017_connector_settings.sql", import.meta.url), "utf8");

describe("migration 017 privacy compatibility", () => {
  it("extends company-deletion erasure and its connector guard to settings", () => {
    expect(sql).toContain("new.settings := '{}'::jsonb");
    expect(sql).toContain("tenant_id,status,credentials,settings,cursor");
    expect(sql).toContain("coalesce(old.settings, '{}'::jsonb) <> '{}'::jsonb");
  });
});

d("migration 017: connector settings", () => {
  beforeAll(async () => {
    await runMigrations(pool);
    await pool.query("delete from connectors where type='__t017settings'");
  });
  afterAll(async () => {
    await pool.query("delete from connectors where type='__t017settings'");
    await pool.end();
  });

  it("adds non-null empty-json settings in the isolated migration schema and replays cleanly", async () => {
    const definition = await pool.query(
      `select is_nullable, column_default
         from information_schema.columns
        where table_schema=current_schema() and table_name='connectors' and column_name='settings'`,
    );
    expect(definition.rows[0].is_nullable).toBe("NO");
    expect(definition.rows[0].column_default).toContain("'{}'::jsonb");
    const inserted = await pool.query("insert into connectors (type) values ('__t017settings') returning settings");
    expect(inserted.rows[0].settings).toEqual({});
    await runMigrations(pool);
  });
});
