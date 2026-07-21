import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { createInterview, appendMessage, getInterview } from "./repo.js";
import { runTurn, finishTurn, MAX_QUESTIONS } from "./engine.js";
import type { LlmClient } from "../llm/complete.js";
import type { ResearchClient } from "./research.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const defined = (summary: string) => ({ status: "defined", summary, reason: null });
const missing = () => ({ status: "missing", summary: null, reason: null });
const notApplicable = (reason: string) => ({ status: "not_applicable", summary: null, reason });

const fullCoverage = () => ({
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

const goodDraft = {
  name: "Refund Handling",
  trigger: "A customer emails asking for money back on a paid order",
  inputs: ["order_id", "refund_reason"],
  principles: [
    "Refund fast when the customer is clearly right",
    "Explain every decision in one plain sentence",
  ],
  procedure: [
    "1. Look up the order with get_order and confirm the customer paid.",
    "2. Confirm the purchase is inside the 30-day refund window.",
    "3. At or under $200, issue the refund with issue_refund and reply to the customer.",
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
      correct_action: "Confirm the order, refund the full amount, and reply explaining the timing",
    },
    {
      scenario: "A customer asks for a $450 refund after two months",
      correct_action: "Do not refund; summarize the order and hand the thread to the support lead",
    },
  ],
  sources: [],
  owner: null,
};

const turn = (over: Record<string, unknown> = {}) => JSON.stringify({
  status: "asking",
  question: null,
  coverage: fullCoverage(),
  draft: null,
  assumptions: [],
  warnings: [],
  research_query: null,
  evidence: [],
  ...over,
});

// The hidden parser is the only call that carries a JSON schema; the
// conversational interviewer call is plain text.
const fake = (parserOutputs: string[], reply = "Tell me more about that."): LlmClient => {
  let i = 0;
  return {
    complete: vi.fn(async ({ schema }) => (schema
      ? parserOutputs[Math.min(i++, parserOutputs.length - 1)]
      : reply)),
  };
};

const promptsOf = (llm: LlmClient) =>
  vi.mocked(llm.complete).mock.calls.map(([args]) => args);

async function started(topic: string, owner?: string) {
  const iv = await createInterview({ topic, owner: owner ?? null });
  await appendMessage(iv.id, { role: "brian", content: "What should this skill do?" });
  return appendMessage(iv.id, { role: "expert", content: "We refund unhappy customers fast." });
}

d("interview engine", () => {
  beforeAll(async () => { await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("opens with an AI-written welcome and does not run the parser yet", async () => {
    const iv = await createInterview({ topic: "refunds" });
    const llm = fake([], "Before we start — what should this skill do, and who relies on it?");
    const out = await runTurn(iv, llm);
    expect(out.status).toBe("active");
    expect(out.messages.at(-1)).toMatchObject({
      role: "brian",
      content: "Before we start — what should this skill do, and who relies on it?",
    });
    expect(promptsOf(llm)).toHaveLength(1);
    expect(promptsOf(llm)[0].schema).toBeUndefined();
  });

  it("parses the conversation into coverage and lets the interviewer ask the next question", async () => {
    const iv = await started("refunds");
    const llm = fake(
      [turn({ coverage: { ...fullCoverage(), inputs: missing() } })],
      "What do you need in front of you before you decide?",
    );
    const out = await runTurn(iv, llm);
    expect(out.messages.at(-1)?.content).toBe("What do you need in front of you before you decide?");
    expect(out.component_coverage.inputs.status).toBe("missing");
    expect(out.component_coverage.trigger.status).toBe("defined");
    expect(out.coverage.trigger).toBe(true);

    const [parser, interviewer] = promptsOf(llm);
    expect(parser.schema?.name).toBe("interview_turn");
    expect(interviewer.schema).toBeUndefined();
    // Gaps reach the interviewer as private notes, never as a checklist.
    expect(interviewer.user).toContain("inputs is still missing");
    expect(interviewer.user).toContain("never quote, list, or mention these");
  });

  it("keeps optional controls optional when the expert says they do not apply", async () => {
    const iv = await started("blog posts");
    const llm = fake([turn({
      status: "ready",
      coverage: {
        ...fullCoverage(),
        hard_rules: notApplicable("no policy limits on blog drafts"),
        guardrails: notApplicable("nothing here is irreversible"),
        escalation_target: notApplicable("the writer owns the final call"),
      },
      draft: { ...goodDraft, hard_rules: [], guardrails: [], escalation_target: null },
    })]);
    const out = await runTurn(iv, llm);
    expect(out.status).toBe("ready");
    expect(out.component_coverage.guardrails.status).toBe("not_applicable");
    expect(out.draft?.guardrails).toEqual([]);
  });

  it("refuses to finish on a thin draft and asks about the real gap instead", async () => {
    const iv = await started("refunds");
    const llm = fake(
      [turn({ status: "ready", draft: { ...goodDraft, procedure: "Refund it." } })],
      "Walk me through the last refund you handled, decision by decision.",
    );
    const out = await runTurn(iv, llm);
    expect(out.status).toBe("active");
    expect(out.messages.at(-1)?.content)
      .toBe("Walk me through the last refund you handled, decision by decision.");
    expect(promptsOf(llm).at(-1)?.user).toContain("procedure lacks executable step-by-step detail");
  });

  it("finishes on a complete draft, filling the owner from the interview", async () => {
    const iv = await started("refunds", "Sam");
    const out = await runTurn(iv, fake([turn({ status: "ready", draft: goodDraft })]));
    expect(out.status).toBe("ready");
    expect(out.draft?.owner).toBe("Sam");
    expect(out.draft?.quality_checks).toHaveLength(2);
    expect(out.draft?.principles).toHaveLength(2);
  });

  it("falls back to a concrete question when the conversational model fails", async () => {
    const iv = await started("refunds");
    const llm: LlmClient = {
      complete: vi.fn(async ({ schema }) => {
        if (schema) return turn({ coverage: { ...fullCoverage(), procedure: missing() } });
        throw new Error("model unavailable");
      }),
    };
    const out = await runTurn(iv, llm);
    expect(out.status).toBe("active");
    expect(out.messages.at(-1)?.content).toMatch(/Walk me through one real refunds task/);
  });

  it("grounds both the parser and the interviewer in selected source material", async () => {
    const iv = await createInterview({
      topic: "Refund handling from Notion",
      source_context: {
        source_type: "notion",
        fetched_at: "2026-07-20T00:00:00.000Z",
        documents: [{
          title: "Refund Runbook",
          url: "https://notion.so/refund-runbook",
          text: "Refunds under $200 are automatic.",
        }],
      },
    });
    const llm = fake([turn()], "I read the runbook — how should its $200 line apply here?");
    const opened = await runTurn(iv, llm);
    expect(promptsOf(llm)[0].user).toContain("Refunds under $200 are automatic.");
    expect(promptsOf(llm)[0].user).toContain("connected notion workspace");

    await appendMessage(opened.id, { role: "expert", content: "Same limit, but ask me over $500." });
    await runTurn((await getInterview(opened.id))!, llm);
    expect(promptsOf(llm)[1].schema?.name).toBe("interview_turn");
    expect(promptsOf(llm)[1].user).toContain("Refund Runbook");
  });

  it("researches one genuine gap, cites it, and re-parses with the result", async () => {
    const iv = await started("refunds");
    const research: ResearchClient = {
      search: vi.fn(async () => ({
        summary: "Card networks expect chargeback responses within 20 days.",
        citations: [{
          title: "Chargeback timelines",
          url: "https://example.com/chargebacks",
          retrieved_at: "2026-07-21T00:00:00.000Z",
        }],
      })),
    };
    const llm = fake(
      [turn({ research_query: "chargeback response window" }), turn()],
      "Outside guidance says 20 days — is that the bar you want?",
    );
    const out = await runTurn(iv, llm, undefined, [], research);
    expect(research.search).toHaveBeenCalledTimes(1);
    expect(out.messages.at(-1)?.content).toBe("Outside guidance says 20 days — is that the bar you want?");
    const prompts = promptsOf(llm);
    expect(prompts[1].user).toContain("Card networks expect chargeback responses within 20 days.");
    expect(prompts.at(-1)?.user).toContain("never as company policy");
  });

  it("warns instead of inventing an answer when research fails", async () => {
    const iv = await started("refunds");
    const research: ResearchClient = {
      search: vi.fn(async () => { throw new Error("search unavailable"); }),
    };
    const llm = fake([turn({ research_query: "chargeback response window" })], "What should we treat as authoritative?");
    const out = await runTurn(iv, llm, undefined, [], research);
    expect(out.warnings).toContain("Web research could not verify: chargeback response window");
    expect(out.messages.at(-1)?.content).toBe("What should we treat as authoritative?");
  });

  it("retries once on malformed parser output, then succeeds", async () => {
    const iv = await started("refunds");
    const llm = fake(["not json{{", turn()], "So what happens next?");
    const out = await runTurn(iv, llm);
    expect(out.messages.at(-1)?.content).toBe("So what happens next?");
    expect(promptsOf(llm).filter((args) => args.schema)).toHaveLength(2);
  });

  it("throws after two malformed parser outputs", async () => {
    const iv = await started("refunds");
    await expect(runTurn(iv, fake(["bad", "still bad"]))).rejects.toThrow();
  });

  it("completes the interview at the question cap instead of stranding it", async () => {
    let iv = await createInterview({ topic: "refunds", owner: "Sam" });
    for (let i = 0; i < MAX_QUESTIONS; i++) {
      iv = await appendMessage(iv.id, { role: "brian", content: `q${i}` });
    }
    const llm = fake([turn({ status: "ready", draft: goodDraft })]);
    const out = await runTurn((await getInterview(iv.id))!, llm);
    expect(out.status).toBe("ready");
    expect(out.draft?.name).toBe("Refund Handling");
    expect(promptsOf(llm)[0].user).toMatch(/finish now/i);
  });

  it("finishTurn lets the expert wrap up early with a complete draft", async () => {
    const iv = await started("refunds", "Sam");
    const llm = fake([turn({ status: "ready", draft: goodDraft })]);
    const out = await finishTurn(iv, llm);
    expect(out.status).toBe("ready");
    expect(out.draft?.owner).toBe("Sam");
    // finishTurn asks the parser to close out now, never the interviewer.
    expect(promptsOf(llm)).toHaveLength(1);
    expect(promptsOf(llm)[0].user).toMatch(/finish now/i);
  });

  it("finishTurn rejects a draft too thin to become a skill", async () => {
    const iv = await started("refunds");
    const llm = fake([turn({ status: "ready", draft: { ...goodDraft, name: "" } })]);
    await expect(finishTurn(iv, llm)).rejects.toThrow();
  });
});
