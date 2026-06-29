import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Deterministic fake embeddings: a sparse vector keyed on keywords.
function fakeVec(text: string): number[] {
  const v = Array.from({ length: 1536 }, () => 0);
  if (/refund/i.test(text)) v[0] = 1;
  if (/incident|outage|sev/i.test(text)) v[1] = 1;
  return v;
}
vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async (t: string) => fakeVec(t)),
}));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { createSkill, setStatus, findSkill } from "./repo.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("findSkill", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query("delete from skill_versions");
    await pool.query("delete from skills");
  });

  it("returns the active skill whose trigger matches the query", async () => {
    const refund = await createSkill(
      { name: "Refund Handling", trigger: "customer wants a refund", inputs: [], procedure: "refund flow",
        hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    const incident = await createSkill(
      { name: "Incident Response", trigger: "production outage sev-2", inputs: [], procedure: "incident flow",
        hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    await setStatus(refund.id, "active", pool);
    await setStatus(incident.id, "active", pool);

    const hit = await findSkill("a customer is asking for a refund", pool);
    expect(hit?.name).toBe("Refund Handling");
  });

  it("ignores non-active skills", async () => {
    const refund = await createSkill(
      { name: "Refund Handling", trigger: "customer wants a refund", inputs: [], procedure: "refund flow",
        hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    // left as draft
    const hit = await findSkill("refund please", pool);
    expect(hit).toBeNull();
    expect(refund.status).toBe("draft");
  });
});
