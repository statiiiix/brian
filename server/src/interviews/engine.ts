import { z } from "zod";
import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import { INTERVIEW_TURN_JSON_SCHEMA } from "../llm/schemas.js";
import { parseNewSkill } from "../skills/validation.js";
import { appendMessage, setTurnResult } from "./repo.js";
import type { Interview } from "./types.js";

export const MAX_QUESTIONS = 25;

const SYSTEM = `You are Brian, a company-brain interviewer. You are interviewing the person
who owns a business process, to turn their tacit knowledge into an executable skill with:
trigger (when it applies), inputs (info needed), procedure (step-by-step decision logic),
hard_rules (non-negotiable policy), guardrails (when to STOP and escalate),
escalation_target (who to escalate to), and examples (2-3 worked cases).
Ask exactly ONE question at a time — short, concrete, in plain language, like a sharp
consultant. Prefer questions about edge cases and thresholds ("what if it's over $200?").
Track which fields the transcript already covers in "coverage".
When every field is covered, return status "ready" with the complete skill draft,
written so an AI agent can follow it. Do not invent policy the expert did not state.`;

const coverageSchema = z.object({
  trigger: z.boolean(), inputs: z.boolean(), procedure: z.boolean(),
  hard_rules: z.boolean(), guardrails: z.boolean(),
  escalation_target: z.boolean(), examples: z.boolean(),
});
const turnSchema = z.object({
  status: z.enum(["asking", "ready"]),
  question: z.string().nullable(),
  coverage: coverageSchema,
  draft: z.unknown().nullable(),
});

function buildUser(iv: Interview, forceFinish: boolean): string {
  const transcript = iv.messages
    .map((m) => `${m.role === "brian" ? "Brian" : "Expert"}: ${m.content}`)
    .join("\n");
  return [
    `Process being captured: ${iv.topic}`,
    iv.owner ? `Process owner: ${iv.owner}` : "",
    transcript ? `Transcript so far:\n${transcript}` : "No questions asked yet — open the interview.",
    forceFinish
      ? 'You have reached the question limit. FINISH NOW: return status "ready" with your best complete draft from the transcript.'
      : "",
  ].filter(Boolean).join("\n\n");
}

export async function runTurn(
  iv: Interview, llm: LlmClient = defaultLlm(), p: pg.Pool = defaultPool
): Promise<Interview> {
  const questionsAsked = iv.messages.filter((m) => m.role === "brian").length;
  const forceFinish = questionsAsked >= MAX_QUESTIONS;
  const args = {
    system: SYSTEM,
    user: buildUser(iv, forceFinish),
    schema: { name: "interview_turn", schema: INTERVIEW_TURN_JSON_SCHEMA },
  };

  let parsed: z.infer<typeof turnSchema> | null = null;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      parsed = turnSchema.parse(JSON.parse(await llm.complete(args)));
    } catch (e) { lastErr = e; }
  }
  if (!parsed) throw new Error(`interview turn failed: ${String(lastErr)}`);

  if (parsed.status === "ready") {
    const raw = (parsed.draft ?? {}) as Record<string, unknown>;
    const draft = parseNewSkill({ ...raw, owner: raw.owner ?? iv.owner ?? null });
    return setTurnResult(iv.id, { coverage: parsed.coverage, draft }, p);
  }
  if (forceFinish) throw new Error("interview exceeded max questions");
  if (!parsed.question) throw new Error("interview turn failed: asking without a question");
  await setTurnResult(iv.id, { coverage: parsed.coverage }, p);
  return appendMessage(iv.id, { role: "brian", content: parsed.question }, p);
}
