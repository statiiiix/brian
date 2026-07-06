import { describe, it, expect } from "vitest";
import { keepThread, filterThreads } from "./junkFilter.js";
import type { RawThread } from "./types.js";

const human = (id: string) => ({ id, is_company_member: id.endsWith("@us.com"), is_bot: false });

// A good baseline: two humans (one company member) with a real back-and-forth.
const thread = (over: Partial<RawThread> = {}): RawThread => ({
  thread_id: "t1",
  permalink: "p",
  participants: [human("a@us.com"), human("b@x.com")],
  messages: [
    { from: "a@us.com", ts: "1", text: "Hi, how do we handle a refund over $200?" },
    { from: "b@x.com", ts: "2", text: "Escalate to the lead and note the order id." },
  ],
  ...over,
});

describe("connectors junk filter", () => {
  it("keeps a real 2-human company thread", () => {
    expect(keepThread(thread())).toBe(true);
  });

  it("drops newsletters (List-Unsubscribe header)", () => {
    expect(keepThread(thread({
      messages: [
        { from: "news@x.com", ts: "1", text: "Sale!", headers: { "List-Unsubscribe": "<u>" } },
        { from: "a@us.com", ts: "2", text: "ignore" },
      ],
    }))).toBe(false);
  });

  it("drops automated no-reply senders", () => {
    expect(keepThread(thread({
      messages: [
        { from: "noreply@x.com", ts: "1", text: "Your receipt" },
        { from: "a@us.com", ts: "2", text: "thanks" },
      ],
    }))).toBe(false);
  });

  it("drops threads with any bot participant", () => {
    expect(keepThread(thread({
      participants: [human("a@us.com"), { id: "B0T", is_company_member: false, is_bot: true }],
    }))).toBe(false);
  });

  it("drops when fewer than 2 humans or no company member", () => {
    expect(keepThread(thread({ participants: [human("a@us.com")] }))).toBe(false);
    expect(keepThread(thread({ participants: [human("a@x.com"), human("b@x.com")] }))).toBe(false);
  });

  it("drops one-liners / no-reply (single message)", () => {
    expect(keepThread(thread({ messages: [{ from: "a@us.com", ts: "1", text: "ok" }] }))).toBe(false);
  });

  it("filterThreads dedupes by thread_id then keeps survivors", () => {
    const kept = filterThreads([thread(), thread(), thread({ thread_id: "t2", participants: [human("a@us.com")] })]);
    expect(kept).toHaveLength(1);
    expect(kept[0].thread_id).toBe("t1");
  });
});
