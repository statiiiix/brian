import type { Connector, RawThread } from "../../types.js";
import { Buffer } from "node:buffer";
import { accessToken, apiJson, clipText, MAX_ITEMS_PER_SYNC, nextSinceCursor, sinceIso, type FetchLike } from "./common.js";

const NOTION_VERSION = "2026-03-11";
const NOTION_PAGE_SIZE = 100;
const MAX_BLOCKS_PER_DOCUMENT = 1_000;
const MAX_BLOCK_DEPTH = 20;

export interface NotionPage {
  object?: string;
  id: string;
  url?: string;
  in_trash?: boolean;
  last_edited_time?: string;
  last_edited_by?: { id?: string };
  properties?: Record<string, { type?: string; title?: { plain_text?: string }[] }>;
}

export interface NotionBoundary {
  id: string;
  kind: "page" | "data_source";
  title: string;
  permalink: string;
}

export interface NotionBoundaryDiscovery {
  boundaries: NotionBoundary[];
  truncated: boolean;
}

export async function revokeNotionToken(
  accessToken: string,
  config: { clientId: string; clientSecret: string },
  fetchFn: FetchLike = fetch,
): Promise<void> {
  const response = await fetchFn("https://api.notion.com/v1/oauth/revoke", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({ token: accessToken }),
  });
  if (!response.ok) throw new Error("notion_revocation_failed");
}

export function notionPageTitle(page: NotionPage): string {
  for (const prop of Object.values(page.properties ?? {})) {
    if (prop?.type === "title") {
      const title = (prop.title ?? []).map((t) => t.plain_text ?? "").join("").trim();
      if (title) return title;
    }
  }
  return "Untitled page";
}

function notionBoundaryTitle(value: Record<string, any>): string {
  if (value.object === "page") return notionPageTitle(value as NotionPage);
  const title = (value.title ?? []).map((part: { plain_text?: string }) => part.plain_text ?? "").join("").trim();
  return title || "Untitled data source";
}

// Search is used only to present an explicit, bounded resource-selection
// boundary; selected IDs, not discovery results, remain the ingestion authority.
export async function discoverNotionBoundaries(
  creds: Record<string, unknown>,
  fetchFn: FetchLike = fetch,
  limit = 100,
): Promise<NotionBoundaryDiscovery> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("invalid boundary limit");
  const token = accessToken(creds);
  const headers = { "Notion-Version": NOTION_VERSION };
  const boundaries: NotionBoundary[] = [];
  const seenIds = new Set<string>();

  for (const kind of ["page", "data_source"] as const) {
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    let hasMore = false;
    do {
      const remaining = limit - boundaries.length;
      if (remaining <= 0) return { boundaries, truncated: true };
      const response = await notionApiJson(fetchFn, "https://api.notion.com/v1/search", {
        token,
        method: "POST",
        headers,
        body: {
          filter: { property: "object", value: kind },
          page_size: Math.min(NOTION_PAGE_SIZE, remaining),
          ...(cursor ? { start_cursor: cursor } : {}),
        },
      });
      for (const result of (response.results ?? []) as Record<string, any>[]) {
        if (result?.object !== kind || result.in_trash || typeof result.id !== "string" || !result.id || seenIds.has(result.id)) continue;
        seenIds.add(result.id);
        boundaries.push({
          id: result.id,
          kind,
          title: notionBoundaryTitle(result),
          permalink: typeof result.url === "string" && result.url
            ? result.url
            : `https://www.notion.so/${result.id.replace(/-/g, "")}`,
        });
        if (boundaries.length >= limit) return { boundaries, truncated: Boolean(response.has_more) || kind === "page" };
      }
      hasMore = Boolean(response.has_more);
      cursor = response.next_cursor;
      if (hasMore) {
        if (typeof cursor !== "string" || !cursor) throw new Error("api.notion.com pagination cursor is missing");
        if (seenCursors.has(cursor)) throw new Error("api.notion.com pagination cursor repeated");
        seenCursors.add(cursor);
      }
    } while (hasMore);
  }
  return { boundaries, truncated: false };
}

