import { createSkill } from "../skills/repo.js";
import { parseNewSkill } from "../skills/validation.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import { SKILL_JSON_SCHEMA } from "../llm/schemas.js";
import type { Skill } from "../skills/types.js";

const SYSTEM = `You convert a company's process documentation into ONE structured skill.
Fill the procedure, hard_rules, tools, guardrails, and escalation_target from the text.
Leave fields empty or null when the text does not specify them.`;

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
    schema: { name: "skill", schema: SKILL_JSON_SCHEMA },
  });
  const raw = extractJson(out);
  const input = parseNewSkill(raw); // throws ValidationError if the model returned a bad shape
  return createSkill(input); // stored as draft, never auto-active
}
