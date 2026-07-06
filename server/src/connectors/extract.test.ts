import { describe, it, expect } from "vitest";
import { extractThread } from "./extract.js";
import type { LlmClient } from "../llm/complete.js";
import type { RawThread } from "./types.js";

const thread: RawThread = {
  thread_id: "t1", permalink: "p",
  participants: [{ id: "a@us.com", is_company_member: true, is_bot: false }],
  messages: [{ from: "a@us.com", ts: "1", text: "When a refund is over $200 we escalate to the lead." }],
};

// Serve canned completions in order (last one repeats).
const llmReturning = (...outputs: string[]): LlmClient => {
  let i = 0;
  return { complete: async () => outputs[Math.min(i++, outputs.length - 1)] };
};
const ok = (kind: string) => JSON.stringify({ kind, confidence: 0.8, summary: "normalized" });

describe("connectors extract", () => {
  it("routes each kind through", async () => {
    expect((await extractThread(thread, llmReturning(ok("skill_evidence")))).kind).toBe("skill_evidence");
    expect((await extractThread(thread, llmReturning(ok("context_evidence")))).kind).toBe("context_evidence");
    expect((await extractThread(thread, llmReturning(ok("junk")))).kind).toBe("junk");
  });

  it("returns the model's confidence + summary", async () => {
    const r = await extractThread(thread, llmReturning(JSON.stringify({ kind: "skill_evidence", confidence: 0.42, summary: "S" })));
    expect(r.confidence).toBe(0.42);
    expect(r.summary).toBe("S");
  });

  it("retries once on malformed output", async () => {
    const r = await extractThread(thread, llmReturning("not json", ok("context_evidence")));
    expect(r.kind).toBe("context_evidence");
  });

  it("degrades to junk after two malformed outputs", async () => {
    const r = await extractThread(thread, llmReturning("nope", "still nope"));
    expect(r).toEqual({ kind: "junk", confidence: 0, summary: "" });
  });
});
