import type { Connector, RawThread } from "../../types.js";
import { accessToken, apiJson, clipText, MAX_ITEMS_PER_SYNC, nextSinceCursor, sinceIso, stripHtml, type FetchLike } from "./common.js";

// --- Zendesk ---

export interface ZendeskTicket {
  id: number;
  subject?: string;
  updated_at?: string;
}

export interface ZendeskComment {
  author_id?: number;
  created_at?: string;
  plain_body?: string;
  body?: string;
}

export function zendeskTicketToRaw(
  workspace: string,
  ticket: ZendeskTicket,
  comments: ZendeskComment[],
  agents: Set<number>,
): RawThread {
  const participants = new Map<string, boolean>();
  const messages = comments.map((comment) => {
    const id = String(comment.author_id ?? "zendesk-user");
    participants.set(id, false);
    return { from: id, ts: comment.created_at ?? "", text: comment.plain_body ?? comment.body ?? "" };
  }).filter((m) => m.text.trim());
  return {
    thread_id: `zendesk:${ticket.id}`,
    permalink: `https://${workspace}.zendesk.com/agent/tickets/${ticket.id}`,
    title: ticket.subject,
    participants: [...participants.keys()].map((id) => ({
      id,
      is_bot: false,
      is_company_member: agents.has(Number(id)),
    })),
    messages,
  };
}

export function zendeskConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  return {
    type: "zendesk",
    async fetch(_creds, cursor) {
      const token = accessToken(creds);
      const workspace = typeof creds.workspace === "string" ? creds.workspace : null;
      if (!workspace) throw new Error("Zendesk connection is missing its subdomain — reconnect the source");
      const base = `https://${workspace}.zendesk.com/api/v2`;
      const since = sinceIso(cursor);
      const list = await apiJson(
        fetchFn,
        `${base}/tickets.json?sort_by=updated_at&sort_order=desc&per_page=${MAX_ITEMS_PER_SYNC}`,
        { token },
      );
      const tickets = ((list.tickets ?? []) as ZendeskTicket[])
        .filter((ticket) => !ticket.updated_at || ticket.updated_at >= since);
      const items: RawThread[] = [];
      const agents = new Set<number>();
      const staff = await apiJson(fetchFn, `${base}/users.json?role[]=agent&role[]=admin&per_page=100`, { token })
        .catch(() => ({ users: [] })); // role filter can be restricted on some plans
      for (const user of (staff.users ?? []) as { id: number }[]) agents.add(user.id);
      for (const ticket of tickets) {
        const comments = await apiJson(fetchFn, `${base}/tickets/${ticket.id}/comments.json?per_page=30`, { token });
        items.push(zendeskTicketToRaw(workspace, ticket, (comments.comments ?? []) as ZendeskComment[], agents));
      }
      return { items, nextCursor: nextSinceCursor() };
    },
  };
}

// --- Intercom ---

export interface IntercomConversation {
  id: string;
  updated_at?: number;
  title?: string;
  source?: { author?: { type?: string; id?: string; name?: string }; body?: string };
  conversation_parts?: {
    conversation_parts?: {
      part_type?: string;
      body?: string;
      created_at?: number;
      author?: { type?: string; id?: string; name?: string };
    }[];
  };
}

function intercomAuthor(author?: { type?: string; id?: string; name?: string }): { id: string; company: boolean; bot: boolean } {
  return {
    id: author?.name ?? author?.id ?? "intercom-user",
    company: author?.type === "admin" || author?.type === "team",
    bot: author?.type === "bot",
  };
}

export function intercomConversationToRaw(conversation: IntercomConversation): RawThread {
  const participants = new Map<string, { is_company_member: boolean; is_bot: boolean }>();
  const messages: RawThread["messages"] = [];
  const push = (author: ReturnType<typeof intercomAuthor>, ts: number | undefined, body: string | undefined) => {
    const text = stripHtml(body ?? "");
    if (!text) return;
    participants.set(author.id, { is_company_member: author.company, is_bot: author.bot });
    messages.push({ from: author.id, ts: ts ? new Date(ts * 1000).toISOString() : "", text });
  };
  push(intercomAuthor(conversation.source?.author), conversation.updated_at, conversation.source?.body);
  for (const part of conversation.conversation_parts?.conversation_parts ?? []) {
    if (part.part_type && !["comment", "note", "assignment"].includes(part.part_type)) continue;
    push(intercomAuthor(part.author), part.created_at, part.body);
  }
  return {
    thread_id: `intercom:${conversation.id}`,
    permalink: `https://app.intercom.com/a/inbox/_/inbox/conversation/${conversation.id}`,
    title: conversation.title,
    participants: [...participants.entries()].map(([id, flags]) => ({ id, ...flags })),
    messages,
  };
}

