import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { createSkill, setStatus, getSkill } from "../skills/repo.js";
import { markStale } from "./staleness.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("markStale", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await pool.query("delete from skill_versions"); await pool.query("delete from skills"); });

  it("flags an active skill last reviewed beyond the window", async () => {
    const s = await createSkill(
      { name: "Old", trigger: "t", inputs: [], procedure: "p", hard_rules: [], tools: [],
        guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    await setStatus(s.id, "active", pool);
    await pool.query(`update skills set last_reviewed_at = now() - interval '60 days' where id = $1`, [s.id]);

    const count = await markStale(30, pool);
    expect(count).toBe(1);
    expect((await getSkill(s.id, pool))?.status).toBe("needs_review");
  });

  it("leaves freshly reviewed skills active", async () => {
    const s = await createSkill(
      { name: "Fresh", trigger: "t", inputs: [], procedure: "p", hard_rules: [], tools: [],
        guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    await setStatus(s.id, "active", pool);
    const count = await markStale(30, pool);
    expect(count).toBe(0);
    expect((await getSkill(s.id, pool))?.status).toBe("active");
  });
});
