import { z } from "zod";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import { CONNECTOR_EXTRACT_JSON_SCHEMA } from "../llm/schemas.js";
import type { ExtractResult, RawThread } from "./types.js";

const SYSTEM = `You are Brian, extracting durable company knowledge from one company source.
Classify it as exactly one of:
- "skill_evidence": shows HOW the company runs a recurring PROCESS — steps, rules, thresholds, who does what.
- "context_evidence": states a durable DECISION, preference, or fact — a goal, a policy choice, a naming convention.
- "junk": scheduling, chit-chat, one-off logistics, or anything that is not a reusable process or decision.
For a conversation, distinguish a confirmed decision from a proposal, question, anecdote, or outdated answer. Preserve corrections, exceptions, and the reason for escalation.
For a document, distinguish executable procedure from background prose. A useful procedure names a trigger and some combination of required inputs, steps, conditions, limits, owner, or escalation path.
Write a compact evidence summary an AI agent could act on. Include only supported elements, using these labels when present: Trigger, Inputs, Procedure, Rules, Exceptions, Escalation, Owner.
Confidence measures how explicitly the source supports the summary, not how plausible it sounds.
Do not merge unrelated processes. Do not invent, smooth over contradictions, or treat silence as a rule.`;

const resultSchema = z.object({
  kind: z.enum(["skill_evidence", "context_evidence", "junk"]),
  confidence: z.number(),
  summary: z.string(),
});

function buildUser(t: RawThread, focus?: string): string {
  const transcript = t.messages.map((m) => `${m.from}: ${m.text}`).join("\n");
  const label = t.source_kind === "document" ? `Document ${t.title ?? t.thread_id}` : `Thread ${t.thread_id}`;
  const focusPrompt = focus?.trim()
    ? `\nThe user wants an agent to learn this specific judgment: ${focus.trim()}\nExtract only evidence that helps define that judgment. Mark unrelated material as junk. If the source exposes a missing boundary or contradiction, preserve it in the summary instead of resolving it yourself.\n`
    : "";
  return `${label}:${focusPrompt}\n${transcript}`;
}

// Classify a single thread. Retries once on malformed output, then degrades to
// junk so one bad thread never fails a whole sync run. Does not persist — the
// sync orchestrator embeds + writes the evidence row for non-junk results.
export async function extractThread(t: RawThread, llm: LlmClient = defaultLlm(), focus?: string): Promise<ExtractResult> {
  const args = {
    system: SYSTEM,
    user: buildUser(t, focus),
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
