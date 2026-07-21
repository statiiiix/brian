import type { Connector, RawThread } from "../../types.js";
import { accessToken, adfToText, apiJson, clipText, MAX_ITEMS_PER_SYNC, nextSinceCursor, sinceIso, stripHtml, type FetchLike } from "./common.js";

// Confluence and Jira share Atlassian's 3LO gateway: every API call is scoped
// to a cloud site resolved from the token.
export async function atlassianCloudId(token: string, fetchFn: FetchLike): Promise<string> {
  const resources = await apiJson(fetchFn, "https://api.atlassian.com/oauth/token/accessible-resources", { token });
  const id = Array.isArray(resources) ? resources[0]?.id : null;
  if (!id) throw new Error("no accessible Atlassian site for this connection");
  return String(id);
}

export interface ConfluencePage {
  id: string;
  title?: string;
  body?: { storage?: { value?: string } };
  history?: { lastUpdated?: { by?: { accountId?: string }; when?: string } };
  _links?: { webui?: string };
}

export function confluencePageToRaw(page: ConfluencePage, baseUrl: string): RawThread {
  const author = page.history?.lastUpdated?.by?.accountId ?? "confluence-author";
  return {
    thread_id: `confluence:${page.id}`,
    permalink: `${baseUrl}${page._links?.webui ?? `/pages/${page.id}`}`,
    source_kind: "document",
    title: page.title ?? "Untitled page",
    participants: [{ id: author, is_company_member: true, is_bot: false }],
    messages: [{
      from: author,
      ts: page.history?.lastUpdated?.when ?? "",
      text: clipText(stripHtml(page.body?.storage?.value ?? "")),
    }],
  };
}

export function confluenceConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  return {
    type: "confluence",
    async fetch(_creds, cursor) {
      const token = accessToken(creds);
      const cloudId = await atlassianCloudId(token, fetchFn);
      const api = `https://api.atlassian.com/ex/confluence/${cloudId}`;
      const since = sinceIso(cursor).slice(0, 16).replace("T", " ");
      const cql = encodeURIComponent(`type=page and lastmodified >= "${since}" order by lastmodified desc`);
      const res = await apiJson(
        fetchFn,
        `${api}/wiki/rest/api/content/search?cql=${cql}&limit=${MAX_ITEMS_PER_SYNC}&expand=body.storage,history.lastUpdated`,
        { token },
      );
      const items = ((res.results ?? []) as ConfluencePage[])
        .map((page) => confluencePageToRaw(page, `${api}/wiki`));
      return { items, nextCursor: nextSinceCursor() };
    },
  };
}

export interface JiraIssue {
  key: string;
  fields?: {
    summary?: string;
    description?: unknown;
    updated?: string;
    creator?: { accountId?: string; displayName?: string };
    comment?: { comments?: { author?: { accountId?: string; displayName?: string }; created?: string; body?: unknown }[] };
  };
}

export function jiraIssueToRaw(issue: JiraIssue, siteUrl: string): RawThread {
  const creator = issue.fields?.creator?.displayName ?? issue.fields?.creator?.accountId ?? "jira-reporter";
  const messages = [{
    from: creator,
    ts: issue.fields?.updated ?? "",
    text: `${issue.fields?.summary ?? issue.key}\n${adfToText(issue.fields?.description)}`.trim(),
  }];
  const participants = new Map<string, boolean>([[creator, false]]);
  for (const comment of issue.fields?.comment?.comments ?? []) {
    const author = comment.author?.displayName ?? comment.author?.accountId ?? "jira-commenter";
    participants.set(author, false);
    messages.push({ from: author, ts: comment.created ?? "", text: adfToText(comment.body) });
  }
  return {
    thread_id: `jira:${issue.key}`,
    permalink: `${siteUrl}/browse/${issue.key}`,
    participants: [...participants.keys()].map((id) => ({ id, is_company_member: true, is_bot: false })),
    messages: messages.filter((m) => m.text.trim()),
  };
}

export function jiraConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  return {
    type: "jira",
    async fetch(_creds, cursor) {
      const token = accessToken(creds);
      const cloudId = await atlassianCloudId(token, fetchFn);
      const api = `https://api.atlassian.com/ex/jira/${cloudId}`;
      const since = sinceIso(cursor).slice(0, 16).replace("T", " ");
      const jql = encodeURIComponent(`updated >= "${since}" order by updated desc`);
      const res = await apiJson(
        fetchFn,
        `${api}/rest/api/3/search?jql=${jql}&maxResults=${MAX_ITEMS_PER_SYNC}&fields=summary,description,updated,creator,comment`,
        { token },
      );
      const items = ((res.issues ?? []) as JiraIssue[]).map((issue) => jiraIssueToRaw(issue, api));
      return { items, nextCursor: nextSinceCursor() };
    },
  };
}
