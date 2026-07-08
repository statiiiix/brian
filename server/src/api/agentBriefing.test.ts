import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))),
}));

import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { pool } from "../db/pool.js";
import { createSkill, setStatus } from "../skills/repo.js";
import { createContext } from "../context/repo.js";
import { buildApp } from "./app.js";
import { testClient } from "../test/http.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("agent briefing API", () => {
  const app = testClient(buildApp());
  beforeAll(async () => { await runMigrations(pool); await app.ready(); });
  afterAll(async () => { await app.close(); await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("returns matched skill and context in one call", async () => {
    const skill = await createSkill({
      name: "Refund handling",
      trigger: "A customer requests a refund on a past order.",
      inputs: ["order_id"],
      procedure: "Look up order; if within rules and under guardrails, refund; else escalate.",
      hard_rules: ["Never refund more than $200 without manager approval."],
      tools: ["get_order", "issue_refund"],
      guardrails: ["If refund amount > $200, STOP and escalate."],
      escalation_target: "Support team lead",
      examples: [],
      owner: "Support team lead",
    });
    await setStatus(skill.id, "active");
    await createContext({
      content: "We prioritize retention over margin",
      summary: null, tags: [], source: null, owner: null,
    });

    const res = await app.inject({
      method: "POST", url: "/api/agent/briefing",
      payload: { query: "customer wants a refund" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.skill?.name).toBe("Refund handling");
    expect(body.context?.content).toBe("We prioritize retention over margin");
  });

  it("returns nulls when nothing matches", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/agent/briefing", payload: { query: "anything" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ skill: null, context: null });
  });

  it("rejects a missing query with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/agent/briefing", payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
