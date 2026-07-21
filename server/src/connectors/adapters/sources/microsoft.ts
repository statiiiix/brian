import type { Connector, RawThread } from "../../types.js";
import {
  accessToken, apiJson, apiText, clipText, MAX_ITEMS_PER_SYNC, nextSinceCursor,
  selectedString, selectedStrings, sinceIso, stripHtml, type FetchLike,
} from "./common.js";

const GRAPH = "https://graph.microsoft.com/v1.0";

// Text-extractable file types; Office binaries need a converter we don't ship yet.
const TEXT_EXTENSIONS = /\.(txt|md|markdown|csv|json|log)$/i;

export interface GraphDriveItem {
  id: string;
  name?: string;
  webUrl?: string;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName?: string; email?: string } };
  file?: { mimeType?: string };
  parentReference?: { driveId?: string };
  remoteItem?: { id?: string; parentReference?: { driveId?: string } };
}

export function driveItemToRaw(item: GraphDriveItem, text: string, source: "sharepoint" | "onedrive"): RawThread {
  const editor = item.lastModifiedBy?.user?.email ?? item.lastModifiedBy?.user?.displayName ?? `${source}-editor`;
  return {
    thread_id: `${source}:${item.id}`,
    permalink: item.webUrl ?? "",
    source_kind: "document",
    title: item.name ?? "Untitled file",
    participants: [{ id: editor, is_company_member: true, is_bot: false }],
    messages: [{ from: editor, ts: item.lastModifiedDateTime ?? "", text }],
  };
}

function textualFile(item: GraphDriveItem): boolean {
  return Boolean(item.file) && TEXT_EXTENSIONS.test(item.name ?? "");
}

async function driveItemContent(item: GraphDriveItem, token: string, fetchFn: FetchLike): Promise<string> {
  const driveId = item.remoteItem?.parentReference?.driveId ?? item.parentReference?.driveId;
  const itemId = item.remoteItem?.id ?? item.id;
  const path = driveId ? `${GRAPH}/drives/${driveId}/items/${itemId}/content` : `${GRAPH}/me/drive/items/${itemId}/content`;
  return clipText(await apiText(fetchFn, path, token));
}

export function onedriveConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  return {
    type: "onedrive",
    async fetch(_creds, cursor) {
      const checkpoint = new Date().toISOString();
      const token = accessToken(creds);
      const selectedItemIds = selectedStrings(creds, "selected_item_ids");
      const since = sinceIso(cursor);
      const items: RawThread[] = [];
      const complete = selectedItemIds.length <= MAX_ITEMS_PER_SYNC;
      for (const itemId of selectedItemIds.slice(0, MAX_ITEMS_PER_SYNC)) {
        const file = await apiJson(
          fetchFn,
          `${GRAPH}/me/drive/items/${encodeURIComponent(itemId)}`
            + "?$select=id,name,webUrl,lastModifiedDateTime,lastModifiedBy,file,parentReference",
          { token },
        ) as GraphDriveItem;
        if (!textualFile(file) || (file.lastModifiedDateTime && file.lastModifiedDateTime < since)) continue;
        items.push(driveItemToRaw(file, await driveItemContent(file, token, fetchFn), "onedrive"));
      }
      return { items, nextCursor: complete ? nextSinceCursor(checkpoint) : { updated_since: sinceIso(cursor) } };
    },
  };
}

export function sharepointConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  return {
    type: "sharepoint",
    async fetch(_creds, cursor) {
      const checkpoint = new Date().toISOString();
      const token = accessToken(creds);
      const since = sinceIso(cursor);
      const sites = selectedStrings(creds, "selected_site_ids");
      const items: RawThread[] = [];
      let complete = true;
      for (const site of sites) {
        if (items.length >= MAX_ITEMS_PER_SYNC) { complete = false; break; }
        const children = await apiJson(
          fetchFn,
          `${GRAPH}/sites/${site}/drive/root/children?$top=50&$orderby=lastModifiedDateTime desc`,
          { token },
        );
        if ((children.value ?? []).length >= 50) complete = false;
        const files = ((children.value ?? []) as GraphDriveItem[])
          .filter(textualFile)
          .filter((item) => !item.lastModifiedDateTime || item.lastModifiedDateTime >= since);
        for (const file of files) {
          if (items.length >= MAX_ITEMS_PER_SYNC) { complete = false; break; }
          items.push(driveItemToRaw(file, await driveItemContent(file, token, fetchFn), "sharepoint"));
        }
      }
      return { items, nextCursor: complete ? nextSinceCursor(checkpoint) : { updated_since: sinceIso(cursor) } };
    },
  };
}

export interface GraphChatMessage {
  id: string;
  createdDateTime?: string;
  from?: { user?: { displayName?: string; id?: string }; application?: { displayName?: string } };
  body?: { content?: string };
}

