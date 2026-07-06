import { describe, it, expect } from "vitest";
import { gmailThreadToRaw, gmailConnector, type GmailApi, type GmailThread } from "./adapters/gmail.js";
import { slackThreadToRaw, slackConnector, type SlackApi, type SlackThread } from "./adapters/slack.js";

const b64 = (s: string) => Buffer.from(s).toString("base64url");

describe("gmail adapter", () => {
  const thread: GmailThread = {
    id: "T1",
    messages: [
      {
        internalDate: "1000",
        payload: {
          headers: [{ name: "From", value: "Sara <sara@acme.com>" }, { name: "List-Unsubscribe", value: "<u>" }],
          body: { data: b64("hi there") },
        },
      },
      {
        internalDate: "1001",
        payload: {
          headers: [{ name: "From", value: "bob@x.com" }],
          mimeType: "multipart",
          parts: [{ mimeType: "text/plain", body: { data: b64("reply body") } }],
        },
      },
    ],
  };

  it("maps headers, decodes body, collects participants", () => {
    const r = gmailThreadToRaw(thread);
    expect(r.thread_id).toBe("T1");
    expect(r.messages[0].text).toBe("hi there");
    expect(r.messages[1].text).toBe("reply body");
    expect(r.messages[0].headers?.["list-unsubscribe"]).toBe("<u>");
    expect(r.participants.map((p) => p.id).sort()).toEqual(["bob@x.com", "sara@acme.com"]);
  });

  it("flags no-reply/bot senders", () => {
    const r = gmailThreadToRaw({ id: "T2", messages: [{ payload: { headers: [{ name: "From", value: "noreply@x.com" }] } }] });
    expect(r.participants[0].is_bot).toBe(true);
  });

  it("connector.fetch lists + gets threads and advances the cursor", async () => {
    const api: GmailApi = {
      listThreadIds: async () => ({ threadIds: ["T1"], historyId: "999" }),
      getThread: async () => thread,
    };
    const out = await gmailConnector(api).fetch({}, { historyId: "500" });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].thread_id).toBe("T1");
    expect(out.nextCursor).toEqual({ historyId: "999" });
  });
});

describe("slack adapter", () => {
  const thread: SlackThread = {
    channel: "C1", thread_ts: "111.1", permalink: "https://slack/p",
    users: { U1: { is_company_member: true }, U2: { is_company_member: false } },
    messages: [
      { user: "U1", ts: "111.1", text: "how do we refund?" },
      { subtype: "channel_join", user: "U2", ts: "111.2", text: "joined" },
      { user: "U2", ts: "111.3", text: "escalate to lead" },
      { bot_id: "B9", subtype: "bot_message", ts: "111.4", text: "reminder" },
    ],
  };

  it("drops system subtypes, flags bots, resolves company membership", () => {
    const r = slackThreadToRaw(thread);
    expect(r.thread_id).toBe("C1:111.1");
    expect(r.messages.map((m) => m.from)).toEqual(["U1", "U2", "B9"]); // channel_join dropped
    expect(r.participants.find((p) => p.id === "U1")?.is_company_member).toBe(true);
    expect(r.participants.find((p) => p.id === "B9")?.is_bot).toBe(true);
  });

  it("connector.fetch maps threads and passes through the cursor", async () => {
    const api: SlackApi = {
      listThreads: async () => ({ threads: [thread], nextCursor: { C1: "111.4" } }),
    };
    const out = await slackConnector(api).fetch({}, { C1: "100.0" });
    expect(out.items[0].thread_id).toBe("C1:111.1");
    expect(out.nextCursor).toEqual({ C1: "111.4" });
  });
});
