import type { NewSkill } from "../skills/types.js";
import type { SkillExample, SkillSourceRef } from "../skills/types.js";

export type InterviewStatus = "preparing" | "active" | "ready" | "completed" | "abandoned";

export interface InterviewMessage {
  role: "brian" | "expert";
  content: string;
  at: string;
}

export interface LegacyCoverage {
  trigger: boolean;
  inputs: boolean;
  procedure: boolean;
  hard_rules: boolean;
  guardrails: boolean;
  escalation_target: boolean;
  examples: boolean;
}

export const EMPTY_COVERAGE: LegacyCoverage = {
  trigger: false, inputs: false, procedure: false, hard_rules: false,
  guardrails: false, escalation_target: false, examples: false,
};

export type CoverageKey = keyof LegacyCoverage
  | "principles" | "tools" | "quality_checks";
export type ComponentStatus = "defined" | "not_applicable" | "missing";
export interface ComponentCoverage {
  status: ComponentStatus;
  summary: string | null;
  reason: string | null;
}
export type AdaptiveCoverage = Record<CoverageKey, ComponentCoverage>;
export type CoverageInput = Partial<Record<CoverageKey, boolean | ComponentCoverage>>;

const COVERAGE_KEYS: CoverageKey[] = [
  "trigger", "inputs", "principles", "procedure", "tools", "hard_rules",
  "guardrails", "escalation_target", "quality_checks", "examples",
];

const missingCoverage = (): ComponentCoverage => ({
  status: "missing", summary: null, reason: null,
});

export function normalizeCoverage(input: CoverageInput | null | undefined): AdaptiveCoverage {
  return Object.fromEntries(COVERAGE_KEYS.map((key) => {
    const value = input?.[key];
    if (typeof value === "boolean") {
      return [key, { status: value ? "defined" : "missing", summary: null, reason: null }];
    }
    return [key, value ?? missingCoverage()];
  })) as AdaptiveCoverage;
}

export function legacyCoverageFromAdaptive(coverage: AdaptiveCoverage): LegacyCoverage {
  return {
    trigger: coverage.trigger.status !== "missing",
    inputs: coverage.inputs.status !== "missing",
    procedure: coverage.procedure.status !== "missing",
    hard_rules: coverage.hard_rules.status !== "missing",
    guardrails: coverage.guardrails.status !== "missing",
    escalation_target: coverage.escalation_target.status !== "missing",
    examples: coverage.examples.status !== "missing",
  };
}

// One document of source material an interview is grounded in. Text is
// bounded at fetch time (see connectors/selectionContent.ts).
export interface SourceDocument {
  title: string;
  url: string;
  text: string;
}

export interface SourceContext {
  source_type: string;
  fetched_at: string;
  documents: SourceDocument[];
}

export type InterviewSourceKind = "connector" | "upload" | "web";
export type InterviewSourceStatus = "reading" | "ready" | "failed";

export interface InterviewSource {
  id: string;
  interview_id: string;
  kind: InterviewSourceKind;
  title: string;
  source_type: string;
  url: string | null;
  status: InterviewSourceStatus;
  extracted_text: string | null;
  idempotency_key: string;
  added_at: string;
  retrieved_at: string | null;
  error_code: string | null;
}

export interface SkillDraft {
  name: string | null;
  trigger: string | null;
  inputs: string[];
  principles: string[];
  procedure: string | null;
  hard_rules: string[];
  tools: string[];
  guardrails: string[];
  escalation_target: string | null;
  quality_checks: string[];
  examples: SkillExample[];
  sources: SkillSourceRef[];
  owner: string | null;
}

export interface InterviewEvidence {
  component: CoverageKey;
  statement: string;
  origin: "company" | "expert" | "web";
  source_title: string | null;
  source_url: string | null;
}

export interface Interview {
  id: string;
  topic: string;
  owner: string | null;
  status: InterviewStatus;
  messages: InterviewMessage[];
  coverage: LegacyCoverage;
  component_coverage: AdaptiveCoverage;
  draft: SkillDraft | NewSkill | null;
  source_context: SourceContext | null;
  assumptions: string[];
  warnings: string[];
  resulting_skill_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
