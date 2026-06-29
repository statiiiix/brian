// JSON Schemas for OpenAI Structured Outputs (strict mode).
// Strict mode rules: every object lists all properties in `required`,
// sets additionalProperties:false, and uses ["type","null"] for nullable fields.

const SKILL_PROPERTIES: Record<string, unknown> = {
  name: { type: "string" },
  trigger: { type: "string" },
  inputs: { type: "array", items: { type: "string" } },
  procedure: { type: "string" },
  hard_rules: { type: "array", items: { type: "string" } },
  tools: { type: "array", items: { type: "string" } },
  guardrails: { type: "array", items: { type: "string" } },
  escalation_target: { type: ["string", "null"] },
  examples: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["scenario", "correct_action"],
      properties: { scenario: { type: "string" }, correct_action: { type: "string" } },
    },
  },
  owner: { type: ["string", "null"] },
};

export const SKILL_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(SKILL_PROPERTIES),
  properties: SKILL_PROPERTIES,
};

const CONTEXT_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "confidence", "content", "summary", "tags"],
  properties: {
    kind: { type: "string", enum: ["context"] },
    confidence: { type: "number" },
    content: { type: "string" },
    summary: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
};

const SKILL_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "confidence", "skill"],
  properties: {
    kind: { type: "string", enum: ["skill"] },
    confidence: { type: "number" },
    skill: SKILL_JSON_SCHEMA,
  },
};

export const CAPTURE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: { anyOf: [CONTEXT_ITEM_SCHEMA, SKILL_ITEM_SCHEMA] },
    },
  },
};
