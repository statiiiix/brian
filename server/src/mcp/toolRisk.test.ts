import { describe, it, expect } from "vitest";
import { toolRisk, skillIsAutoSafe } from "./toolRisk.js";
import { evaluateAction, resolveField, runCheck } from "../policy/evaluate.js";
import { compilePolicy, parsePolicy, toConstraint, type CompiledRule } from "../policy/compile.js";
import type { ActionContext, PolicyConstraintSet, SkillConstraint } from "../policy/types.js";

describe("toolRisk", () => {
  it("classifies known safe and destructive tools", () => {
    expect(toolRisk("get_order")).toBe("safe");
    expect(toolRisk("issue_refund")).toBe("destructive");
  });
  it("defaults unknown tools to destructive", () => {
    expect(toolRisk("delete_everything")).toBe("destructive");
  });
  it("classifies gmail tools: draft is safe, send is destructive", () => {
    expect(toolRisk("create_email_draft")).toBe("safe");
    expect(toolRisk("send_email")).toBe("destructive");
    expect(skillIsAutoSafe(["create_email_draft"])).toBe(true);
    expect(skillIsAutoSafe(["create_email_draft", "send_email"])).toBe(false);
  });
});

describe("skillIsAutoSafe", () => {
  it("true when all tools are safe", () => {
    expect(skillIsAutoSafe(["get_order", "lookup_customer"])).toBe(true);
    expect(skillIsAutoSafe([])).toBe(true);
  });
  it("false when any tool is destructive or unknown", () => {
    expect(skillIsAutoSafe(["get_order", "issue_refund"])).toBe(false);
    expect(skillIsAutoSafe(["mystery_tool"])).toBe(false);
  });
});

// --- Policy enforcement (server/src/policy) ------------------------------
// The refund skill's real hard rules, compiled: "never refund more than $200"
// and "no refunds after 90 days".
const REFUND_LIMIT: SkillConstraint = {
  id: "c-limit",
  source_rule: "Never refund more than $200 without approval.",
  tools: ["issue_refund"],
  check: { kind: "max", field: "args.amount", value: 200 },
  message: "Refunds over $200 require approval from the escalation target.",
};
const REFUND_WINDOW: SkillConstraint = {
  id: "c-window",
  source_rule: "No refunds on orders older than 90 days.",
  tools: ["issue_refund"],
  check: { kind: "max_age_days", field: "facts.order.placed_at", value: 90 },
  message: "Orders older than 90 days are outside the refund window.",
};

const NOW = new Date("2026-07-24T00:00:00Z");

function refundPolicy(constraints: SkillConstraint[]): PolicyConstraintSet[] {
  return [{
    skill_id: "skill-refund",
    skill_name: "Refund Handling",
    policy: { constraints, advisory: [], compiled_at: "2026-07-24T00:00:00Z" },
  }];
}

function refundAction(amount: number, placedAt?: string): ActionContext {
  return {
    tool: "issue_refund",
    args: { order_id: "ORD-2", amount },
    facts: placedAt ? { order: { id: "ORD-2", placed_at: placedAt, plan: "standard" } } : {},
    now: NOW,
  };
}

describe("policy field resolution", () => {
  const action = refundAction(40, "2026-07-01T00:00:00Z");
  it("resolves args and facts paths", () => {
    expect(resolveField(action, "args.amount")).toBe(40);
    expect(resolveField(action, "facts.order.plan")).toBe("standard");
  });
  it("falls back to args then facts for bare names", () => {
    expect(resolveField(action, "amount")).toBe(40);
    expect(resolveField(action, "order.plan")).toBe("standard");
  });
  it("returns undefined for missing paths instead of throwing", () => {
    expect(resolveField(action, "facts.customer.tier")).toBeUndefined();
    expect(resolveField(action, "")).toBeUndefined();
  });
});

