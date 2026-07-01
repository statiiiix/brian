import { describe, it, expect } from "vitest";
import { businessAdapters, createEmailAdapters } from "./adapters.js";

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

describe("gmail adapters", () => {
  it("are exposed as create_email_draft and send_email", () => {
    const names = businessAdapters().map((a) => a.name);
    expect(names).toContain("create_email_draft");
    expect(names).toContain("send_email");
  });

  it("create_email_draft calls the gmail client with the args", async () => {
    const calls: unknown[] = [];
    const [draftAdapter] = createEmailAdapters({
      config: { clientId: "a", clientSecret: "b", refreshToken: "c" },
      createDraftFn: async (_cfg, input) => { calls.push(input); return { draft_id: "d1" }; },
      sendEmailFn: async () => ({ message_id: "m1" }),
    });
    const res = await draftAdapter.handler({ to: "x@y.com", subject: "s", body: "b" });
    expect(res).toEqual({ draft_id: "d1" });
    expect(calls[0]).toEqual({ to: "x@y.com", subject: "s", body: "b" });
  });

  it("throws a clear error when gmail is not configured", async () => {
    const [draftAdapter] = createEmailAdapters({ config: null });
    await expect(draftAdapter.handler({ to: "a", subject: "b", body: "c" }))
      .rejects.toThrow(/Gmail is not configured/);
  });
});
