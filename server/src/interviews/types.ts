import type { NewSkill } from "../skills/types.js";

export type InterviewStatus = "active" | "ready" | "completed" | "abandoned";

export interface InterviewMessage {
  role: "brian" | "expert";
  content: string;
  at: string;
}

export interface Coverage {
  trigger: boolean;
  inputs: boolean;
  procedure: boolean;
  hard_rules: boolean;
  guardrails: boolean;
  escalation_target: boolean;
  examples: boolean;
}

export const EMPTY_COVERAGE: Coverage = {
  trigger: false, inputs: false, procedure: false, hard_rules: false,
  guardrails: false, escalation_target: false, examples: false,
};

export interface Interview {
  id: string;
  topic: string;
  owner: string | null;
  status: InterviewStatus;
  messages: InterviewMessage[];
  coverage: Coverage;
  draft: NewSkill | null;
  resulting_skill_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
