import { Buffer } from "node:buffer";
import type { Connector, RawThread } from "../types.js";
import { getAccessToken, type FetchFn, type GmailConfig } from "../../gmail/client.js";

// Company membership + bot detection. Company domain is configurable; the
// address heuristics catch the usual automated senders.
const COMPANY_DOMAIN = process.env.CONNECTORS_COMPANY_DOMAIN ?? "";
const BOT_ADDR = /(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bot)@/i;

// The low-level Gmail surface the adapter needs. The real impl does the HTTP
// (History API for increments); tests inject a fake. Kept tiny so the mapping —
// the bug-prone part — is what gets unit-tested.
export interface GmailApi {
  // Thread ids changed since `startHistoryId` (or a bootstrap window when absent),
  // plus the newest historyId to persist as the next cursor.
  listThreadIds(startHistoryId?: string): Promise<{ threadIds: string[]; historyId: string }>;
  getThread(id: string): Promise<GmailThread>;
}

export interface GmailPayload {
  headers?: { name: string; value: string }[];
  mimeType?: string;
  body?: { data?: string };
  parts?: { mimeType?: string; body?: { data?: string } }[];
}
export interface GmailMessage {
  internalDate?: string;
  payload?: GmailPayload;
}
export interface GmailThread {
  id: string;
  messages?: GmailMessage[];
}

function headerMap(headers: { name: string; value: string }[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) out[h.name.toLowerCase()] = h.value;
  return out;
}

function decodeBody(payload: GmailPayload | undefined): string {
  if (!payload) return "";
  if (payload.body?.data) return Buffer.from(payload.body.data, "base64url").toString("utf8");
  for (const part of payload.parts ?? []) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return Buffer.from(part.body.data, "base64url").toString("utf8");
    }
  }
  return "";
}

function addr(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

// Pure mapping: Gmail thread → normalized RawThread.
export function gmailThreadToRaw(t: GmailThread): RawThread {
  const messages = (t.messages ?? []).map((m) => {
    const headers = headerMap(m.payload?.headers);
    return { from: headers.from ?? "", ts: m.internalDate ?? "", text: decodeBody(m.payload), headers };
  });
  const emails = new Set<string>();
  for (const m of messages) {
    const e = addr(m.from);
    if (e) emails.add(e);
  }
  const participants = [...emails].map((e) => ({
    id: e,
    is_company_member: COMPANY_DOMAIN ? e.endsWith("@" + COMPANY_DOMAIN.toLowerCase()) : false,
    is_bot: BOT_ADDR.test(e),
  }));
  return {
    thread_id: t.id,
    permalink: `https://mail.google.com/mail/u/0/#all/${t.id}`,
    participants,
    messages,
  };
}

// Build a Connector over a GmailApi (real or fake).
export function gmailConnector(api: GmailApi): Connector {
  return {
    type: "gmail",
    async fetch(_creds, cursor) {
      const start = (cursor as { historyId?: string } | undefined)?.historyId;
      const { threadIds, historyId } = await api.listThreadIds(start);
      const items: RawThread[] = [];
      for (const id of threadIds) items.push(gmailThreadToRaw(await api.getThread(id)));
      return { items, nextCursor: { historyId } };
    },
  };
}

// --- Live HTTP impl (FOUNDER-GATED: needs real OAuth creds; verify against a
// real mailbox before relying on it — the History-API flow can't be unit-tested).
async function gmailGet(cfg: GmailConfig, path: string, fetchFn: FetchFn): Promise<any> {
  const token = await getAccessToken(cfg, fetchFn);
  const res = await fetchFn(`https://gmail.googleapis.com/gmail/v1/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`gmail ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export function realGmailApi(cfg: GmailConfig, fetchFn: FetchFn = fetch): GmailApi {
  return {
    async listThreadIds(startHistoryId) {
      if (startHistoryId) {
        const h = await gmailGet(cfg, `users/me/history?startHistoryId=${startHistoryId}&historyTypes=messageAdded`, fetchFn);
        const ids = new Set<string>();
        for (const rec of h.history ?? []) {
          for (const ma of rec.messagesAdded ?? []) if (ma.message?.threadId) ids.add(ma.message.threadId);
        }
        return { threadIds: [...ids], historyId: String(h.historyId ?? startHistoryId) };
      }
      // Bootstrap: recent threads + the mailbox's current historyId.
      const list = await gmailGet(cfg, `users/me/threads?maxResults=50&q=${encodeURIComponent("newer_than:7d -in:chats")}`, fetchFn);
      const profile = await gmailGet(cfg, "users/me/profile", fetchFn);
      return { threadIds: (list.threads ?? []).map((t: { id: string }) => t.id), historyId: String(profile.historyId) };
    },
    getThread(id) {
      return gmailGet(cfg, `users/me/threads/${id}?format=full`, fetchFn);
    },
  };
}