export function notionPageToRaw(page: NotionPage, text: string): RawThread {
  const editor = page.last_edited_by?.id ?? "notion-editor";
  return {
    thread_id: page.id,
    permalink: page.url ?? `https://www.notion.so/${page.id.replace(/-/g, "")}`,
    source_kind: "document",
    title: notionPageTitle(page),
    participants: [{ id: editor, is_company_member: true, is_bot: false }],
    messages: [{ from: editor, ts: page.last_edited_time ?? "", text }],
  };
}

export function notionBlocksToText(blocks: { type?: string; [key: string]: any }[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.in_trash) continue;
    const value = block[block.type ?? ""];
    const rich = value?.rich_text ?? value?.title ?? [];
    const line = (Array.isArray(rich) ? rich : []).map((r: any) => r?.plain_text ?? "").join("").trim();
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

function selectedNotionIds(creds: Record<string, unknown>, key: "selected_page_ids" | "selected_data_source_ids"): string[] {
  const value = creds[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("explicit saved resource selection is required");
  }
  return [...new Set(value.map((id) => id.trim()))];
}

function isCurrentPage(page: NotionPage, since: string): boolean {
  return !page.last_edited_time || page.last_edited_time >= since;
}

interface NotionResume {
  selection_fingerprint: string;
  page_index: number;
  data_source_index: number;
  data_source_cursor?: string;
}

function notionSelectionFingerprint(pageIds: string[], dataSourceIds: string[]): string {
  return JSON.stringify({ page_ids: pageIds, data_source_ids: dataSourceIds });
}

function resumeFrom(cursor: unknown, fingerprint: string): NotionResume | null {
  const candidate = (cursor as { notion_resume?: unknown } | null)?.notion_resume;
  if (!candidate || typeof candidate !== "object") return null;
  const resume = candidate as Partial<NotionResume>;
  if (resume.selection_fingerprint !== fingerprint
    || !Number.isInteger(resume.page_index) || (resume.page_index ?? -1) < 0
    || !Number.isInteger(resume.data_source_index) || (resume.data_source_index ?? -1) < 0
    || (resume.data_source_cursor !== undefined && (typeof resume.data_source_cursor !== "string" || !resume.data_source_cursor))) return null;
  return resume as NotionResume;
}

function notionResumeCursor(since: string, resume: NotionResume): { updated_since: string; notion_resume: NotionResume } {
  return { updated_since: since, notion_resume: resume };
}

async function notionApiJson(fetchFn: FetchLike, url: string, options: Parameters<typeof apiJson>[2]): Promise<any> {
  const response = await apiJson(fetchFn, url, options);
  if (response?.request_status?.type === "incomplete") throw new Error("api.notion.com request was incomplete");
  return response;
}

export interface NotionSelectionDocument {
  title: string;
  url: string;
  text: string;
}

// Lenient id reader for selection-content fetches: saved settings always carry
// both keys, and either list may legitimately be empty.
function savedIds(creds: Record<string, unknown>, key: string): string[] {
  const value = creds[key];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id) => typeof id === "string" && id.trim()).map((id) => (id as string).trim()))];
}

