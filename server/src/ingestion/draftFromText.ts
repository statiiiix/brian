import Anthropic from "@anthropic-ai/sdk";
import { createSkill } from "../skills/repo.js";
import { parseNewSkill } from "../skills/validation.js";
import type { Skill } from "../skills/types.js";

export interface AnthropicLike {
  messages: {
    create(args: any): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

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

let defaultClient: AnthropicLike | null = null;
function client(): AnthropicLike {
  if (!defaultClient) defaultClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return defaultClient as unknown as AnthropicLike;
}

export async function draftFromText(text: string, c: AnthropicLike = client()): Promise<Skill> {
  const res = await c.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: "user", content: `Draft a skill from this:\n\n${text}` }],
  });
  const textOut = res.content.find((b) => b.type === "text")?.text ?? "";
  const raw = extractJson(textOut);
  const input = parseNewSkill(raw); // throws ValidationError if Claude returned a bad shape
  return createSkill(input); // stored as draft, never auto-active
}
