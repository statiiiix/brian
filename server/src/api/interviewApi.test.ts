import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { buildApp } from "./app.js";
import { testClient } from "../test/http.js";
import type { LlmClient } from "../llm/complete.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const defined = (summary: string) => ({ status: "defined", summary, reason: null });
const coverage = () => ({
  trigger: defined("A customer emails asking for money back"),
  inputs: defined("order id and refund reason"),
  principles: defined("Refund fast when the customer is clearly right"),
  procedure: defined("Look up the order, check the window, refund or escalate"),
  tools: defined("get_order and issue_refund"),
  hard_rules: defined("Never refund above $200 without the support lead"),
  guardrails: defined("Stop when the order is older than 90 days"),
  escalation_target: defined("Support lead"),
  quality_checks: defined("Amount matches the order and the reply explains the decision"),
  examples: defined("Two worked refund cases"),
});
const turn = (over: Record<string, unknown>) => JSON.stringify({
  status: "asking", question: null, coverage: coverage(), draft: null,
  assumptions: [], warnings: [], research_query: null, evidence: [], ...over,
});
const asking = (q: string) => turn({
  question: q,
  coverage: { ...coverage(), inputs: { status: "missing", summary: null, reason: null } },
});
const ready = turn({
  status: "ready",
  draft: {
    name: "Refund Handling",
    trigger: "A customer emails asking for money back on a paid order",
    inputs: ["order_id", "refund_reason"],
    principles: ["Refund fast when the customer is clearly right", "Explain every decision plainly"],
    procedure: [
      "1. Look up the order with get_order and confirm the customer paid.",
      "2. Confirm the purchase is inside the 30-day refund window.",
      "3. At or under $200, issue the refund and reply to the customer.",
      "4. Above $200, hand the thread to the support lead with an order summary.",
    ].join(" "),
    hard_rules: ["Never refund more than $200 without the support lead"],
    tools: ["get_order", "issue_refund"],
    guardrails: ["Stop if the order is older than 90 days"],
    escalation_target: "Support lead",
    quality_checks: [
      "The refund amount matches the order total",
      "The reply names the reason for the decision",
    ],
    examples: [
      {
        scenario: "A customer asks for a refund six days after buying",
        correct_action: "Confirm the order, refund the full amount, and explain the timing",
      },
      {
        scenario: "A customer asks for a $450 refund after two months",
        correct_action: "Do not refund; summarize the order and hand it to the support lead",
      },
    ],
    sources: [],
    owner: null,
  },
});

// Only the hidden parser call carries a schema; the interviewer call is prose.
function appWith(parserOutputs: string[], reply = "What should this skill do?") {
  let i = 0;
  const llm: LlmClient = {
    complete: vi.fn(async ({ schema }) => (schema
      ? parserOutputs[Math.min(i++, parserOutputs.length - 1)]
      : reply)),
  };
  return testClient(buildApp({ llm }));
}

d("interview API", () => {
  beforeAll(async () => { await runMigrations(pool); await pool.query("delete from interviews"); });
  afterAll(async () => { await pool.end(); });

  it("full loop: create → answer → ready → approve activates a skill", async () => {
    const app = appWith([ready], "What triggers this?");

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

  it("creates a source-grounded interview: derives topic, stores context, grounds the prompt", async () => {
    const llm: LlmClient = {
      complete: vi.fn(async ({ schema }) => (schema
        ? asking("What about refunds over $200?")
        : "I read the runbook — where should its $200 line not apply?")),
    };
    const app = testClient(buildApp({
      llm,
      selectionContext: async (type) => ({
        source_type: type,
        fetched_at: "2026-07-20T00:00:00.000Z",
        documents: [{ title: "Refund Runbook", url: "https://notion.so/r", text: "Refunds under $200 are automatic." }],
      }),
    }));

    const created = await app.inject({ method: "POST", url: "/api/interviews",
      payload: { source: { connector: "notion" } } });
    expect(created.statusCode).toBe(201);
    const iv = created.json();
    expect(iv.topic).toBe("notion skill: Refund Runbook");
    expect(iv.source_context.documents).toHaveLength(1);
    const prompt = (vi.mocked(llm.complete).mock.calls[0][0] as { user: string }).user;
    expect(prompt).toContain("Refunds under $200 are automatic.");
    await app.close();
  });

  it("rejects unsupported sources and surfaces caller-fixable selection states", async () => {
    const { SelectionContentError } = await import("../connectors/selectionContent.js");
    const app = testClient(buildApp({
      llm: { complete: vi.fn(async () => asking("q?")) },
      selectionContext: async () => { throw new SelectionContentError("selection_required"); },
    }));
    const unsupported = await app.inject({ method: "POST", url: "/api/interviews",
      payload: { source: { connector: "gmail" } } });
    expect(unsupported.statusCode).toBe(400);
    const missingSelection = await app.inject({ method: "POST", url: "/api/interviews",
      payload: { source: { connector: "notion" } } });
    expect(missingSelection.statusCode).toBe(409);
    expect(missingSelection.json()).toEqual({ error: "selection_required" });
    await app.close();
  });

  it("resume reactivates an abandoned interview; 400 when not abandoned", async () => {
    const app = appWith([asking("q?")]);
    const created = await app.inject({ method: "POST", url: "/api/interviews", payload: { topic: "resume-api" } });
    const id = created.json().id;

    const early = await app.inject({ method: "POST", url: `/api/interviews/${id}/resume` });
    expect(early.statusCode).toBe(400); // still active, cannot resume

    await app.inject({ method: "POST", url: `/api/interviews/${id}/abandon` });
    const resumed = await app.inject({ method: "POST", url: `/api/interviews/${id}/resume` });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().status).toBe("active");
    await app.close();
  });
});
