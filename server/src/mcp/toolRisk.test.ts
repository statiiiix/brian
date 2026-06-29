import { describe, it, expect } from "vitest";
import { toolRisk, skillIsAutoSafe } from "./toolRisk.js";

describe("toolRisk", () => {
  it("classifies known safe and destructive tools", () => {
    expect(toolRisk("get_order")).toBe("safe");
    expect(toolRisk("issue_refund")).toBe("destructive");
  });
  it("defaults unknown tools to destructive", () => {
    expect(toolRisk("delete_everything")).toBe("destructive");
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