describe("policy checks", () => {
  it("enforces numeric bounds and tolerates money written as text", () => {
    const within = { ...refundAction(0), args: { amount: "$150.00" } };
    expect(runCheck({ kind: "max", field: "args.amount", value: 200 }, within)).toBe("pass");
    const over = { ...refundAction(0), args: { amount: "1,200" } };
    expect(runCheck({ kind: "max", field: "args.amount", value: 200 }, over)).toBe("fail");
  });
  it("enforces time windows against the supplied clock", () => {
    expect(runCheck(REFUND_WINDOW.check, refundAction(40, "2026-07-01T00:00:00Z"))).toBe("pass");
    expect(runCheck(REFUND_WINDOW.check, refundAction(40, "2026-01-01T00:00:00Z"))).toBe("fail");
  });
  it("reports a missing field as unverifiable, never as a pass", () => {
    expect(runCheck(REFUND_WINDOW.check, refundAction(40))).toBe("unverifiable");
    expect(runCheck({ kind: "max", field: "args.amount", value: 200 }, {
      tool: "issue_refund", args: {}, facts: {},
    })).toBe("unverifiable");
  });
  it("treats an uncoercible value as unverifiable rather than passing", () => {
    const action: ActionContext = { tool: "issue_refund", args: { amount: {} }, facts: {} };
    expect(runCheck({ kind: "max", field: "args.amount", value: 200 }, action)).toBe("unverifiable");
  });
  it("treats an invalid compiled regex as unverifiable, not as a pass", () => {
    const action: ActionContext = { tool: "send_email", args: { to: "a@b.com" }, facts: {} };
    expect(runCheck({ kind: "matches", field: "args.to", pattern: "([" }, action)).toBe("unverifiable");
  });
  it("supports membership and blanket prohibition", () => {
    const action = refundAction(40, "2026-07-01T00:00:00Z");
    expect(runCheck({ kind: "one_of", field: "facts.order.plan", values: ["standard"] }, action)).toBe("pass");
    expect(runCheck({ kind: "not_one_of", field: "facts.order.plan", values: ["standard"] }, action)).toBe("fail");
    expect(runCheck({ kind: "never" }, action)).toBe("fail");
  });
});

describe("evaluateAction", () => {
  it("allows an action that satisfies every governing rule", () => {
    const decision = evaluateAction(
      refundPolicy([REFUND_LIMIT, REFUND_WINDOW]),
      refundAction(40, "2026-07-01T00:00:00Z"),
    );
    expect(decision.decision).toBe("allow");
    expect(decision.evaluated).toBe(2);
  });

  it("denies the over-limit refund and cites the rule it broke", () => {
    const decision = evaluateAction(
      refundPolicy([REFUND_LIMIT, REFUND_WINDOW]),
      refundAction(350, "2026-07-01T00:00:00Z"),
    );
    expect(decision.decision).toBe("deny");
    expect(decision.violations).toHaveLength(1);
    expect(decision.violations[0].source_rule).toMatch(/\$200/);
    expect(decision.violations[0].skill_name).toBe("Refund Handling");
    expect(decision.violations[0].unverifiable).toBe(false);
  });

  it("denies when a rule cannot be verified, and says what is missing", () => {
    const decision = evaluateAction(refundPolicy([REFUND_WINDOW]), refundAction(40));
    expect(decision.decision).toBe("deny");
    expect(decision.violations[0].unverifiable).toBe(true);
    expect(decision.violations[0].message).toMatch(/could not verify/i);
  });

  it("ignores constraints scoped to other tools", () => {
    const decision = evaluateAction(refundPolicy([REFUND_LIMIT]), {
      tool: "send_email", args: { to: "a@b.com" }, facts: {}, now: NOW,
    });
    expect(decision.decision).toBe("allow");
    expect(decision.evaluated).toBe(0);
  });

  it("applies wildcard constraints to every tool", () => {
    const decision = evaluateAction(refundPolicy([{
      ...REFUND_LIMIT, id: "c-all", tools: ["*"], check: { kind: "never" },
      message: "This company never lets an agent act unsupervised.",
    }]), refundAction(10, "2026-07-01T00:00:00Z"));
    expect(decision.decision).toBe("deny");
  });

  it("collects violations across several governing skills", () => {
    const decision = evaluateAction([
      ...refundPolicy([REFUND_LIMIT]),
      {
        skill_id: "skill-finance",
        skill_name: "Finance Controls",
        policy: {
          constraints: [{
            id: "c-finance", source_rule: "Finance approves any customer credit.",
            tools: ["issue_refund"], check: { kind: "never" },
            message: "Finance must approve customer credits.",
          }],
          advisory: [], compiled_at: null,
        },
      },
    ], refundAction(350, "2026-07-01T00:00:00Z"));
    expect(decision.decision).toBe("deny");
    expect(decision.violations.map((v) => v.skill_name)).toEqual(["Refund Handling", "Finance Controls"]);
  });
});

// --- Compiling English hard rules into checks ----------------------------
function rule(over: Partial<CompiledRule>): CompiledRule {
  return {
    source_rule: "r", kind: "advisory", tools: [], field: null, number_value: null,
    text_value: null, values: null, message: "", advisory_reason: null, ...over,
  } as CompiledRule;
}

