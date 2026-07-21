// Source-grounded interviews read the connected source's *selected* content
// live, as a bounded document pack. Each provider that supports grounding
// registers a fetcher here; everything else about interviews stays
// provider-agnostic. Sync/evidence remains the durable ingestion path — this
// is a point-in-time read used to seed a skill interview.
import type { SourceContext, SourceDocument } from "../interviews/types.js";
import { readNotionSelectionDocuments } from "./adapters/sources/notion.js";
import { getConnector } from "./repo.js";
import { ensureFreshCredentials } from "./tokenRefresh.js";
import type { SourceType } from "./types.js";

// Keep the total pack well inside one model context alongside the transcript.
const MAX_TOTAL_CHARS = 60_000;

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

export function supportsSelectionContent(type: string): type is SourceType {
  return type in FETCHERS;
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
  const fetcher = FETCHERS[type];
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
