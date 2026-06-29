import { describe, it, expect } from "vitest";
import { parseNewSkill, parseUpdateSkill, ValidationError } from "./validation.js";

describe("parseNewSkill", () => {
  it("accepts a minimal valid skill and fills array defaults", () => {
    const s = parseNewSkill({ name: "Refunds", trigger: "refund request", procedure: "do it" });
    expect(s.name).toBe("Refunds");
    expect(s.inputs).toEqual([]);
    expect(s.hard_rules).toEqual([]);
    expect(s.escalation_target).toBeNull();
  });

  it("rejects a skill missing required fields", () => {
    expect(() => parseNewSkill({ name: "" })).toThrow(ValidationError);
  });

  it("collects human-readable issues", () => {
    try {
      parseNewSkill({});
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});

describe("parseUpdateSkill", () => {
  it("allows partial patches", () => {
    const p = parseUpdateSkill({ procedure: "new steps" });
    expect(p.procedure).toBe("new steps");
  });
});
