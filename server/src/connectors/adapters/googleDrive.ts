import type { Connector, RawThread } from "../types.js";
import { getAccessToken, type FetchFn, type GmailConfig } from "../../gmail/client.js";

export const GOOGLE_DOC = "application/vnd.google-apps.document";
export const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
export const GOOGLE_SLIDE = "application/vnd.google-apps.presentation";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  owners?: { emailAddress?: string }[];
  modifiedTime?: string;
}

export interface DriveApi {
  listFiles(): Promise<DriveFile[]>;
  getFileContent(file: DriveFile): Promise<string>;
}

export function driveFileToRaw(file: DriveFile, text: string): RawThread {
  const owner = file.owners?.[0]?.emailAddress ?? "google-drive-owner";
  return {
    thread_id: file.id,
    permalink: file.webViewLink ?? `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`,
    source_kind: "document",
    title: file.name,
    participants: [{ id: owner, is_company_member: true, is_bot: false }],
    messages: [{ from: owner, ts: file.modifiedTime ?? "", text }],
  };
}

async function driveGet(accessToken: string, path: string, fetchFn: FetchFn): Promise<Response> {
  const res = await fetchFn(`https://www.googleapis.com/drive/v3/${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`drive ${path.split("?")[0]} failed (${res.status}): ${await res.text()}`);
  return res;
}

function supported(file: DriveFile): boolean {
  return [GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_SLIDE, "text/plain", "text/markdown"].includes(file.mimeType);
}

export function realDriveApi(cfg: GmailConfig, fetchFn: FetchFn = fetch): DriveApi {
  return {
    async listFiles() {
      const token = await getAccessToken(cfg, fetchFn);
      const q = [
        "trashed = false",
        `(${[GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_SLIDE, "text/plain", "text/markdown"].map((mime) => `mimeType = '${mime}'`).join(" or ")})`,
      ].join(" and ");
      const params = new URLSearchParams({
        q,
        pageSize: "50",
        orderBy: "modifiedTime desc",
        fields: "files(id,name,mimeType,webViewLink,owners(emailAddress),modifiedTime)",
      });
      const res = await driveGet(token, `files?${params.toString()}`, fetchFn);
      const files = ((await res.json()) as { files?: DriveFile[] }).files ?? [];
      return files.filter(supported);
    },
    async getFileContent(file) {
      const token = await getAccessToken(cfg, fetchFn);
      if (file.mimeType === GOOGLE_DOC) {
        const res = await driveGet(token, `files/${encodeURIComponent(file.id)}/export?mimeType=text/plain`, fetchFn);
        return res.text();
      }
      if (file.mimeType === GOOGLE_SHEET) {
        const res = await driveGet(token, `files/${encodeURIComponent(file.id)}/export?mimeType=text/csv`, fetchFn);
        return res.text();
      }
      if (file.mimeType === GOOGLE_SLIDE) {
        const res = await driveGet(token, `files/${encodeURIComponent(file.id)}/export?mimeType=text/plain`, fetchFn);
        return res.text();
      }
      const res = await driveGet(token, `files/${encodeURIComponent(file.id)}?alt=media`, fetchFn);
      return res.text();
    },
  };
}

export function googleDriveConnector(api: DriveApi): Connector {
  return {
    type: "google_drive",
    async fetch() {
      const files = await api.listFiles();
      const items: RawThread[] = [];
      for (const file of files) {
        const text = (await api.getFileContent(file)).slice(0, 10000);
        items.push(driveFileToRaw(file, text));
      }
      return { items, nextCursor: { modifiedAt: new Date().toISOString() } };
    },
  };
}
