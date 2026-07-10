import { db, tenantOrFounding, type Queryable } from "../db/tenant.js";
import { toVectorLiteral } from "../db/vector.js";
import type { ConnectorRow, ConnectorType, EvidenceKind, EvidenceRow } from "./types.js";
import { decryptCredentials, encryptCredentials } from "./credentials.js";

const C_COLS = `id, tenant_id, type, status, credentials, cursor, last_synced_at, last_error, created_at, updated_at`;
const E_COLS = `id, tenant_id, connector_id, source_ref, kind, summary, raw_snippet, confidence,
  promoted_to_kind, promoted_to_id, created_at`;

export async function listConnectors(p: Queryable = db()): Promise<ConnectorRow[]> {
  const { rows } = await p.query(
    `select ${C_COLS} from connectors where tenant_id=$1 order by type`, [tenantOrFounding()]);
  return rows as ConnectorRow[];
}

export async function getConnector(type: ConnectorType, p: Queryable = db()): Promise<ConnectorRow | null> {
  const { rows } = await p.query(
    `select ${C_COLS} from connectors where tenant_id=$1 and type=$2`, [tenantOrFounding(), type]);
  const row = rows[0] as ConnectorRow | undefined;
  if (!row) return null;
  return { ...row, credentials: decryptCredentials(row.credentials) };
}

// Upsert by (tenant, type), merging only the provided fields.
export async function upsertConnector(
  type: ConnectorType,
  patch: {
    status?: string;
    credentials?: unknown;
    cursor?: unknown;
    last_error?: string | null;
    last_synced_at?: string | null;
  },
  p: Queryable = db(),
): Promise<ConnectorRow> {
  const creds = patch.credentials !== undefined ? JSON.stringify(encryptCredentials(patch.credentials)) : null;
  const cursor = patch.cursor !== undefined ? JSON.stringify(patch.cursor) : null;
  const { rows } = await p.query(
    `insert into connectors (tenant_id, type, status, credentials, cursor, last_error, last_synced_at)
     values ($1,$2, coalesce($3,'disabled'), coalesce($4::jsonb,'{}'), coalesce($5::jsonb,'{}'), $6, $7)
     on conflict (tenant_id, type) do update set
       status         = coalesce($3, connectors.status),
       credentials    = coalesce($4::jsonb, connectors.credentials),
       cursor         = coalesce($5::jsonb, connectors.cursor),
       last_error     = $6,
       last_synced_at = coalesce($7, connectors.last_synced_at),
       updated_at     = now()
     returning ${C_COLS}`,
    [tenantOrFounding(), type, patch.status ?? null, creds, cursor,
     patch.last_error ?? null, patch.last_synced_at ?? null],
  );
  return rows[0] as ConnectorRow;
}

// Insert an evidence row; returns null when the thread is already recorded
// (deduped on (tenant, connector, thread_id)).
export async function insertEvidence(
  row: {
    connector_id: string;
    source_ref: unknown;
    kind: EvidenceKind;
    summary: string;
    raw_snippet?: string | null;
    confidence?: number;
    embedding?: number[] | null;
  },
  p: Queryable = db(),
): Promise<EvidenceRow | null> {
  const { rows } = await p.query(
    `insert into evidence
       (tenant_id, connector_id, source_ref, kind, summary, raw_snippet, confidence, embedding)
     values ($1,$2,$3::jsonb,$4,$5,$6,$7,$8::vector)
     on conflict (tenant_id, connector_id, (source_ref->>'thread_id')) do nothing
     returning ${E_COLS}`,
    [tenantOrFounding(), row.connector_id, JSON.stringify(row.source_ref), row.kind, row.summary,
     row.raw_snippet ?? null, row.confidence ?? 0,
     row.embedding ? toVectorLiteral(row.embedding) : null],
  );
  return (rows[0] as EvidenceRow) ?? null;
}

export async function unpromotedEvidence(kind: EvidenceKind, p: Queryable = db()): Promise<EvidenceRow[]> {
  const { rows } = await p.query(
    `select ${E_COLS} from evidence
      where tenant_id=$1 and kind=$2 and promoted_to_id is null order by created_at`,
    [tenantOrFounding(), kind]);
  return rows as EvidenceRow[];
}

// Unpromoted same-kind evidence within cosine `maxDistance` of the seed row
// (includes the seed at distance 0). Used by the greedy clusterer.
export async function nearbyUnpromotedEvidence(
  seedId: string, kind: EvidenceKind, maxDistance: number, p: Queryable = db(),
): Promise<EvidenceRow[]> {
  const { rows } = await p.query(
    `select ${E_COLS.split(",").map((c) => "e." + c.trim()).join(", ")}
       from evidence e, (select embedding from evidence where id=$2) seed
      where e.tenant_id=$1 and e.kind=$3 and e.promoted_to_id is null
        and e.embedding is not null and seed.embedding is not null
        and (e.embedding <=> seed.embedding) <= $4
      order by (e.embedding <=> seed.embedding)`,
    [tenantOrFounding(), seedId, kind, maxDistance]);
  return rows as EvidenceRow[];
}

export async function markPromoted(
  ids: string[], kind: "skill" | "context", promotedId: string, p: Queryable = db(),
): Promise<void> {
  await p.query(
    `update evidence set promoted_to_kind=$3, promoted_to_id=$4
      where tenant_id=$1 and id = any($2::uuid[])`,
    [tenantOrFounding(), ids, kind, promotedId]);
}

// Provenance: the evidence rows that produced a given draft (skill/context).
export async function evidenceForDraft(
  kind: "skill" | "context", promotedId: string, p: Queryable = db(),
): Promise<EvidenceRow[]> {
  const { rows } = await p.query(
    `select ${E_COLS} from evidence
      where tenant_id=$1 and promoted_to_kind=$2 and promoted_to_id=$3 order by created_at`,
    [tenantOrFounding(), kind, promotedId]);
  return rows as EvidenceRow[];
}
