import { describe, expect, it } from "vitest";
import { decryptCredentials, encryptCredentials } from "./credentials.js";

describe("connector credentials", () => {
  it("encrypts and decrypts credentials with a deployment key", () => {
    const env = { CONNECTOR_ENCRYPTION_KEY: "test-only-key" };
    const encrypted = encryptCredentials({ refresh_token: "secret", team: "acme" }, env);
    expect(encrypted).not.toEqual({ refresh_token: "secret", team: "acme" });
    expect(JSON.stringify(encrypted)).not.toContain("secret");
    expect(decryptCredentials(encrypted, env)).toEqual({ refresh_token: "secret", team: "acme" });
  });

  it("refuses to persist credentials without an encryption key", () => {
    expect(() => encryptCredentials({ bot_token: "placeholder" }, {}))
      .toThrow("CONNECTOR_ENCRYPTION_KEY is required to store connector credentials");
  });
});
