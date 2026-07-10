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

  it("keeps local development credentials compatible without a key", () => {
    const plain = { bot_token: "local-token" };
    expect(encryptCredentials(plain, {})).toEqual(plain);
    expect(decryptCredentials(plain, {})).toEqual(plain);
  });
});
