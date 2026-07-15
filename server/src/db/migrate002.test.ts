import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { runMigrations } from "./migrate.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("002 context migration", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("creates the context tables", async () => {
    const { rows } = await pool.query(
      `select table_name from information_schema.tables
       where table_schema=current_schema()
         and table_name in ('context_entries','context_versions')`
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(["context_entries", "context_versions"]);
  });
});
