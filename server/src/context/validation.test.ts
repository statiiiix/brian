import { describe, it, expect } from "vitest";
import { parseNewContext } from "./validation.js";
import { ValidationError } from "../skills/validation.js";

describe("parseNewContext", () => {
  it("accepts content and fills defaults", () => {
    const c = parseNewContext({ content: "We want to launch in Q3" });
    expect(c.content).toBe("We want to launch in Q3");
    expect(c.tags).toEqual([]);
    expect(c.summary).toBeNull();
  });
  it("rejects empty content", () => {
    expect(() => parseNewContext({ content: "" })).toThrow(ValidationError);
  });
});
