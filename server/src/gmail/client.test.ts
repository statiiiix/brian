import { describe, it, expect, vi } from "vitest";
import { gmailConfigFromEnv, createDraft, sendEmail, type GmailConfig } from "./client.js";

const cfg: GmailConfig = { clientId: "cid", clientSecret: "sec", refreshToken: "rt" };

function fakeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string | URL) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return { ok: false, status: 404, text: async () => "no route", json: async () => ({}) } as any;
    return { ok: true, status: 200, json: async () => routes[key], text: async () => "" } as any;
  });
}

describe("gmail client", () => {
  it("reads config from env, null when incomplete", () => {
    expect(
      gmailConfigFromEnv({ GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REFRESH_TOKEN: "c" } as any)
    ).toEqual({ clientId: "a", clientSecret: "b", refreshToken: "c" });
    expect(gmailConfigFromEnv({ GMAIL_CLIENT_ID: "a" } as any)).toBeNull();
  });

  it("createDraft exchanges the refresh token then posts a base64url message", async () => {
    const f = fakeFetch({
      "oauth2.googleapis.com/token": { access_token: "AT" },
      "gmail/v1/users/me/drafts": { id: "draft-9" },
    });
    const res = await createDraft(cfg, { to: "x@y.com", subject: "Hi", body: "Hello" }, f);
    expect(res).toEqual({ draft_id: "draft-9" });

    const draftCall = f.mock.calls.find((c) => String(c[0]).includes("drafts"))!;
    expect((draftCall[1] as any).headers.authorization).toBe("Bearer AT");
    const raw = JSON.parse((draftCall[1] as any).body).message.raw as string;
    const decoded = Buffer.from(raw, "base64url").toString();
    expect(decoded).toContain("To: x@y.com");
    expect(decoded).toContain("Subject: Hi");
    expect(decoded).toContain("Hello");
  });

  it("sendEmail posts to messages/send", async () => {
    const f = fakeFetch({
      "oauth2.googleapis.com/token": { access_token: "AT" },
      "messages/send": { id: "msg-7" },
    });
    const res = await sendEmail(cfg, { to: "x@y.com", subject: "s", body: "b" }, f);
    expect(res).toEqual({ message_id: "msg-7" });
  });

  it("throws a readable error when the token exchange fails", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 400, text: async () => "invalid_grant", json: async () => ({}) })) as any;
    await expect(createDraft(cfg, { to: "a@b.c", subject: "s", body: "b" }, f))
      .rejects.toThrow(/token exchange failed.*invalid_grant/);
  });
});