// Read the full current content of the saved selection as bounded documents.
// Used to ground skill interviews; sync/evidence remains the ingestion path.
export async function readNotionSelectionDocuments(
  creds: Record<string, unknown>,
  fetchFn: FetchLike = fetch,
  limits: { maxDocuments?: number; maxDataSourcePages?: number } = {},
): Promise<NotionSelectionDocument[]> {
  const maxDocuments = limits.maxDocuments ?? 20;
  const maxDataSourcePages = limits.maxDataSourcePages ?? 5;
  const token = accessToken(creds);
  const headers = { "Notion-Version": NOTION_VERSION };
  const pageIds = savedIds(creds, "selected_page_ids");
  const dataSourceIds = savedIds(creds, "selected_data_source_ids");
  if (pageIds.length === 0 && dataSourceIds.length === 0) {
    throw new Error("explicit saved resource selection is required");
  }

  const documents: NotionSelectionDocument[] = [];
  const seenPageIds = new Set<string>();

  const addPage = async (page: NotionPage) => {
    if (page.in_trash || !page.id || seenPageIds.has(page.id) || documents.length >= maxDocuments) return;
    seenPageIds.add(page.id);
    const blocks = await readNotionBlocks(fetchFn, token, headers, page.id);
    documents.push({
      title: notionPageTitle(page),
      url: page.url ?? `https://www.notion.so/${page.id.replace(/-/g, "")}`,
      text: clipText(notionBlocksToText(blocks)),
    });
  };

  for (const pageId of pageIds) {
    if (documents.length >= maxDocuments) break;
    const page = await notionApiJson(fetchFn,
      `https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`, { token, headers }) as NotionPage;
    await addPage(page);
  }

  for (const dataSourceId of dataSourceIds) {
    if (documents.length >= maxDocuments) break;
    const query = await notionApiJson(fetchFn,
      `https://api.notion.com/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
        token,
        method: "POST",
        headers,
        body: {
          page_size: Math.min(NOTION_PAGE_SIZE, maxDataSourcePages),
          result_type: "page",
          sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
        },
      });
    for (const page of (query.results ?? []) as NotionPage[]) {
      if (page?.object !== "page") throw new Error("api.notion.com query returned a non-page result");
      await addPage(page);
      if (documents.length >= maxDocuments) break;
    }
  }
  return documents;
}

export function notionConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  const headers = { "Notion-Version": NOTION_VERSION };
  return {
    type: "notion",
    async fetch(_creds, cursor) {
      const checkpoint = new Date().toISOString();
      const token = accessToken(creds);
      const since = sinceIso(cursor);
      const selectedPageIds = selectedNotionIds(creds, "selected_page_ids");
      const selectedDataSourceIds = selectedNotionIds(creds, "selected_data_source_ids");
      if (selectedPageIds.length === 0 && selectedDataSourceIds.length === 0) {
        throw new Error("explicit saved resource selection is required");
      }

      const items: RawThread[] = [];
      const seenPageIds = new Set<string>();
      const fingerprint = notionSelectionFingerprint(selectedPageIds, selectedDataSourceIds);
      const resume = resumeFrom(cursor, fingerprint);

      const addPage = async (page: NotionPage) => {
        if (page.in_trash || !page.id || seenPageIds.has(page.id) || !isCurrentPage(page, since)) return;
        seenPageIds.add(page.id);
        const blocks = await readNotionBlocks(fetchFn, token, headers, page.id);
        items.push(notionPageToRaw(page, clipText(notionBlocksToText(blocks))));
      };

      const pageStart = Math.min(resume?.page_index ?? 0, selectedPageIds.length);
      for (let pageIndex = pageStart; pageIndex < selectedPageIds.length; pageIndex++) {
        if (items.length >= MAX_ITEMS_PER_SYNC) {
          return { items, nextCursor: notionResumeCursor(since, { selection_fingerprint: fingerprint, page_index: pageIndex, data_source_index: 0 }) };
        }
        const page = await notionApiJson(fetchFn, `https://api.notion.com/v1/pages/${encodeURIComponent(selectedPageIds[pageIndex])}`, { token, headers }) as NotionPage;
        await addPage(page);
        if (items.length >= MAX_ITEMS_PER_SYNC && (pageIndex + 1 < selectedPageIds.length || selectedDataSourceIds.length > 0)) {
          return { items, nextCursor: notionResumeCursor(since, { selection_fingerprint: fingerprint, page_index: pageIndex + 1, data_source_index: 0 }) };
        }
      }

      const dataSourceStart = Math.min(resume?.data_source_index ?? 0, selectedDataSourceIds.length);
      for (let dataSourceIndex = dataSourceStart; dataSourceIndex < selectedDataSourceIds.length; dataSourceIndex++) {
        let nextCursor = dataSourceIndex === dataSourceStart ? resume?.data_source_cursor : undefined;
        const seenCursors = new Set<string>(nextCursor ? [nextCursor] : []);
        let hasMore = false;
        do {
          const remaining = MAX_ITEMS_PER_SYNC - items.length;
          if (remaining <= 0) {
            return { items, nextCursor: notionResumeCursor(since, { selection_fingerprint: fingerprint, page_index: selectedPageIds.length, data_source_index: dataSourceIndex, ...(nextCursor ? { data_source_cursor: nextCursor } : {}) }) };
          }
          const query = await notionApiJson(fetchFn, `https://api.notion.com/v1/data_sources/${encodeURIComponent(selectedDataSourceIds[dataSourceIndex])}/query`, {
            token,
            method: "POST",
            headers,
            body: {
              page_size: Math.min(NOTION_PAGE_SIZE, remaining),
              result_type: "page",
              filter: { timestamp: "last_edited_time", last_edited_time: { on_or_after: since } },
              sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
              ...(nextCursor ? { start_cursor: nextCursor } : {}),
            },
          });
          for (const page of (query.results ?? []) as NotionPage[]) {
            if (page?.object !== "page") throw new Error("api.notion.com query returned a non-page result");
            await addPage(page);
            if (items.length >= MAX_ITEMS_PER_SYNC) break;
          }
          nextCursor = query.next_cursor;
          hasMore = Boolean(query.has_more);
          if (hasMore) {
            if (typeof nextCursor !== "string" || !nextCursor) throw new Error("api.notion.com pagination cursor is missing");
            if (seenCursors.has(nextCursor)) throw new Error("api.notion.com pagination cursor repeated");
            seenCursors.add(nextCursor);
          }
          if (items.length >= MAX_ITEMS_PER_SYNC) {
            if (hasMore) {
              return { items, nextCursor: notionResumeCursor(since, { selection_fingerprint: fingerprint, page_index: selectedPageIds.length, data_source_index: dataSourceIndex, data_source_cursor: nextCursor }) };
            }
            if (dataSourceIndex + 1 < selectedDataSourceIds.length) {
              return { items, nextCursor: notionResumeCursor(since, { selection_fingerprint: fingerprint, page_index: selectedPageIds.length, data_source_index: dataSourceIndex + 1 }) };
            }
          }
        } while (hasMore);
      }
      return { items, nextCursor: nextSinceCursor(checkpoint) };
    },
  };
}

