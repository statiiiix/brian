import { getConnector, upsertConnector, insertEvidence } from "./repo.js";
import { buildConnector } from "./adapters/index.js";
import { filterThreads } from "./junkFilter.js";
import { extractThread } from "./extract.js";
import { aggregate } from "./aggregate.js";
import { embed } from "../db/embed.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import type { Connector, ConnectorType } from "./types.js";

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
  type: ConnectorType,
  opts: { llm?: LlmClient; connector?: Connector } = {},
): Promise<SyncSummary> {
  const llm = opts.llm ?? defaultLlm();
  const row = await getConnector(type);
  if (!row) throw new Error(`connector ${type} is not configured`);
  const connector = opts.connector ?? buildConnector(type, row.credentials);

  const { items, nextCursor } = await connector.fetch(row.credentials, row.cursor);
  const kept = filterThreads(items);

  let evidence = 0;
  for (const thread of kept) {
    const res = await extractThread(thread, llm);
    if (res.kind === "junk") continue;
    const inserted = await insertEvidence({
      connector_id: row.id,
      source_ref: { thread_id: thread.thread_id, permalink: thread.permalink },
      kind: res.kind,
      summary: res.summary,
      raw_snippet: thread.messages.map((m) => m.text).join("\n").slice(0, 2000),
      confidence: res.confidence,
      embedding: await embed(res.summary),
    });
    if (inserted) evidence++;
  }

  await upsertConnector(type, {
    cursor: nextCursor,
    last_synced_at: new Date().toISOString(),
    last_error: null,
  });

  const drafted = await aggregate(llm);
  return { fetched: items.length, kept: kept.length, evidence, drafts: drafted.skills + drafted.contexts };
}