describe("toConstraint", () => {
  it("compiles a numeric limit", () => {
    const out = toConstraint(
      rule({ kind: "max", field: "args.amount", number_value: 200, tools: ["issue_refund"], message: "Escalate." }),
      "c1", [],
    );
    expect(out).toMatchObject({
      id: "c1", tools: ["issue_refund"], check: { kind: "max", field: "args.amount", value: 200 },
    });
  });

  it("refuses to invent missing values, returning a reason instead", () => {
    expect(typeof toConstraint(rule({ kind: "max", field: "args.amount" }), "c1", [])).toBe("string");
    expect(typeof toConstraint(rule({ kind: "max", number_value: 200 }), "c1", [])).toBe("string");
    expect(typeof toConstraint(rule({ kind: "one_of", field: "f", values: [] }), "c1", [])).toBe("string");
    expect(typeof toConstraint(rule({ kind: "advisory", advisory_reason: "needs judgement" }), "c1", [])).toBe("string");
  });

  it("rejects an invalid regex rather than compiling an unusable check", () => {
    expect(typeof toConstraint(rule({ kind: "matches", field: "args.to", text_value: "([" }), "c1", [])).toBe("string");
  });

  it("falls back to the skill's tools, then to every tool, when none are named", () => {
    const scoped = toConstraint(rule({ kind: "never", message: "No." }), "c1", ["send_email"]);
    expect(scoped).toMatchObject({ tools: ["send_email"] });
    const global = toConstraint(rule({ kind: "never", message: "No." }), "c1", []);
    expect(global).toMatchObject({ tools: ["*"] });
  });

  it("supplies a message when the model omitted one", () => {
    const out = toConstraint(rule({ kind: "never", source_rule: "Never wire funds." }), "c1", ["*"]);
    expect(out).toMatchObject({ message: expect.stringContaining("Never wire funds.") });
  });
});

describe("parsePolicy", () => {
  it("splits checkable rules from advisory ones", () => {
    const policy = parsePolicy({
      rules: [
        rule({ source_rule: "Max $200", kind: "max", field: "args.amount", number_value: 200 }),
        rule({ source_rule: "Be kind to customers", kind: "advisory", advisory_reason: "needs judgement" }),
      ],
    }, ["issue_refund"], "2026-07-24T00:00:00Z");
    expect(policy.constraints).toHaveLength(1);
    expect(policy.advisory).toEqual([{ source_rule: "Be kind to customers", reason: "needs judgement" }]);
    expect(policy.compiled_at).toBe("2026-07-24T00:00:00Z");
  });

  it("yields an empty policy on malformed output instead of throwing", () => {
    expect(parsePolicy({ nope: true }, [], "2026-07-24T00:00:00Z").constraints).toEqual([]);
  });
});

describe("compilePolicy", () => {
  const skill = {
    name: "Refund Handling",
    hard_rules: ["Never refund more than $200.", "Always be fair."],
    guardrails: [],
    tools: ["issue_refund"],
  };
  const at = () => new Date("2026-07-24T00:00:00Z");

  it("compiles hard rules through the model into constraints", async () => {
    const llm = {
      complete: async () => JSON.stringify({
        rules: [
          rule({ source_rule: skill.hard_rules[0], kind: "max", field: "args.amount", number_value: 200, tools: ["issue_refund"], message: "Escalate instead." }),
          rule({ source_rule: skill.hard_rules[1], kind: "advisory", advisory_reason: "subjective" }),
        ],
      }),
    };
    const policy = await compilePolicy(skill, llm, at);
    expect(policy.constraints).toHaveLength(1);
    expect(policy.advisory).toHaveLength(1);
  });

  it("skips the model entirely when there are no rules to compile", async () => {
    let called = false;
    const llm = { complete: async () => { called = true; return "{}"; } };
    const policy = await compilePolicy({ ...skill, hard_rules: [], guardrails: [] }, llm, at);
    expect(called).toBe(false);
    expect(policy.constraints).toEqual([]);
  });

  it("records every rule as unenforced when the model returns junk", async () => {
    const llm = { complete: async () => "not json at all" };
    const policy = await compilePolicy(skill, llm, at);
    expect(policy.constraints).toEqual([]);
    expect(policy.advisory).toHaveLength(2);
    expect(policy.advisory[0].reason).toMatch(/unreadable/);
  });
});
