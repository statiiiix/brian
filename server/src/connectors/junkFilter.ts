import type { RawThread } from "./types.js";

// Deterministic, zero-LLM noise filter — this is where ~90% of raw threads die,
// for free, before any model cost. Thresholds are tunable env constants.
const MIN_HUMANS = Number(process.env.CONNECTORS_MIN_HUMANS ?? 2);
const MIN_MESSAGES = Number(process.env.CONNECTORS_MIN_MESSAGES ?? 2);
const NOREPLY = /no-?reply@/i;

function hasHeader(t: RawThread, key: string): boolean {
  const k = key.toLowerCase();
  return t.messages.some(
    (m) => m.headers != null && Object.keys(m.headers).some((h) => h.toLowerCase() === k),
  );
}

// Keep only threads that look like a real human exchange involving the company.
export function keepThread(t: RawThread): boolean {
  // Documents have a different shape from conversations: one substantial
  // document is enough to be useful evidence, while short docs are noise.
  if (t.source_kind === "document") {
    if (t.participants.some((p) => p.is_bot)) return false;
    if (!t.participants.some((p) => p.is_company_member)) return false;
    return t.messages.some((m) => m.text.trim().length >= 120);
  }
  if (hasHeader(t, "list-unsubscribe")) return false;              // bulk/newsletter
  if (t.messages.some((m) => NOREPLY.test(m.from))) return false;  // automated senders
  if (t.participants.some((p) => p.is_bot)) return false;          // any bot taints it
  if (t.participants.filter((p) => !p.is_bot).length < MIN_HUMANS) return false;
  if (!t.participants.some((p) => p.is_company_member)) return false;
  if (t.messages.length < MIN_MESSAGES) return false;              // one-liner / no reply
  return true;
}

// Dedupe by thread_id (re-syncs overlap), then keep the survivors.
export function filterThreads(items: RawThread[]): RawThread[] {
  const seen = new Set<string>();
  const deduped: RawThread[] = [];
  for (const t of items) {
    if (seen.has(t.thread_id)) continue;
    seen.add(t.thread_id);
    deduped.push(t);
  }
  return deduped.filter(keepThread);
}
