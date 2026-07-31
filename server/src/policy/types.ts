// Compiled, machine-checkable form of a skill's hard rules.
//
// Hard rules are authored in English ("never refund more than $200"). English
// cannot be enforced — a model may or may not honour it. So each rule is
// compiled ONCE, at skill save time, into a deterministic predicate that the
// server evaluates before a destructive tool runs. Rules that cannot be
// compiled are kept as `advisory` so the dashboard can be honest about which
// rules are actually enforced and which only ride along in the prompt.

export type ConstraintCheck =
  // Numeric bounds: "refunds must not exceed $200" -> max(args.amount, 200)
  | { kind: "max"; field: string; value: number }
  | { kind: "min"; field: string; value: number }
  // Value membership: "only refund standard plans" -> one_of(facts.order.plan, [...])
  | { kind: "equals"; field: string; value: string | number | boolean }
  | { kind: "one_of"; field: string; values: (string | number)[] }
  | { kind: "not_one_of"; field: string; values: (string | number)[] }
  // Shape: "recipients must be a company address" -> matches(args.to, "@acme\\.com$")
  | { kind: "matches"; field: string; pattern: string }
  | { kind: "required"; field: string }
  // Time windows: "no refunds after 90 days" -> max_age_days(facts.order.placed_at, 90)
  | { kind: "max_age_days"; field: string; value: number }
  // Blanket prohibition: "never delete production data"
  | { kind: "never" };

export interface SkillConstraint {
  id: string;
  /** The hard-rule text this was compiled from, so denials cite the rule. */
  source_rule: string;
  /** Tool names this governs; ["*"] applies to every destructive tool. */
  tools: string[];
  check: ConstraintCheck;
  /** What the agent is told when this denies an action. */
  message: string;
}

/** A hard rule that could not be reduced to a deterministic check. */
export interface AdvisoryRule {
  source_rule: string;
  reason: string;
}

export interface SkillPolicy {
  constraints: SkillConstraint[];
  advisory: AdvisoryRule[];
  compiled_at: string | null;
  /**
   * The skill has hard rules that have not been compiled yet (newly written, or
   * edited since the last compile). The gate refuses irreversible actions under
   * a pending skill: enforcing yesterday's compiled limit after someone lowered
   * it today would be worse than refusing.
   */
  pending?: boolean;
}

export const EMPTY_POLICY: SkillPolicy = {
  constraints: [], advisory: [], compiled_at: null, pending: false,
};

/** Rules exist but no compile has produced anything enforceable for them. */
export function policyIsPending(policy: SkillPolicy): boolean {
  return policy.pending === true;
}

/** One governing skill's compiled policy, tagged so denials can cite it. */
export interface PolicyConstraintSet {
  skill_id: string | null;
  skill_name: string | null;
  /** Where a denial sends the agent; surfaced in the refusal message. */
  escalation_target?: string | null;
  policy: SkillPolicy;
}

/** A proposed tool call, plus the facts the agent has established this session. */
export interface ActionContext {
  tool: string;
  args: Record<string, unknown>;
  /** Results of prior safe lookups, keyed by subject: { order: {...} }. */
  facts: Record<string, unknown>;
  now?: Date;
}

export interface PolicyViolation {
  skill_id: string | null;
  skill_name: string | null;
  constraint_id: string;
  source_rule: string;
  message: string;
  /** Set when the rule could not be checked (missing fact) rather than failed. */
  unverifiable: boolean;
}

export type PolicyDecision =
  | { decision: "allow"; evaluated: number; violations: [] }
  | { decision: "deny"; evaluated: number; violations: PolicyViolation[] };