export function teamsMessagesToRaw(
  teamId: string,
  channelId: string,
  root: GraphChatMessage,
  replies: GraphChatMessage[],
  webUrl: string,
): RawThread {
  const all = [root, ...replies];
  const participants = new Map<string, boolean>();
  const messages = all.map((message) => {
    const isBot = Boolean(message.from?.application);
    const from = message.from?.user?.displayName ?? message.from?.user?.id
      ?? message.from?.application?.displayName ?? "teams-user";
    participants.set(from, (participants.get(from) ?? false) || isBot);
    return { from, ts: message.createdDateTime ?? "", text: stripHtml(message.body?.content ?? "") };
  }).filter((m) => m.text);
  return {
    thread_id: `teams:${teamId}:${channelId}:${root.id}`,
    permalink: webUrl,
    participants: [...participants.entries()].map(([id, is_bot]) => ({ id, is_bot, is_company_member: true })),
    messages,
  };
}

export function microsoftTeamsConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  return {
    type: "microsoft_teams",
    async fetch(_creds, cursor) {
      const checkpoint = new Date().toISOString();
      const token = accessToken(creds);
      const since = sinceIso(cursor);
      const selection = creds.selected_channels;
      if (!Array.isArray(selection) || selection.length === 0 || selection.some((item) => {
        if (!item || typeof item !== "object") return true;
        const channel = item as Record<string, unknown>;
        return typeof channel.team_id !== "string" || !channel.team_id.trim()
          || typeof channel.channel_id !== "string" || !channel.channel_id.trim();
      })) throw new Error("explicit saved resource selection is required");
      const items: RawThread[] = [];
      let complete = true;
      for (const item of selection as { team_id: string; channel_id: string; web_url?: string }[]) {
        if (items.length >= MAX_ITEMS_PER_SYNC) { complete = false; break; }
        const teamId = item.team_id.trim();
        const channelId = item.channel_id.trim();
        const messages = await apiJson(
          fetchFn,
          `${GRAPH}/teams/${teamId}/channels/${channelId}/messages?$top=20`,
          { token },
        );
        if ((messages.value ?? []).length >= 20) complete = false;
        for (const root of (messages.value ?? []) as GraphChatMessage[]) {
          if (items.length >= MAX_ITEMS_PER_SYNC) { complete = false; break; }
          if (root.createdDateTime && root.createdDateTime < since) continue;
          const replies = await apiJson(
            fetchFn,
            `${GRAPH}/teams/${teamId}/channels/${channelId}/messages/${root.id}/replies?$top=30`,
            { token },
          );
          if ((replies.value ?? []).length >= 30) complete = false;
          items.push(teamsMessagesToRaw(teamId, channelId, root, (replies.value ?? []) as GraphChatMessage[], item.web_url ?? ""));
        }
      }
      return { items, nextCursor: complete ? nextSinceCursor(checkpoint) : { updated_since: sinceIso(cursor) } };
    },
  };
}

export interface OutlookMessage {
  id: string;
  conversationId?: string;
  subject?: string;
  receivedDateTime?: string;
  webLink?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  body?: { content?: string };
}

export function outlookConversationToRaw(messages: OutlookMessage[]): RawThread {
  const first = messages[0];
  const participants = new Map<string, boolean>();
  const mapped = messages.map((message) => {
    const from = message.from?.emailAddress?.address ?? message.from?.emailAddress?.name ?? "outlook-sender";
    participants.set(from, (participants.get(from) ?? false) || /no-?reply@/i.test(from));
    return { from, ts: message.receivedDateTime ?? "", text: stripHtml(message.body?.content ?? "") };
  }).filter((m) => m.text);
  return {
    thread_id: `outlook:${first.conversationId ?? first.id}`,
    permalink: first.webLink ?? "",
    title: first.subject,
    participants: [...participants.entries()].map(([id, is_bot]) => ({ id, is_bot, is_company_member: true })),
    messages: mapped,
  };
}

export function outlookConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  return {
    type: "outlook",
    async fetch(_creds, cursor) {
      const checkpoint = new Date().toISOString();
      const token = accessToken(creds);
      const selectedMailbox = selectedString(creds, "selected_mailbox");
      const selectedFolderIds = selectedStrings(creds, "selected_folder_ids");
      const since = sinceIso(cursor);
      const byConversation = new Map<string, OutlookMessage[]>();
      const mailboxPath = selectedMailbox === "me"
        ? `${GRAPH}/me`
        : `${GRAPH}/users/${encodeURIComponent(selectedMailbox)}`;
      let complete = true;
      for (const folderId of selectedFolderIds) {
        if (byConversation.size >= MAX_ITEMS_PER_SYNC) { complete = false; break; }
        const res = await apiJson(
          fetchFn,
          `${mailboxPath}/mailFolders/${encodeURIComponent(folderId)}/messages?$top=50&$orderby=receivedDateTime desc`
            + `&$filter=receivedDateTime ge ${since.split(".")[0]}Z`
            + `&$select=id,conversationId,subject,receivedDateTime,webLink,from,body`,
          { token },
        );
        if ((res.value ?? []).length >= 50) complete = false;
        for (const message of (res.value ?? []) as OutlookMessage[]) {
          const key = message.conversationId ?? message.id;
          byConversation.set(key, [...(byConversation.get(key) ?? []), message]);
        }
      }
      const items = [...byConversation.values()]
        .slice(0, MAX_ITEMS_PER_SYNC)
        .map((messages) => outlookConversationToRaw(messages.reverse()));
      complete = complete && byConversation.size <= MAX_ITEMS_PER_SYNC;
      return { items, nextCursor: complete ? nextSinceCursor(checkpoint) : { updated_since: sinceIso(cursor) } };
    },
  };
}
