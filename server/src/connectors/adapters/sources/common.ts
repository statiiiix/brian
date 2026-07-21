// Shared plumbing for the authorized-source adapters. Every adapter is a pure
// mapping over provider payloads plus a live fetch built on these helpers, so
// network behavior (auth header, error shape, caps) stays uniform.

export type FetchLike = typeof fetch;

// Bound how much any single sync pulls: item count caps LLM extraction cost,
// text length caps prompt size per item.
export const MAX_ITEMS_PER_SYNC = 25;
export const MAX_TEXT_LENGTH = 10_000;

export interface ApiJsonOptions {
  token?: string;
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function apiJson(
  fetchFn: FetchLike,
  url: string,
  { token, method = "GET", body, headers = {} }: ApiJsonOptions = {},
): Promise<any> {
  const res = await fetchFn(url, {
    method,
    headers: {
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    throw new Error(`${new URL(url).host} request failed (${res.status})`);
  }
  return res.json();
}

export async function apiText(fetchFn: FetchLike, url: string, token?: string): Promise<string> {
  const res = await fetchFn(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`${new URL(url).host} download failed (${res.status})`);
  return res.text();
}

export function accessToken(creds: Record<string, unknown>): string {
  const token = creds.access_token;
  if (typeof token !== "string" || !token) throw new Error("connector has no access token — reconnect the source");
  return token;
}

export function selectedStrings(creds: Record<string, unknown>, key: string): string[] {
  const value = creds[key];
  if (!Array.isArray(value) || value.length === 0
    || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("explicit saved resource selection is required");
  }
  return value.map((item) => item.trim());
}

export function selectedString(creds: Record<string, unknown>, key: string): string {
  const value = creds[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("explicit saved resource selection is required");
  }
  return value.trim();
}

export function clipText(text: string, max = MAX_TEXT_LENGTH): string {
  return text.length > max ? text.slice(0, max) : text;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Atlassian Document Format (Jira descriptions/comments) → plain text.
export function adfToText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(adfToText).filter(Boolean).join("\n");
  if (typeof node !== "object") return "";
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (typeof n.text === "string") return n.text;
  const inner = (n.content ?? []).map(adfToText).filter(Boolean);
  // Inline containers join with spaces; block containers with newlines.
  const blocky = ["doc", "bulletList", "orderedList", "listItem", "blockquote", "table", "tableRow"].includes(n.type ?? "");
  return inner.join(blocky ? "\n" : " ");
}

// WebVTT transcript (Zoom recordings) → "speaker: line" plain text.
export function vttToText(vtt: string): string {
  return vtt
    .split(/\r?\n/)
    .filter((line) => line
      && line !== "WEBVTT"
      && !/^\d+$/.test(line)
      && !line.includes("-->"))
    .join("\n")
    .trim();
}

// Incremental watermark: adapters fetch items updated since the previous sync,
// defaulting to a bounded backfill window on the first run.
export function sinceIso(cursor: unknown, fallbackDays = 45): string {
  const stored = (cursor as Record<string, unknown> | null)?.updated_since;
  if (typeof stored === "string" && !Number.isNaN(Date.parse(stored))) return stored;
  return new Date(Date.now() - fallbackDays * 86_400_000).toISOString();
}

export function nextSinceCursor(checkpoint = new Date().toISOString()): Record<string, string> {
  return { updated_since: checkpoint };
}
