import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { runMigrations } from "./migrate.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("runMigrations", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await runMigrations(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("creates the core tables", async () => {
    const { rows } = await pool.query(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('skills','skill_versions','skill_links','executions')`
    );
    const names = rows.map((r) => r.table_name).sort();
    expect(names).toEqual(["executions", "skill_links", "skill_versions", "skills"]);
  });

  it("enables the vector extension", async () => {
    const { rows } = await pool.query(
      `select 1 from pg_extension where extname = 'vector'`
    );
    expect(rows.length).toBe(1);
  });
});
