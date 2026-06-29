export type SkillStatus = "draft" | "active" | "needs_review" | "retired";
export type ExecutionOutcome = "completed" | "escalated" | "failed";

export interface SkillExample {
  scenario: string;
  correct_action: string;
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