export function intercomConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  const headers = { "Intercom-Version": "2.11" };
  return {
    type: "intercom",
    async fetch(_creds, cursor) {
      const token = accessToken(creds);
      const since = Math.floor(Date.parse(sinceIso(cursor)) / 1000);
      const list = await apiJson(fetchFn, `https://api.intercom.io/conversations?per_page=${MAX_ITEMS_PER_SYNC}`, { token, headers });
      const recent = ((list.conversations ?? []) as IntercomConversation[])
        .filter((conversation) => !conversation.updated_at || conversation.updated_at >= since);
      const items: RawThread[] = [];
      for (const conversation of recent) {
        const full = await apiJson(fetchFn, `https://api.intercom.io/conversations/${conversation.id}`, { token, headers });
        items.push(intercomConversationToRaw(full as IntercomConversation));
      }
      return { items, nextCursor: nextSinceCursor() };
    },
  };
}

// --- HubSpot ---

export interface HubSpotDeal {
  id: string;
  properties?: Record<string, string | null>;
  updatedAt?: string;
}

export function hubspotDealToRaw(deal: HubSpotDeal, portalId?: string): RawThread {
  const p = deal.properties ?? {};
  const owner = p.hubspot_owner_id ?? "hubspot-owner";
  const lines = [
    `Deal: ${p.dealname ?? deal.id}`,
    p.dealstage ? `Stage: ${p.dealstage}` : "",
    p.amount ? `Amount: ${p.amount}` : "",
    p.closedate ? `Close date: ${p.closedate}` : "",
    p.hs_deal_stage_probability ? `Win probability: ${p.hs_deal_stage_probability}` : "",
    p.description ? `Notes: ${p.description}` : "",
    p.closed_lost_reason ? `Closed-lost reason: ${p.closed_lost_reason}` : "",
    p.closed_won_reason ? `Closed-won reason: ${p.closed_won_reason}` : "",
  ].filter(Boolean);
  return {
    thread_id: `hubspot:deal:${deal.id}`,
    permalink: portalId ? `https://app.hubspot.com/contacts/${portalId}/deal/${deal.id}` : "",
    source_kind: "document",
    title: p.dealname ?? `Deal ${deal.id}`,
    participants: [{ id: String(owner), is_company_member: true, is_bot: false }],
    messages: [{ from: String(owner), ts: deal.updatedAt ?? "", text: lines.join("\n") }],
  };
}

export function hubspotConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  return {
    type: "hubspot",
    async fetch(_creds, cursor) {
      const token = accessToken(creds);
      const portalId = creds.hub_id != null ? String(creds.hub_id) : undefined;
      const res = await apiJson(fetchFn, "https://api.hubapi.com/crm/v3/objects/deals/search", {
        token,
        method: "POST",
        body: {
          filterGroups: [{ filters: [{ propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(Date.parse(sinceIso(cursor))) }] }],
          sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
          properties: [
            "dealname", "dealstage", "amount", "closedate", "description",
            "hs_deal_stage_probability", "closed_lost_reason", "closed_won_reason", "hubspot_owner_id",
          ],
          limit: MAX_ITEMS_PER_SYNC,
        },
      });
      const items = ((res.results ?? []) as HubSpotDeal[]).map((deal) => hubspotDealToRaw(deal, portalId));
      return { items, nextCursor: nextSinceCursor() };
    },
  };
}

// --- Salesforce ---

export interface SalesforceRecord {
  Id: string;
  Name?: string;
  StageName?: string;
  Amount?: number;
  Description?: string;
  LastModifiedDate?: string;
  Owner?: { Name?: string };
}

