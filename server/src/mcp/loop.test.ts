import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))),
}));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { createSkill, setStatus, findSkill } from "../skills/repo.js";
import { logExecution, listExecutions } from "../feedback/executions.js";
import { getOrder, issueRefund } from "./businessTools.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

// Minimal agent harness: it reads the skill's guardrails and obeys them.
async function runRefund(pool: pg.Pool, task: { order_id: string }) {
  const skill = await findSkill("customer wants a refund", pool);
  if (!skill) throw new Error("no skill");
  const order = getOrder(task.order_id);
  const actions: unknown[] = [{ tool: "get_order", args: task, result: order }];

  // guardrails: order not found, > $200, enterprise plan -> escalate
  const escalate = !order || order.amount > 200 || order.plan === "enterprise";
  let outcome: "completed" | "escalated";
  if (escalate) {
    outcome = "escalated";
  } else {
    const refund = issueRefund(order!.id, order!.amount);
    actions.push({ tool: "issue_refund", args: { order_id: order!.id, amount: order!.amount }, result: refund });
    outcome = "completed";
  }
  await logExecution(
    { skill_id: skill.id, skill_version: skill.version, task_input: task, actions_taken: actions, outcome, human_override: null },
    pool
  );
  return { outcome, skillId: skill.id };
}

d("end-to-end execution loop (M3)", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await runMigrations(pool);
  });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await resetDb(pool);
    const s = await createSkill(
      {
        name: "Refund Handling",
        trigger: "A customer requests a refund on a past order.",
        inputs: ["order_id"],
        procedure: "Look up order; if within rules and under guardrails, refund; else escalate.",
        hard_rules: ["Never refund more than $200 without manager approval."],
        tools: ["get_order", "issue_refund"],
        guardrails: ["If refund amount > $200, STOP and escalate.", "If the customer is on an enterprise plan, STOP and escalate.", "If the order cannot be found, STOP and escalate."],
        escalation_target: "Support team lead",
        examples: [],
        owner: "Support team lead",
      },
      pool
    );
    await setStatus(s.id, "active", pool);
  });

  it("completes a small in-policy refund and logs it", async () => {
    const r = await runRefund(pool, { order_id: "ORD-1" }); // $40 standard
    expect(r.outcome).toBe("completed");
    const log = await listExecutions(r.skillId, pool);
    expect(log.length).toBe(1);
    expect(log[0].outcome).toBe("completed");
  });

  it("escalates when a guardrail trips (> $200) and logs it", async () => {
    const r = await runRefund(pool, { order_id: "ORD-2" }); // $350
    expect(r.outcome).toBe("escalated");
    const log = await listExecutions(r.skillId, pool);
    expect(log[0].outcome).toBe("escalated");
  });

  it("escalates for an enterprise customer", async () => {
    const r = await runRefund(pool, { order_id: "ORD-3" }); // enterprise
    expect(r.outcome).toBe("escalated");
  });
});
