import { getConnector, persistConnectorSync, insertEvidence } from "./repo.js";
import { buildConnector } from "./adapters/index.js";
import { ensureFreshCredentials } from "./tokenRefresh.js";
import { filterThreads } from "./junkFilter.js";
import { extractThread } from "./extract.js";
import { aggregate } from "./aggregate.js";
import { embed } from "../db/embed.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import type { Connector, SourceType } from "./types.js";

export interface SyncSummary {
  fetched: number;
  kept: number;
  evidence: number;
  drafts: number;
}

// Run the full pipeline for one connector, in the current tenant context:
// fetch → deterministic junk filter → LLM extract → store evidence → aggregate.
// `connector` is injectable so tests bypass the live API.
export async function syncConnector(
  type: SourceType,
  opts: { llm?: LlmClient; connector?: Connector; focus?: string } = {},
): Promise<SyncSummary> {
  const llm = opts.llm ?? defaultLlm();
  const row = await getConnector(type);
  if (!row) throw new Error(`connector ${type} is not configured`);
  if (row.status !== "connected") throw new Error(`connector ${type} is not connected`);
  const storedCredentials = opts.connector ? row.credentials : await ensureFreshCredentials(row);
  // Settings are an untrusted JSON boundary; only credential values may own
  // provider/authentication fields when producing the adapter input.
  const credentials = { ...row.settings, ...storedCredentials };
  const connector = opts.connector ?? buildConnector(type, credentials);

  const { items, nextCursor } = await connector.fetch(credentials, row.cursor);
  const kept = filterThreads(items);

  let evidence = 0;
  for (const thread of kept) {
    const res = await extractThread(thread, llm, opts.focus);
    if (res.kind === "junk") continue;
    const inserted = await insertEvidence({
      connector_id: row.id,
      source_ref: {
        thread_id: thread.thread_id,
        permalink: thread.permalink,
        source_kind: thread.source_kind ?? "thread",
        ...(thread.title ? { title: thread.title } : {}),
      },
      kind: res.kind,
      summary: res.summary,
      raw_snippet: thread.messages.map((m) => m.text).join("\n").slice(0, 2000),
      confidence: res.confidence,
      embedding: await embed(res.summary),
    });
    if (inserted) evidence++;
  }

  await persistConnectorSync(row.id, type, {
    cursor: nextCursor,
    last_synced_at: new Date().toISOString(),
    last_error: null,
  });

  const drafted = await aggregate(llm, opts.focus);
  return { fetched: items.length, kept: kept.length, evidence, drafts: drafted.skills + drafted.contexts };
}
