import type { Connector, RawThread } from "../types.js";

// System/subtype messages that are never real content — dropped in mapping so
// join/leave/topic churn can't masquerade as a thread.
const NOISE_SUBTYPES = new Set([
  "channel_join", "channel_leave", "channel_topic", "channel_purpose",
  "channel_name", "channel_archive", "channel_unarchive",
]);

// The low-level Slack surface the adapter needs. Real impl does the HTTP
// (conversations.history/replies + users.info over invited channels); tests
// inject a fake.
export interface SlackApi {
  // Threads new since the per-channel cursor, plus the cursor to persist.
  listThreads(cursor: Record<string, string>): Promise<{ threads: SlackThread[]; nextCursor: Record<string, string> }>;
}

export interface SlackThread {
  channel: string;
  thread_ts: string;
  permalink: string;
  messages: { user?: string; bot_id?: string; subtype?: string; ts: string; text?: string }[];
  users?: Record<string, { is_company_member: boolean }>; // resolved via users.info
}

// Pure mapping: Slack thread → normalized RawThread.
export function slackThreadToRaw(t: SlackThread): RawThread {
  const msgs = (t.messages ?? []).filter((m) => !m.subtype || !NOISE_SUBTYPES.has(m.subtype));
  const messages = msgs.map((m) => ({
    from: m.user ?? m.bot_id ?? "unknown",
    ts: m.ts,
    text: m.text ?? "",
  }));
  const bots = new Map<string, boolean>();
  for (const m of msgs) {
    const id = m.user ?? m.bot_id ?? "unknown";
    bots.set(id, (bots.get(id) ?? false) || Boolean(m.bot_id) || m.subtype === "bot_message");
  }
  const participants = [...bots.entries()].map(([id, is_bot]) => ({
    id,
    is_bot,
    is_company_member: t.users?.[id]?.is_company_member ?? false,
  }));
  return {
    thread_id: `${t.channel}:${t.thread_ts}`,
    permalink: t.permalink,
    participants,
    messages,
  };
}

export function slackConnector(api: SlackApi): Connector {
  return {
    type: "slack",
    async fetch(_creds, cursor) {
      const { threads, nextCursor } = await api.listThreads((cursor as Record<string, string>) ?? {});
      return { items: threads.map(slackThreadToRaw), nextCursor };
    },
  };
}

// --- Live HTTP impl (FOUNDER-GATED: needs a bot token over invited channels;
// verify against a real workspace — the pagination can't be unit-tested).
type SlackFetch = typeof fetch;

async function slackGet(token: string, method: string, params: Record<string, string>, fetchFn: SlackFetch): Promise<any> {
  const res = await fetchFn(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`slack ${method} failed: ${json.error}`);
  return json;
}

export function realSlackApi(botToken: string, fetchFn: SlackFetch = fetch): SlackApi {
  return {
    async listThreads(cursor) {
      const channels: { id: string }[] =
        (await slackGet(botToken, "users.conversations", { types: "public_channel,private_channel", limit: "200" }, fetchFn)).channels ?? [];
      const threads: SlackThread[] = [];
      const nextCursor: Record<string, string> = { ...cursor };
      const member: Record<string, boolean> = {};

      for (const ch of channels) {
        const oldest = cursor[ch.id] ?? "0";
        const hist = await slackGet(botToken, "conversations.history", { channel: ch.id, oldest, limit: "100" }, fetchFn);
        let newest = oldest;
        for (const root of hist.messages ?? []) {
          if (Number(root.ts) > Number(newest)) newest = root.ts;
          const thread_ts = root.thread_ts ?? root.ts;
          const messages = root.reply_count
            ? (await slackGet(botToken, "conversations.replies", { channel: ch.id, ts: thread_ts }, fetchFn)).messages
            : [root];
          const users: Record<string, { is_company_member: boolean }> = {};
          for (const m of messages) {
            if (!m.user) continue;
            if (member[m.user] === undefined) {
              const info = await slackGet(botToken, "users.info", { user: m.user }, fetchFn);
              member[m.user] = !(info.user?.is_restricted || info.user?.is_ultra_restricted || info.user?.is_bot);
            }
            users[m.user] = { is_company_member: member[m.user] };
          }
          threads.push({ channel: ch.id, thread_ts, permalink: `slack://thread/${ch.id}/${thread_ts}`, messages, users });
        }
        nextCursor[ch.id] = newest;
      }
      return { threads, nextCursor };
    },
  };
}