export function salesforceOpportunityToRaw(record: SalesforceRecord, instanceUrl: string): RawThread {
  const owner = record.Owner?.Name ?? "salesforce-owner";
  const lines = [
    `Opportunity: ${record.Name ?? record.Id}`,
    record.StageName ? `Stage: ${record.StageName}` : "",
    record.Amount != null ? `Amount: ${record.Amount}` : "",
    record.Description ? `Notes: ${record.Description}` : "",
  ].filter(Boolean);
  return {
    thread_id: `salesforce:${record.Id}`,
    permalink: `${instanceUrl.replace(/\/$/, "")}/lightning/r/Opportunity/${record.Id}/view`,
    source_kind: "document",
    title: record.Name ?? `Opportunity ${record.Id}`,
    participants: [{ id: owner, is_company_member: true, is_bot: false }],
    messages: [{ from: owner, ts: record.LastModifiedDate ?? "", text: lines.join("\n") }],
  };
}

export function salesforceConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  return {
    type: "salesforce",
    async fetch(_creds, cursor) {
      const token = accessToken(creds);
      const instanceUrl = typeof creds.instance_url === "string" ? creds.instance_url : null;
      if (!instanceUrl) throw new Error("Salesforce connection is missing its instance URL — reconnect the source");
      const since = sinceIso(cursor).split(".")[0] + "Z";
      const soql = encodeURIComponent(
        "SELECT Id, Name, StageName, Amount, Description, LastModifiedDate, Owner.Name FROM Opportunity"
          + ` WHERE LastModifiedDate >= ${since} ORDER BY LastModifiedDate DESC LIMIT ${MAX_ITEMS_PER_SYNC}`,
      );
      const res = await apiJson(fetchFn, `${instanceUrl.replace(/\/$/, "")}/services/data/v59.0/query?q=${soql}`, { token });
      const items = ((res.records ?? []) as SalesforceRecord[])
        .map((record) => salesforceOpportunityToRaw(record, instanceUrl));
      return { items, nextCursor: nextSinceCursor() };
    },
  };
}

// --- Gong ---

export interface GongCall {
  id: string;
  title?: string;
  started?: string;
  url?: string;
  primaryUserId?: string;
}

export interface GongTranscriptMonologue {
  speakerId?: string;
  sentences?: { text?: string }[];
}

export function gongCallToRaw(call: GongCall, monologues: GongTranscriptMonologue[]): RawThread {
  const participants = new Map<string, boolean>();
  const messages: RawThread["messages"] = [];
  for (const monologue of monologues) {
    const speaker = monologue.speakerId ?? "gong-speaker";
    const text = (monologue.sentences ?? []).map((s) => s.text ?? "").join(" ").trim();
    if (!text) continue;
    participants.set(speaker, false);
    messages.push({ from: speaker, ts: call.started ?? "", text });
  }
  if (!messages.length) {
    const host = call.primaryUserId ?? "gong-host";
    participants.set(host, false);
    messages.push({ from: host, ts: call.started ?? "", text: call.title ?? `Call ${call.id}` });
  }
  return {
    thread_id: `gong:${call.id}`,
    permalink: call.url ?? "",
    source_kind: "document",
    title: call.title ?? `Call ${call.id}`,
    participants: [...participants.keys()].map((id) => ({ id, is_company_member: true, is_bot: false })),
    messages: messages.map((m) => ({ ...m, text: clipText(m.text) })),
  };
}

export function gongConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  const base = "https://api.gong.io/v2";
  return {
    type: "gong",
    async fetch(_creds, cursor) {
      const token = accessToken(creds);
      const since = sinceIso(cursor);
      const list = await apiJson(
        fetchFn,
        `${base}/calls?fromDateTime=${encodeURIComponent(since)}&toDateTime=${encodeURIComponent(new Date().toISOString())}`,
        { token },
      );
      const calls = ((list.calls ?? []) as GongCall[]).slice(0, MAX_ITEMS_PER_SYNC);
      let transcripts = new Map<string, GongTranscriptMonologue[]>();
      if (calls.length) {
        const res = await apiJson(fetchFn, `${base}/calls/transcript`, {
          token,
          method: "POST",
          body: { filter: { callIds: calls.map((call) => call.id) } },
        }).catch(() => null); // transcript scope may not be granted on older connections
        transcripts = new Map(
          ((res?.callTranscripts ?? []) as { callId?: string; transcript?: GongTranscriptMonologue[] }[])
            .map((entry) => [String(entry.callId), entry.transcript ?? []]),
        );
      }
      const items = calls.map((call) => gongCallToRaw(call, transcripts.get(call.id) ?? []));
      return { items, nextCursor: nextSinceCursor() };
    },
  };
}
