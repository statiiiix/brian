import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_PERMISSIONS,
  validateSelectedAgentPermissions,
} from "./permissions.js";

describe("selected agent permission policy", () => {
  it("accepts the exact conservative defaults for an expert", () => {
    expect(validateSelectedAgentPermissions(DEFAULT_AGENT_PERMISSIONS, "expert")).toEqual({
      ok: true,
      permissions: DEFAULT_AGENT_PERMISSIONS,
    });
  });

  it("accepts knowledge capture and returns canonical permission order", () => {
    expect(validateSelectedAgentPermissions([
      ...DEFAULT_AGENT_PERMISSIONS,
      "knowledge:write",
    ], "expert")).toEqual({
      ok: true,
      permissions: ["skills:read", "context:read", "knowledge:write", "executions:write"],
    });
  });

  it("allows only owners and admins to select business-tool actions", () => {
    const selected = [...DEFAULT_AGENT_PERMISSIONS, "actions:execute"];
    expect(validateSelectedAgentPermissions(selected, "owner").ok).toBe(true);
    expect(validateSelectedAgentPermissions(selected, "admin").ok).toBe(true);
    expect(validateSelectedAgentPermissions(selected, "expert")).toEqual({
      ok: false,
      reason: "actions:execute requires an owner or admin",
    });
  });

  it("requires every conservative default", () => {
    expect(validateSelectedAgentPermissions(["skills:read"], "admin")).toEqual({
      ok: false,
      reason: "default agent permissions are required",
    });
  });

  it("rejects unknown values, duplicates, and non-arrays instead of filtering them", () => {
    expect(validateSelectedAgentPermissions([
      ...DEFAULT_AGENT_PERMISSIONS,
      "unknown:permission",
    ], "owner")).toEqual({ ok: false, reason: "invalid agent permissions" });
    expect(validateSelectedAgentPermissions([
      ...DEFAULT_AGENT_PERMISSIONS,
      "skills:read",
    ], "owner")).toEqual({ ok: false, reason: "invalid agent permissions" });
    expect(validateSelectedAgentPermissions("skills:read", "owner")).toEqual({
      ok: false,
      reason: "invalid agent permissions",
    });
  });
});
