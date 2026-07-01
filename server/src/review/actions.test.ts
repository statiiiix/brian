import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { createSkill, setStatus, getSkill } from "../skills/repo.js";
import { listReviewable, approveSkill, rejectSkill, formatSkillLine } from "./actions.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const base = {
  trigger: "t", inputs: [], procedure: "p", hard_rules: [], tools: [],
  guardrails: [], escalation_target: null, examples: [], owner: null,
};

d("review actions", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("lists draft and needs_review skills, not active ones", async () => {
    const a = await createSkill({ ...base, name: "Draft one" }, pool);
    const b = await createSkill({ ...base, name: "Flagged one" }, pool);
    await setStatus(b.id, "needs_review", pool);
    const c = await createSkill({ ...base, name: "Live one" }, pool);
    await setStatus(c.id, "active", pool);

    const list = await listReviewable(pool);
    const names = list.map((s) => s.name).sort();
    expect(names).toEqual(["Draft one", "Flagged one"]);
    expect(list.map((s) => s.id)).toContain(a.id);
  });

  it("approve activates and reject retires", async () => {
    const a = await createSkill({ ...base, name: "To approve" }, pool);
    const b = await createSkill({ ...base, name: "To reject" }, pool);

    const approved = await approveSkill(a.id, pool);
    expect(approved.status).toBe("active");
    expect(approved.last_reviewed_at).not.toBeNull();

    const rejected = await rejectSkill(b.id, pool);
    expect(rejected.status).toBe("retired");
    expect((await getSkill(a.id, pool))!.status).toBe("active");
  });

  it("formats a review line with id, status, name, version", () => {
    const line = formatSkillLine({
      id: "abc-123", name: "Refunds", status: "draft", version: 2, owner: "Sam",
    } as any);
    expect(line).toBe("[draft] Refunds (v2, owner: Sam)  id=abc-123");
  });
});
