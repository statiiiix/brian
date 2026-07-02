import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { runMigrations } from "./migrate.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("003 hnsw migration", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("replaces ivfflat embedding indexes with hnsw on skills and context_entries", async () => {
    const { rows } = await pool.query(
      `select tablename, indexdef from pg_indexes
       where schemaname = current_schema() and tablename in ('skills','context_entries')
         and indexdef like '%embedding%'`
    );
    const defs = rows.map((r) => r.indexdef.toLowerCase());
    expect(defs.length).toBeGreaterThanOrEqual(2);
    expect(defs.every((d) => d.includes("hnsw"))).toBe(true);
    expect(defs.some((d) => d.includes("ivfflat"))).toBe(false);
  });
});
