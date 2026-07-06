// A normalized thread from any connector — the pipeline only ever sees these,
// never live API payloads (adapters isolate network I/O).
export interface RawThread {
  thread_id: string;
  permalink: string;
  participants: { id: string; is_company_member: boolean; is_bot: boolean }[];
  messages: { from: string; ts: string; text: string; headers?: Record<string, string> }[];
}

export type ConnectorType = "gmail" | "slack";

// Pure-fetch adapter: incremental from the stored cursor.
export interface Connector {
  type: ConnectorType;
  fetch(creds: unknown, cursor: unknown): Promise<{ items: RawThread[]; nextCursor: unknown }>;
}

export type EvidenceKind = "skill_evidence" | "context_evidence";

// One LLM extraction of a thread. `junk` is dropped, not stored.
export interface ExtractResult {
  kind: EvidenceKind | "junk";
  confidence: number;
  summary: string;
}

export interface ConnectorRow {
  id: string;
  tenant_id: string;
  type: ConnectorType;
  status: string;
  credentials: Record<string, unknown>;
  cursor: Record<string, unknown>;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvidenceRow {
  id: string;
  tenant_id: string;
  connector_id: string;
  source_ref: Record<string, unknown>;
  kind: EvidenceKind;
  summary: string;
  raw_snippet: string | null;
  confidence: number;
  promoted_to_kind: string | null;
  promoted_to_id: string | null;
  created_at: string;
}
