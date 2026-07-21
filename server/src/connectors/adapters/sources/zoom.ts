import type { Connector, RawThread } from "../../types.js";
import { accessToken, apiJson, apiText, clipText, MAX_ITEMS_PER_SYNC, nextSinceCursor, sinceIso, vttToText, type FetchLike } from "./common.js";

export interface ZoomMeeting {
  uuid?: string;
  id?: number;
  topic?: string;
  start_time?: string;
  share_url?: string;
  host_email?: string;
  recording_files?: { file_type?: string; download_url?: string }[];
}

export function zoomMeetingToRaw(meeting: ZoomMeeting, transcript: string): RawThread {
  const host = meeting.host_email ?? "zoom-host";
  return {
    thread_id: `zoom:${meeting.uuid ?? meeting.id}`,
    permalink: meeting.share_url ?? "",
    source_kind: "document",
    title: meeting.topic ?? "Zoom recording",
    participants: [{ id: host, is_company_member: true, is_bot: false }],
    messages: [{ from: host, ts: meeting.start_time ?? "", text: clipText(transcript) }],
  };
}

export function zoomConnector(creds: Record<string, unknown>, fetchFn: FetchLike = fetch): Connector {
  return {
    type: "zoom",
    async fetch(_creds, cursor) {
      const checkpoint = new Date().toISOString();
      const token = accessToken(creds);
      const from = sinceIso(cursor, 30).slice(0, 10); // Zoom caps the listing window at a month
      const res = await apiJson(
        fetchFn,
        `https://api.zoom.us/v2/users/me/recordings?from=${from}&page_size=${MAX_ITEMS_PER_SYNC}`,
        { token },
      );
      const items: RawThread[] = [];
      for (const meeting of (res.meetings ?? []) as ZoomMeeting[]) {
        const transcriptFile = (meeting.recording_files ?? []).find((f) => f.file_type === "TRANSCRIPT");
        if (!transcriptFile?.download_url) continue;
        const vtt = await apiText(fetchFn, transcriptFile.download_url, token);
        const transcript = vttToText(vtt);
        if (!transcript) continue;
        items.push(zoomMeetingToRaw(meeting, transcript));
      }
      const complete = (res.meetings ?? []).length < MAX_ITEMS_PER_SYNC;
      return { items, nextCursor: complete ? nextSinceCursor(checkpoint) : { updated_since: sinceIso(cursor) } };
    },
  };
}
