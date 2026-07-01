import { describe, it, expect } from "vitest";
import { businessAdapters } from "./adapters.js";

describe("business adapters", () => {
  it("exposes the mock order tools", () => {
    const names = businessAdapters().map((a) => a.name);
    expect(names).toContain("get_order");
    expect(names).toContain("issue_refund");
  });

  it("get_order returns the order or null", async () => {
    const get = businessAdapters().find((a) => a.name === "get_order")!;
    const order = (await get.handler({ order_id: "ORD-1" })) as { amount: number };
    expect(order.amount).toBe(40);
    expect(await get.handler({ order_id: "NOPE" })).toBeNull();
  });

  it("issue_refund echoes a refund receipt", async () => {
    const refund = businessAdapters().find((a) => a.name === "issue_refund")!;
    const r = (await refund.handler({ order_id: "ORD-1", amount: 40 })) as { refunded: boolean };
    expect(r.refunded).toBe(true);
  });
});
