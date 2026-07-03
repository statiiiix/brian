import { describe, it, expect } from "vitest";
import { signUserToken, verifyUserToken } from "./jwt.js";

describe("jwt", () => {
  const u = { id: "11111111-1111-1111-1111-111111111111", email: "a@b.c", role: "admin" };

  it("round-trips a user", () => {
    const t = signUserToken(u, "s3");
    expect(verifyUserToken(t, "s3")).toMatchObject(u);
  });

  it("rejects a bad secret and garbage", () => {
    const t = signUserToken(u, "s3");
    expect(verifyUserToken(t, "other")).toBeNull();
    expect(verifyUserToken("garbage", "s3")).toBeNull();
  });
});
