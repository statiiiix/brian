import { describe, it, expect } from "vitest";
import { getOrder, issueRefund } from "./businessTools.js";

describe("business tools", () => {
  it("looks up a known order", () => {
    expect(getOrder("ORD-1")?.amount).toBe(40);
  });
  it("returns null for an unknown order", () => {
    expect(getOrder("NOPE")).toBeNull();
  });
  it("issues a refund", () => {
    expect(issueRefund("ORD-1", 40)).toEqual({ refunded: true, order_id: "ORD-1", amount: 40 });
  });
});
