import { z } from "zod";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import { CONNECTOR_EXTRACT_JSON_SCHEMA } from "../llm/schemas.js";
import type { ExtractResult, RawThread } from "./types.js";

const SYSTEM = `You are Brian, extracting durable company knowledge from one communication thread.
Classify it as exactly one of:
- "skill_evidence": shows HOW the company runs a recurring PROCESS — steps, rules, thresholds, who does what.
- "context_evidence": states a durable DECISION, preference, or fact — a goal, a policy choice, a naming convention.
- "junk": scheduling, chit-chat, one-off logistics, or anything that is not a reusable process or decision.
Write a normalized one-paragraph summary an AI agent could act on, and a confidence between 0 and 1.
Do not invent anything the thread does not say.`;

const resultSchema = z.object({
  kind: z.enum(["skill_evidence", "context_evidence", "junk"]),
  confidence: z.number(),
  summary: z.string(),
});

function buildUser(t: RawThread): string {
  const transcript = t.messages.map((m) => `${m.from}: ${m.text}`).join("\n");
  return `Thread ${t.thread_id}:\n${transcript}`;
}

// Classify a single thread. Retries once on malformed output, then degrades to
// junk so one bad thread never fails a whole sync run. Does not persist — the
// sync orchestrator embeds + writes the evidence row for non-junk results.
export async function extractThread(t: RawThread, llm: LlmClient = defaultLlm()): Promise<ExtractResult> {
  const args = {
    system: SYSTEM,
    user: buildUser(t),
    schema: { name: "connector_extract", schema: CONNECTOR_EXTRACT_JSON_SCHEMA },
  };
  let parsed: z.infer<typeof resultSchema> | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      parsed = resultSchema.parse(JSON.parse(await llm.complete(args)));
    } catch {
      // retry once, then fall through to junk
    }
  }
  return parsed ?? { kind: "junk", confidence: 0, summary: "" };
}
