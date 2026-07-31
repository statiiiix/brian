// Deterministic evaluation of compiled constraints against a proposed action.
//
// Pure: no database, no model, no clock except the one passed in. Everything
// here must be reproducible, because a denial has to be explainable to an
// auditor months later ("rule R denied action A at time T for reason X").
//
// FAIL CLOSED is the governing principle. A constraint that applies to the tool
// but whose field cannot be resolved or coerced is a DENY, not an allow: an
// unverifiable rule is exactly the case where an agent would otherwise invent
// its own judgement.

import type {
  ActionContext, PolicyConstraintSet, PolicyDecision, PolicyViolation, SkillConstraint,
} from "./types.js";

const DAY_MS = 86_400_000;

function walk(root: unknown, parts: string[]): unknown {
  let cursor = root;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

/**
 * Resolve "args.amount" / "facts.order.plan". A bare path is tried against args
 * first and then facts, because a compiler prompt cannot be relied on to prefix
 * every field and an unresolved field would otherwise read as unverifiable.
 */
export function resolveField(action: ActionContext, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts[0] === "args") return walk(action.args, parts.slice(1));
  if (parts[0] === "facts") return walk(action.facts, parts.slice(1));
  const fromArgs = walk(action.args, parts);
  return fromArgs === undefined ? walk(action.facts, parts) : fromArgs;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    // Tolerate "$350" / "350.00" / "1,200" — agents pass money as text often.
    const cleaned = value.replace(/[$,\s]/g, "");
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

function comparable(value: unknown): string | number | boolean | undefined {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? value
    : undefined;
}

type CheckOutcome = "pass" | "fail" | "unverifiable";

/** Evaluate one check. Never throws — an unusable input is `unverifiable`. */
export function runCheck(check: SkillConstraint["check"], action: ActionContext): CheckOutcome {
  if (check.kind === "never") return "fail";

  const raw = resolveField(action, check.field);
  if (check.kind === "required") return raw === undefined || raw === null || raw === "" ? "fail" : "pass";
  if (raw === undefined || raw === null) return "unverifiable";

  switch (check.kind) {
    case "max": {
      const n = toNumber(raw);
      return n === undefined ? "unverifiable" : n <= check.value ? "pass" : "fail";
    }
    case "min": {
      const n = toNumber(raw);
      return n === undefined ? "unverifiable" : n >= check.value ? "pass" : "fail";
    }
    case "equals": {
      const v = comparable(raw);
      return v === undefined ? "unverifiable" : v === check.value ? "pass" : "fail";
    }
    case "one_of": {
      const v = comparable(raw);
      if (v === undefined || typeof v === "boolean") return "unverifiable";
      return check.values.includes(v) ? "pass" : "fail";
    }
    case "not_one_of": {
      const v = comparable(raw);
      if (v === undefined || typeof v === "boolean") return "unverifiable";
      return check.values.includes(v) ? "fail" : "pass";
    }
    case "matches": {
      const v = comparable(raw);
      if (v === undefined) return "unverifiable";
      let re: RegExp;
      try {
        re = new RegExp(check.pattern, "i");
      } catch {
        return "unverifiable"; // a bad compiled pattern must not silently allow
      }
      return re.test(String(v)) ? "pass" : "fail";
    }
    case "max_age_days": {
      const when = toDate(raw);
      if (!when) return "unverifiable";
      const now = action.now ?? new Date();
      const ageDays = (now.getTime() - when.getTime()) / DAY_MS;
      return ageDays <= check.value ? "pass" : "fail";
    }
    default:
      return "unverifiable";
  }
}

export function constraintApplies(constraint: SkillConstraint, tool: string): boolean {
  return constraint.tools.includes("*") || constraint.tools.includes(tool);
}

/**
 * Evaluate every governing skill's constraints against the proposed action.
 * Any single failing or unverifiable applicable constraint denies the action.
 */
export function evaluateAction(
  sets: PolicyConstraintSet[],
  action: ActionContext,
): PolicyDecision {
  const violations: PolicyViolation[] = [];
  let evaluated = 0;

  for (const set of sets) {
    for (const constraint of set.policy.constraints) {
      if (!constraintApplies(constraint, action.tool)) continue;
      evaluated += 1;
      const outcome = runCheck(constraint.check, action);
      if (outcome === "pass") continue;
      violations.push({
        skill_id: set.skill_id,
        skill_name: set.skill_name,
        constraint_id: constraint.id,
        source_rule: constraint.source_rule,
        message: outcome === "unverifiable"
          ? `${constraint.message} (could not verify "${fieldOf(constraint)}" — establish it first, e.g. with a lookup tool)`
          : constraint.message,
        unverifiable: outcome === "unverifiable",
      });
    }
  }

  return violations.length === 0
    ? { decision: "allow", evaluated, violations: [] }
    : { decision: "deny", evaluated, violations };
}

function fieldOf(constraint: SkillConstraint): string {
  return "field" in constraint.check ? constraint.check.field : constraint.check.kind;
}
