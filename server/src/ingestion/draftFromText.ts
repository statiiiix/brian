import { createSkill } from "../skills/repo.js";
import { parseNewSkill } from "../skills/validation.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import type { Skill } from "../skills/types.js";

const SYSTEM = `You convert a company's process documentation into ONE structured skill.
Return ONLY a JSON object with keys: name, trigger, inputs (string[]), procedure,
hard_rules (string[]), tools (string[]), guardrails (string[]), escalation_target
(string|null), examples ({scenario, correct_action}[]), owner (string|null).
No prose, no markdown fences.`;

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("model returned no JSON");
  return JSON.parse(text.slice(start, end + 1));
}

export async function draftFromText(text: string, llm: LlmClient = defaultLlm()): Promise<Skill> {
  const out = await llm.complete({
    system: SYSTEM,
    user: `Draft a skill from this:\n\n${text}`,
    maxTokens: 2000,
  });
  const raw = extractJson(out);
  const input = parseNewSkill(raw); // throws ValidationError if the model returned a bad shape
  return createSkill(input); // stored as draft, never auto-active
}
