import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { createSkill, getSkill, listSkills, updateSkill, setStatus, listVersions } from "./repo.js";
import type { NewSkill } from "./types.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const sample: NewSkill = {
  name: "Refund Handling",
  trigger: "A customer requests a refund on a past order.",
  inputs: ["order_id", "customer_email", "reason"],
  procedure: "Look up the order, check the window, refund if valid.",
  hard_rules: ["Never refund an order older than 90 days."],
  tools: ["get_order", "issue_refund"],
  guardrails: ["If refund amount > $200, STOP and escalate."],
  escalation_target: "Support team lead",
  examples: [{ scenario: "$40 order, 5 days old", correct_action: "issue $40 refund" }],
  owner: "Support team lead",
};

d("skill repo", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await runMigrations(pool);
  });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("creates a skill as draft v1", async () => {
    const s = await createSkill(sample, pool);
    expect(s.status).toBe("draft");
    expect(s.version).toBe(1);
    expect(s.inputs).toEqual(["order_id", "customer_email", "reason"]);
    expect(await getSkill(s.id, pool)).not.toBeNull();
  });

  it("lists by status", async () => {
    const s = await createSkill(sample, pool);
    await setStatus(s.id, "active", pool);
    expect((await listSkills("active", pool)).length).toBe(1);
    expect((await listSkills("draft", pool)).length).toBe(0);
  });

  it("activating sets last_reviewed_at", async () => {
    const s = await createSkill(sample, pool);
    const a = await setStatus(s.id, "active", pool);
    expect(a.status).toBe("active");
    expect(a.last_reviewed_at).not.toBeNull();
  });

  it("update snapshots prior version and bumps version", async () => {
    const s = await createSkill(sample, pool);
    const u = await updateSkill(s.id, { procedure: "new steps" }, "tester", pool);
    expect(u.version).toBe(2);
    expect(u.procedure).toBe("new steps");
    const versions = await listVersions(s.id, pool);
    expect(versions.length).toBe(1);
    expect(versions[0].version).toBe(1);
    expect((versions[0].snapshot as any).procedure).toBe(sample.procedure);
  });
});
