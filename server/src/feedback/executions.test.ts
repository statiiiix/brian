import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { createSkill } from "../skills/repo.js";
import { logExecution, listExecutions } from "./executions.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("executions", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query("delete from executions");
    await pool.query("delete from skills");
  });

  it("logs and lists an execution for a skill", async () => {
    const s = await createSkill(
      { name: "X", trigger: "t", inputs: [], procedure: "p", hard_rules: [], tools: [],
        guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    await logExecution(
      { skill_id: s.id, skill_version: 1, task_input: { order_id: "ORD-1" },
        actions_taken: [{ tool: "get_order" }], outcome: "completed", human_override: null }, pool);
    const log = await listExecutions(s.id, pool);
    expect(log.length).toBe(1);
    expect(log[0].outcome).toBe("completed");
    expect((log[0].task_input as any).order_id).toBe("ORD-1");
  });
});
