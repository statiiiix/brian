import type { SkillPolicy } from "../policy/types.js";

export type SkillStatus = "draft" | "active" | "needs_review" | "retired";
export type ExecutionOutcome = "completed" | "escalated" | "failed";

export interface SkillExample {
  scenario: string;
  correct_action: string;
}

export interface SkillSourceRef {
  title: string;
  url: string | null;
  origin: "company" | "expert" | "web";
}

export interface Skill {
  id: string;
  name: string;
  trigger: string;
  inputs: string[];
  procedure: string;
  hard_rules: string[];
  tools: string[];
  guardrails: string[];
  escalation_target: string | null;
  examples: SkillExample[];
  owner: string | null;
  principles?: string[];
  quality_checks?: string[];
  sources?: SkillSourceRef[];
  /** Compiled, server-enforced form of hard_rules (see src/policy). */
  policy?: SkillPolicy;
  /**
   * Set on a draft that proposes a revision of an existing skill rather than a
   * new procedure. Activating such a draft applies it onto the target.
   */
  supersedes_skill_id?: string | null;
  status: SkillStatus;
  version: number;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewSkill {
  name: string;
  trigger: string;
  inputs: string[];
  procedure: string;
  hard_rules: string[];
  tools: string[];
  guardrails: string[];
  escalation_target: string | null;
  examples: SkillExample[];
  owner: string | null;
  principles?: string[];
  quality_checks?: string[];
  sources?: SkillSourceRef[];
}

export interface SkillVersion {
  id: string;
  skill_id: string;
  version: number;
  snapshot: Skill;
  changed_by: string | null;
  created_at: string;
}

export interface Execution {
  id: string;
  skill_id: string | null;
  skill_version: number | null;
  task_input: unknown;
  actions_taken: unknown;
  outcome: ExecutionOutcome | null;
  human_override: unknown;
  created_at: string;
}
