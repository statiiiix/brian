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

export const INTERVIEW_TURN_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["status", "question", "coverage", "draft"],
  properties: {
    status: { type: "string", enum: ["asking", "ready"] },
    question: { type: ["string", "null"] },
    coverage: {
      type: "object",
      additionalProperties: false,
      required: ["trigger", "inputs", "procedure", "hard_rules", "guardrails", "escalation_target", "examples"],
      properties: {
        trigger: { type: "boolean" }, inputs: { type: "boolean" },
        procedure: { type: "boolean" }, hard_rules: { type: "boolean" },
        guardrails: { type: "boolean" }, escalation_target: { type: "boolean" },
        examples: { type: "boolean" },
      },
    },
    draft: { anyOf: [SKILL_JSON_SCHEMA, { type: "null" }] },
  },
};

// Connectors: classify one communication thread into reusable knowledge.
export const CONNECTOR_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "confidence", "summary"],
  properties: {
    kind: { type: "string", enum: ["skill_evidence", "context_evidence", "junk"] },
    confidence: { type: "number" },
    summary: { type: "string" },
  },
};
