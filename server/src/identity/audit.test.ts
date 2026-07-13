import { describe, expect, it } from "vitest";
import { sanitizeAuditMetadata } from "./audit.js";

describe("audit metadata redaction", () => {
  it("removes credential, OAuth continuation, and header fields recursively", () => {
    expect(sanitizeAuditMetadata({
      clientId: "safe-client",
      authorizationCode: "secret-code",
      bearer_header: "Bearer secret",
      nested: { refreshToken: "secret", permission: "skills:read" },
      values: [{ state: "secret-state", status: "active" }],
    })).toEqual({
      clientId: "safe-client",
      nested: { permission: "skills:read" },
      values: [{ status: "active" }],
    });
  });

  it("bounds long strings and deep structures", () => {
    const result = sanitizeAuditMetadata({ value: "x".repeat(1000) }) as { value: string };
    expect(result.value).toHaveLength(500);
  });
});
