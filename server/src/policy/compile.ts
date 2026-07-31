// Compile a skill's English hard rules into deterministic constraints.
//
// This runs ONCE, when a skill is saved — never on the hot path of an action.
// That is the whole point: enforcement at action time must be deterministic,
// auditable, and fast, so the model's judgement is spent here (where a human
// reviews the result in the dashboard) rather than at the moment of a refund.
//
// Anything the model cannot reduce to a check comes back as `advisory`, which
// the dashboard renders as "not enforced". Guessing a constraint would be worse
// than admitting we cannot enforce the rule.

import { z } from "zod";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import { POLICY_COMPILE_JSON_SCHEMA } from "../llm/schemas.js";
import { EMPTY_POLICY, type SkillConstraint, type SkillPolicy } from "./types.js";

const SYSTEM = `You convert a company's hard rules into machine-checkable constraints that a
server evaluates before an AI agent performs an irreversible action.

For each hard rule, emit exactly one entry:
- "max"/"min": a numeric limit. field is the numeric value being limited, number_value is the limit.
- "max_age_days": a recency window. field is the timestamp being aged, number_value is the day count.
- "equals"/"one_of"/"not_one_of": permitted or forbidden values. Use values for lists, text_value for equals.
- "matches": a regular expression the value must match (text_value holds the pattern).
- "required": the field must be present and non-empty.
- "never": the action is categorically forbidden.
- "advisory": the rule cannot be checked mechanically (it needs human judgement,
  or references information the server cannot see). Set advisory_reason.

Field naming: use "args.<name>" for a value the agent passes to the tool (args.amount,
args.to), and "facts.<subject>.<name>" for a value established by an earlier lookup
(facts.order.placed_at, facts.customer.plan). Prefer args when the rule constrains what
the agent is about to do.

tools lists the tool names the rule governs; use ["*"] when it governs every action.
message is what the agent is told when the rule blocks it — direct, and it must say what
to do instead (escalate, get approval).

Be conservative. If a rule is vague, aspirational, or needs context you cannot name as a
field, return kind "advisory". Never invent a numeric limit the rule does not state.`;

const ruleSchema = z.object({
  source_rule: z.string().min(1),
  kind: z.enum([
    "max", "min", "equals", "one_of", "not_one_of", "matches",
    "required", "max_age_days", "never", "advisory",
  ]),
  tools: z.array(z.string()).default([]),
  field: z.string().nullable().default(null),
  number_value: z.number().nullable().default(null),
  text_value: z.string().nullable().default(null),
  values: z.array(z.string()).nullable().default(null),
  message: z.string().default(""),
  advisory_reason: z.string().nullable().default(null),
});

export type CompiledRule = z.infer<typeof ruleSchema>;

const NEEDS_FIELD = new Set(["max", "min", "equals", "one_of", "not_one_of", "matches", "required", "max_age_days"]);
const NEEDS_NUMBER = new Set(["max", "min", "max_age_days"]);
const NEEDS_VALUES = new Set(["one_of", "not_one_of"]);

/**
 * Narrow one model-emitted rule into a constraint. Returns a string reason when
 * the rule is unusable, so the caller can record it as advisory instead of
 * dropping it silently.
 */
export function toConstraint(rule: CompiledRule, id: string, fallbackTools: string[]): SkillConstraint | string {
  if (rule.kind === "advisory") return rule.advisory_reason ?? "needs human judgement";
  if (NEEDS_FIELD.has(rule.kind) && !rule.field) return "no checkable field was identified";
  if (NEEDS_NUMBER.has(rule.kind) && rule.number_value === null) return "no numeric limit was identified";
  if (NEEDS_VALUES.has(rule.kind) && (!rule.values || rule.values.length === 0)) return "no value list was identified";
  if (rule.kind === "equals" && rule.text_value === null && rule.number_value === null) {
    return "no comparison value was identified";
  }
  if (rule.kind === "matches") {
    if (!rule.text_value) return "no pattern was identified";
    try {
      new RegExp(rule.text_value);
    } catch {
      return "the generated pattern was not a valid expression";
    }
  }

  const field = rule.field ?? "";
  const check = ((): SkillConstraint["check"] => {
    switch (rule.kind) {
      case "max": return { kind: "max", field, value: rule.number_value! };
      case "min": return { kind: "min", field, value: rule.number_value! };
      case "max_age_days": return { kind: "max_age_days", field, value: rule.number_value! };
      case "equals": return { kind: "equals", field, value: rule.number_value ?? rule.text_value! };
      case "one_of": return { kind: "one_of", field, values: rule.values! };
      case "not_one_of": return { kind: "not_one_of", field, values: rule.values! };
      case "matches": return { kind: "matches", field, pattern: rule.text_value! };
      case "required": return { kind: "required", field };
      case "never": return { kind: "never" };
    }
  })();

  // An unscoped constraint governs every tool: a rule that named no tool is a
  // company-wide rule, and narrowing it to nothing would silently disable it.
  const tools = rule.tools.length > 0 ? rule.tools : fallbackTools.length > 0 ? fallbackTools : ["*"];
  return {
    id,
    source_rule: rule.source_rule,
    tools,
    check,
    message: rule.message.trim() || `Blocked by company rule: ${rule.source_rule}`,
  };
}

/** Narrow a batch of model-emitted rules into a policy. Pure — no I/O. */
export function parsePolicy(raw: unknown, fallbackTools: string[], compiledAt: string): SkillPolicy {
  const parsed = z.object({ rules: z.array(ruleSchema) }).safeParse(raw);
  if (!parsed.success) return { ...EMPTY_POLICY, compiled_at: compiledAt };

  const constraints: SkillConstraint[] = [];
  const advisory: SkillPolicy["advisory"] = [];
  parsed.data.rules.forEach((rule, index) => {
    const result = toConstraint(rule, `c${index + 1}`, fallbackTools);
    if (typeof result === "string") advisory.push({ source_rule: rule.source_rule, reason: result });
    else constraints.push(result);
  });
  return { constraints, advisory, compiled_at: compiledAt };
}

export interface CompilableSkill {
  name: string;
  hard_rules: string[];
  guardrails: string[];
  tools: string[];
}

/** Compile hard rules + guardrails into an enforceable policy for a skill. */
export async function compilePolicy(
  skill: CompilableSkill,
  llm: LlmClient = defaultLlm(),
  now: () => Date = () => new Date(),
): Promise<SkillPolicy> {
  const rules = [...skill.hard_rules, ...skill.guardrails].filter((r) => r.trim());
  const compiledAt = now().toISOString();
  if (rules.length === 0) return { ...EMPTY_POLICY, compiled_at: compiledAt };

  const out = await llm.complete({
    system: SYSTEM,
    effort: "medium",
    user: [
      `Skill: ${skill.name}`,
      `Tools this skill may use: ${skill.tools.join(", ") || "(unspecified)"}`,
      "",
      "Hard rules (non-negotiable):",
      ...skill.hard_rules.map((r) => `- ${r}`),
      "",
      "Guardrails (stop and escalate conditions):",
      ...skill.guardrails.map((r) => `- ${r}`),
    ].join("\n"),
    schema: { name: "compiled_policy", schema: POLICY_COMPILE_JSON_SCHEMA },
  });

  let raw: unknown;
  try {
    raw = JSON.parse(out);
  } catch {
    // A model that returns junk must not quietly produce an unenforced skill.
    return {
      constraints: [],
      advisory: rules.map((r) => ({ source_rule: r, reason: "the rule compiler returned unreadable output" })),
      compiled_at: compiledAt,
    };
  }
  return parsePolicy(raw, skill.tools, compiledAt);
}