async function readNotionBlocks(
  fetchFn: FetchLike,
  token: string,
  headers: Record<string, string>,
  rootId: string,
): Promise<{ type?: string; [key: string]: any }[]> {
  const blocks: { type?: string; [key: string]: any }[] = [];
  const visitedParents = new Set<string>();
  let traversed = 0;

  const readChildren = async (parentId: string, depth: number): Promise<void> => {
    if (depth > MAX_BLOCK_DEPTH || visitedParents.has(parentId)) {
      throw new Error("api.notion.com block traversal is incomplete");
    }
    visitedParents.add(parentId);
    let nextCursor: string | null | undefined;
    const seenCursors = new Set<string>();
    let hasMore = false;
    do {
      const suffix = nextCursor ? `&start_cursor=${encodeURIComponent(nextCursor)}` : "";
      const response = await notionApiJson(
        fetchFn,
        `https://api.notion.com/v1/blocks/${encodeURIComponent(parentId)}/children?page_size=${NOTION_PAGE_SIZE}${suffix}`,
        { token, headers },
      );
      for (const block of (response.results ?? []) as { type?: string; [key: string]: any }[]) {
        if (traversed >= MAX_BLOCKS_PER_DOCUMENT) {
          throw new Error("api.notion.com block traversal is incomplete");
        }
        traversed++;
        if (block.in_trash) continue;
        blocks.push(block);
        if (block.has_children && typeof block.id === "string") await readChildren(block.id, depth + 1);
      }
      nextCursor = response.next_cursor;
      hasMore = Boolean(response.has_more);
      if (hasMore) {
        if (typeof nextCursor !== "string" || !nextCursor) throw new Error("api.notion.com pagination cursor is missing");
        if (seenCursors.has(nextCursor)) throw new Error("api.notion.com pagination cursor repeated");
        seenCursors.add(nextCursor);
      }
    } while (hasMore);
  };

  await readChildren(rootId, 0);
  return blocks;
}
