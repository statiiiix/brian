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
  principles: { type: "array", items: { type: "string" } },
  quality_checks: { type: "array", items: { type: "string" } },
  sources: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["title", "url", "origin"],
      properties: {
        title: { type: "string" },
        url: { type: ["string", "null"] },
        origin: { type: "string", enum: ["company", "expert", "web"] },
      },
    },
  },
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
  required: [
    "status", "question", "coverage", "draft", "assumptions", "warnings",
    "research_query", "evidence",
  ],
  properties: {
    status: { type: "string", enum: ["asking", "ready"] },
    question: { type: ["string", "null"] },
    coverage: {
      type: "object",
      additionalProperties: false,
      required: [
        "trigger", "inputs", "principles", "procedure", "tools", "hard_rules",
        "guardrails", "escalation_target", "quality_checks", "examples",
      ],
      properties: Object.fromEntries([
        "trigger", "inputs", "principles", "procedure", "tools", "hard_rules",
        "guardrails", "escalation_target", "quality_checks", "examples",
      ].map((key) => [key, {
        type: "object",
        additionalProperties: false,
        required: ["status", "summary", "reason"],
        properties: {
          status: { type: "string", enum: ["defined", "not_applicable", "missing"] },
          summary: { type: ["string", "null"] },
          reason: { type: ["string", "null"] },
        },
      }])),
    },
    draft: {
      anyOf: [{
        type: "object",
        additionalProperties: false,
        required: [
          "name", "trigger", "inputs", "principles", "procedure", "hard_rules",
          "tools", "guardrails", "escalation_target", "quality_checks", "examples",
          "sources", "owner",
        ],
        properties: {
          name: { type: ["string", "null"] },
          trigger: { type: ["string", "null"] },
          inputs: { type: "array", items: { type: "string" } },
          principles: { type: "array", items: { type: "string" } },
          procedure: { type: ["string", "null"] },
          hard_rules: { type: "array", items: { type: "string" } },
          tools: { type: "array", items: { type: "string" } },
          guardrails: { type: "array", items: { type: "string" } },
          escalation_target: { type: ["string", "null"] },
          quality_checks: { type: "array", items: { type: "string" } },
          examples: SKILL_PROPERTIES.examples,
          sources: SKILL_PROPERTIES.sources,
          owner: { type: ["string", "null"] },
        },
      }, { type: "null" }],
    },
    assumptions: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    research_query: { type: ["string", "null"] },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["component", "statement", "origin", "source_title", "source_url"],
        properties: {
          component: {
            type: "string",
            enum: [
              "trigger", "inputs", "principles", "procedure", "tools", "hard_rules",
              "guardrails", "escalation_target", "quality_checks", "examples",
            ],
          },
          statement: { type: "string" },
          origin: { type: "string", enum: ["company", "expert", "web"] },
          source_title: { type: ["string", "null"] },
          source_url: { type: ["string", "null"] },
        },
      },
    },
  },
};

// Policy: compile a skill's English hard rules into machine-checkable rules.
// Deliberately flat (no oneOf/anyOf) because Structured Outputs strict mode
// does not accept discriminated unions; `parsePolicy` narrows it afterwards.
// A rule the model cannot reduce to a check must come back as kind "advisory"
// rather than a guessed constraint — a wrong constraint is worse than none.
export const POLICY_COMPILE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["rules"],
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "source_rule", "kind", "tools", "field", "number_value",
          "text_value", "values", "message", "advisory_reason",
        ],
        properties: {
          source_rule: { type: "string" },
          kind: {
            type: "string",
            enum: [
              "max", "min", "equals", "one_of", "not_one_of", "matches",
              "required", "max_age_days", "never", "advisory",
            ],
          },
          tools: { type: "array", items: { type: "string" } },
          field: { type: ["string", "null"] },
          number_value: { type: ["number", "null"] },
          text_value: { type: ["string", "null"] },
          values: { type: ["array", "null"], items: { type: "string" } },
          message: { type: "string" },
          advisory_reason: { type: ["string", "null"] },
        },
      },
    },
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
