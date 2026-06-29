import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import { capture, type CaptureResult } from "./capture.js";
import type { AnthropicLike } from "./draftFromText.js";

export interface BulkDoc { source: string; text: string }
export interface BulkResult { source: string; ok: boolean; result?: CaptureResult; error?: string }

export async function ingestBulk(
  docs: BulkDoc[], c?: AnthropicLike, p: pg.Pool = defaultPool
): Promise<BulkResult[]> {
  const out: BulkResult[] = [];
  for (const doc of docs) {
    try {
      const result = await capture(doc.text, c, p);
      out.push({ source: doc.source, ok: true, result });
    } catch (e) {
      out.push({ source: doc.source, ok: false, error: (e as Error).message });
    }
  }
  return out;
}
