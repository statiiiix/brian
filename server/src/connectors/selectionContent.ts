// Source-grounded interviews read the connected source's *selected* content
// live, as a bounded document pack. Each provider that supports grounding
// registers a fetcher here; everything else about interviews stays
// provider-agnostic. Sync/evidence remains the durable ingestion path — this
// is a point-in-time read used to seed a skill interview.
import type { SourceContext, SourceDocument } from "../interviews/types.js";
import { buildConnector, isSyncableType } from "./adapters/index.js";
import { readNotionSelectionDocuments } from "./adapters/sources/notion.js";
import { getConnector } from "./repo.js";
import { ensureFreshCredentials } from "./tokenRefresh.js";
import type { RawThread, SourceType } from "./types.js";

// Keep the total pack well inside one model context alongside the transcript.
const MAX_TOTAL_CHARS = 60_000;
// How many recent items a source without its own picker contributes.
const MAX_ADAPTER_DOCUMENTS = 12;

type SelectionFetcher = (
  creds: Record<string, unknown>,
  fetchFn: typeof fetch,
) => Promise<SourceDocument[]>;

export interface SourceSelection {
  selected_page_ids: string[];
  selected_data_source_ids: string[];
}

const FETCHERS: Partial<Record<SourceType, SelectionFetcher>> = {
  notion: (creds, fetchFn) => readNotionSelectionDocuments(creds, fetchFn),
};

function threadDocument(thread: RawThread): SourceDocument {
  return {
    title: thread.title ?? thread.thread_id,
    url: thread.permalink ?? "",
    text: thread.messages.map((m) => `${m.from}: ${m.text}`).join("\n\n").trim(),
  };
}

// Sources with a selection UI read exactly what the expert picked. Everything
// else grounds on its sync adapter's recent window, so any connected source can
// seed an interview instead of only the two that have a bespoke picker.
function fetcherFor(type: SourceType): SelectionFetcher | undefined {
  const bespoke = FETCHERS[type];
  if (bespoke) return bespoke;
  if (!isSyncableType(type)) return undefined;
  return async (creds) => {
    const { items } = await buildConnector(type, creds).fetch(creds, {});
    return items.slice(0, MAX_ADAPTER_DOCUMENTS).map(threadDocument).filter((doc) => doc.text);
  };
}

export function supportsSelectionContent(type: string): type is SourceType {
  return type in FETCHERS || isSyncableType(type);
}

export class SelectionContentError extends Error {
  constructor(public code: "source_not_connected" | "selection_required") {
    super(code);
    this.name = "SelectionContentError";
  }
}

function boundDocuments(documents: SourceDocument[]): SourceDocument[] {
  const bounded: SourceDocument[] = [];
  let total = 0;
  for (const doc of documents) {
    const remaining = MAX_TOTAL_CHARS - total;
    if (remaining <= 0) break;
    const text = doc.text.length > remaining ? doc.text.slice(0, remaining) : doc.text;
    bounded.push({ ...doc, text });
    total += text.length;
  }
  return bounded;
}

// Fetch the live selection content for a connected source as a SourceContext
// snapshot. Throws SelectionContentError for caller-fixable states; provider
// request failures bubble as-is.
export async function fetchSelectionContext(
  type: SourceType,
  fetchFn: typeof fetch = fetch,
  selection?: SourceSelection,
): Promise<SourceContext> {
  const fetcher = fetcherFor(type);
  if (!fetcher) throw new SelectionContentError("source_not_connected");
  const row = await getConnector(type);
  if (!row || row.status !== "connected") throw new SelectionContentError("source_not_connected");
  const credentials = await ensureFreshCredentials(row, fetchFn);
  // Settings carry the saved selection; credentials win on any key collision.
  const merged = { ...(row.settings ?? {}), ...(selection ?? {}), ...credentials } as Record<string, unknown>;
  let documents: SourceDocument[];
  try {
    documents = await fetcher(merged, fetchFn);
  } catch (e) {
    if (e instanceof Error && e.message === "explicit saved resource selection is required") {
      throw new SelectionContentError("selection_required");
    }
    throw e;
  }
  if (documents.length === 0) throw new SelectionContentError("selection_required");
  return {
    source_type: type,
    fetched_at: new Date().toISOString(),
    documents: boundDocuments(documents),
  };
}
