import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { buildApp } from "./app.js";
import type { LlmClient } from "../llm/complete.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const asking = (q: string) => JSON.stringify({
  status: "asking", question: q,
  coverage: { trigger: true, inputs: false, procedure: false, hard_rules: false,
    guardrails: false, escalation_target: false, examples: false },
  draft: null,
});
const ready = JSON.stringify({
  status: "ready", question: null,
  coverage: { trigger: true, inputs: true, procedure: true, hard_rules: true,
    guardrails: true, escalation_target: true, examples: true },
  draft: {
    name: "Refund Handling", trigger: "refund requested", inputs: ["order_id"],
    procedure: "1. check. 2. refund.", hard_rules: ["never > $200"], tools: [],
    guardrails: ["STOP > $200"], escalation_target: "lead",
    examples: [{ scenario: "s", correct_action: "a" }], owner: null,
  },
});

function appWith(outputs: string[]) {
  let i = 0;
  const llm: LlmClient = { complete: vi.fn(async () => outputs[Math.min(i++, outputs.length - 1)]) };
  return buildApp({ llm });
}

d("interview API", () => {
  beforeAll(async () => { await runMigrations(pool); await pool.query("delete from interviews"); });
  afterAll(async () => { await pool.end(); });

  it("full loop: create → answer → ready → approve activates a skill", async () => {
    const app = appWith([asking("What triggers this?"), ready]);

    const created = await app.inject({ method: "POST", url: "/api/interviews",
      payload: { topic: "refunds", owner: "Sam" } });
    expect(created.statusCode).toBe(201);
    const iv = created.json();
    expect(iv.messages.at(-1)).toMatchObject({ role: "brian", content: "What triggers this?" });

    const answered = await app.inject({ method: "POST", url: `/api/interviews/${iv.id}/messages`,
      payload: { content: "A customer emails asking for money back." } });
    expect(answered.statusCode).toBe(200);
    expect(answered.json().status).toBe("ready");
    expect(answered.json().draft.name).toBe("Refund Handling");

    const approved = await app.inject({ method: "POST", url: `/api/interviews/${iv.id}/approve`,
      payload: { activate: true } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().skill.status).toBe("active");
    expect(approved.json().interview.status).toBe("completed");
    await app.close();
  });

  it("approve on a non-ready interview → 400; unknown id → 404; empty topic → 400", async () => {
    const app = appWith([asking("q?")]);
    const created = await app.inject({ method: "POST", url: "/api/interviews", payload: { topic: "x" } });
    const bad = await app.inject({ method: "POST",
      url: `/api/interviews/${created.json().id}/approve`, payload: {} });
    expect(bad.statusCode).toBe(400);

    const missing = await app.inject({ method: "GET",
      url: "/api/interviews/00000000-0000-0000-0000-000000000000" });
    expect(missing.statusCode).toBe(404);

    const noTopic = await app.inject({ method: "POST", url: "/api/interviews", payload: {} });
    expect(noTopic.statusCode).toBe(400);
    await app.close();
  });

  it("abandon works and list returns interviews", async () => {
    const app = appWith([asking("q?")]);
    const created = await app.inject({ method: "POST", url: "/api/interviews", payload: { topic: "z" } });
    const ab = await app.inject({ method: "POST",
      url: `/api/interviews/${created.json().id}/abandon` });
    expect(ab.json().status).toBe("abandoned");
    const list = await app.inject({ method: "GET", url: "/api/interviews" });
    expect(list.json().length).toBeGreaterThan(0);
    await app.close();
  });
});
