import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { createInterview, appendMessage, getInterview } from "./repo.js";
import { runTurn, MAX_QUESTIONS } from "./engine.js";
import type { LlmClient } from "../llm/complete.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const askingOut = JSON.stringify({
  status: "asking", question: "What triggers a refund request?",
  coverage: { trigger: false, inputs: false, procedure: false, hard_rules: false,
    guardrails: false, escalation_target: false, examples: false },
  draft: null,
});

const draft = {
  name: "Refund Handling", trigger: "Customer asks for a refund", inputs: ["order_id"],
  procedure: "1. Look up order. 2. Refund if in window.", hard_rules: ["Never refund > $200"],
  tools: ["get_order"], guardrails: ["STOP if > $200"], escalation_target: "Support lead",
  examples: [{ scenario: "s", correct_action: "a" }], owner: null,
};
const readyOut = JSON.stringify({
  status: "ready", question: null,
  coverage: { trigger: true, inputs: true, procedure: true, hard_rules: true,
    guardrails: true, escalation_target: true, examples: true },
  draft,
});

const fake = (outputs: string[]): LlmClient => {
  let i = 0;
  return { complete: vi.fn(async () => outputs[Math.min(i++, outputs.length - 1)]) };
};

d("interview engine", () => {
  beforeAll(async () => { await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("asking turn appends a brian question and stores coverage", async () => {
    const iv = await createInterview({ topic: "refunds" });
    const out = await runTurn(iv, fake([askingOut]));
    expect(out.status).toBe("active");
    expect(out.messages.at(-1)).toMatchObject({ role: "brian", content: "What triggers a refund request?" });
  });

  it("ready turn validates the draft, fills owner from interview, sets status ready", async () => {
    const iv = await createInterview({ topic: "refunds", owner: "Sam" });
    const out = await runTurn(iv, fake([readyOut]));
    expect(out.status).toBe("ready");
    expect(out.draft?.owner).toBe("Sam");
    expect(out.coverage.examples).toBe(true);
  });

  it("retries once on malformed output, then succeeds", async () => {
    const iv = await createInterview({ topic: "refunds" });
    const llm = fake(["not json{{", askingOut]);
    const out = await runTurn(iv, llm);
    expect(out.messages.at(-1)?.content).toBe("What triggers a refund request?");
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it("throws after two malformed outputs", async () => {
    const iv = await createInterview({ topic: "refunds" });
    await expect(runTurn(iv, fake(["bad", "still bad"]))).rejects.toThrow();
  });

  it("forces a finish directive at the question cap and rejects further asking", async () => {
    let iv = await createInterview({ topic: "refunds" });
    for (let i = 0; i < MAX_QUESTIONS; i++) {
      iv = await appendMessage(iv.id, { role: "brian", content: `q${i}` });
    }
    const llm = fake([askingOut]);
    await expect(runTurn((await getInterview(iv.id))!, llm)).rejects.toThrow(/max questions/);
    const promptUser = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0][0].user as string;
    expect(promptUser).toMatch(/finish now/i);
  });
});
