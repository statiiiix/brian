import { createHash } from "node:crypto";
import { db, tenantOrFounding, type Queryable } from "../db/tenant.js";
import type {
  InterviewEvidence, InterviewSource, InterviewSourceKind, InterviewSourceStatus, SourceContext,
} from "./types.js";
import type { ResearchResult } from "./research.js";

const SOURCE_COLS = `id, interview_id, kind, title, source_type, url, status,
  extracted_text, idempotency_key, added_at, retrieved_at, error_code`;

interface InterviewSourceInput {
  interview_id: string;
  kind: InterviewSourceKind;
  title: string;
  source_type: string;
  url: string | null;
  status: InterviewSourceStatus;
  extracted_text: string | null;
  idempotency_key: string;
  retrieved_at: string | null;
}

export function sourceIdempotencyKey(
  interviewId: string, sourceType: string, identity: string,
): string {
  return createHash("sha256")
    .update(`${interviewId}\0${sourceType}\0${identity}`)
    .digest("hex");
}

export function uploadSourceIdempotencyKey(
  interviewId: string, _filename: string, bytes: Uint8Array,
): string {
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  return sourceIdempotencyKey(interviewId, "upload", contentHash);
}

export function connectorSourceInputs(
  interviewId: string, context: SourceContext,
): InterviewSourceInput[] {
  return context.documents.map((document) => ({
    interview_id: interviewId,
    kind: "connector",
    title: document.title,
    source_type: context.source_type,
    url: document.url || null,
    status: "ready",
    extracted_text: document.text,
    idempotency_key: sourceIdempotencyKey(
      interviewId, context.source_type, document.url || document.title,
    ),
    retrieved_at: context.fetched_at,
  }));
}

export async function listInterviewSources(
  interviewId: string, p: Queryable = db(),
): Promise<InterviewSource[]> {
  const { rows } = await p.query(
    `select ${SOURCE_COLS} from interview_sources
      where interview_id = $1 and tenant_id = $2 order by added_at, id`,
    [interviewId, tenantOrFounding()],
  );
  return rows as InterviewSource[];
}

export async function addConnectorSources(
  interviewId: string, context: SourceContext, p: Queryable = db(),
): Promise<InterviewSource[]> {
  for (const source of connectorSourceInputs(interviewId, context)) {
    await p.query(
      `insert into interview_sources
        (interview_id, tenant_id, kind, title, source_type, url, status,
         extracted_text, idempotency_key, retrieved_at)
       select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
         from interviews where id = $1 and tenant_id = $2
       on conflict (tenant_id, interview_id, idempotency_key) do update set
         title = excluded.title,
         extracted_text = excluded.extracted_text,
         status = 'ready',
         retrieved_at = excluded.retrieved_at,
         error_code = null`,
      [
        source.interview_id, tenantOrFounding(), source.kind, source.title,
        source.source_type, source.url, source.status, source.extracted_text,
        source.idempotency_key, source.retrieved_at,
      ],
    );
  }
  return listInterviewSources(interviewId, p);
}

export async function countInterviewUploads(
  interviewId: string, p: Queryable = db(),
): Promise<number> {
  const { rows } = await p.query(
    `select count(*)::int as count from interview_sources
      where interview_id = $1 and tenant_id = $2 and kind = 'upload'`,
    [interviewId, tenantOrFounding()],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function createUploadSource(
  interviewId: string,
  input: { title: string; sourceType: string; idempotencyKey: string },
  p: Queryable = db(),
): Promise<InterviewSource> {
  const { rows } = await p.query(
    `insert into interview_sources
      (interview_id, tenant_id, kind, title, source_type, status, idempotency_key)
     select $1,$2,'upload',$3,$4,'reading',$5
       from interviews where id = $1 and tenant_id = $2
     on conflict (tenant_id, interview_id, idempotency_key) do update set
       title = excluded.title
     returning ${SOURCE_COLS}`,
    [interviewId, tenantOrFounding(), input.title, input.sourceType, input.idempotencyKey],
  );
  if (!rows[0]) throw new Error(`interview ${interviewId} not found`);
  return rows[0] as InterviewSource;
}

export async function markSourceReady(
  sourceId: string, extractedText: string, p: Queryable = db(),
): Promise<InterviewSource> {
  const { rows } = await p.query(
    `update interview_sources set status = 'ready', extracted_text = $2,
       retrieved_at = now(), error_code = null
     where id = $1 and tenant_id = $3 returning ${SOURCE_COLS}`,
    [sourceId, extractedText, tenantOrFounding()],
  );
  if (!rows[0]) throw new Error(`source ${sourceId} not found`);
  return rows[0] as InterviewSource;
}

export async function markSourceFailed(
  sourceId: string, errorCode: string, p: Queryable = db(),
): Promise<InterviewSource> {
  const { rows } = await p.query(
    `update interview_sources set status = 'failed', error_code = $2
     where id = $1 and tenant_id = $3 returning ${SOURCE_COLS}`,
    [sourceId, errorCode, tenantOrFounding()],
  );
  if (!rows[0]) throw new Error(`source ${sourceId} not found`);
  return rows[0] as InterviewSource;
}

export async function addWebResearchSources(
  interviewId: string, result: ResearchResult, p: Queryable = db(),
): Promise<InterviewSource[]> {
  for (const citation of result.citations) {
    await p.query(
      `insert into interview_sources
        (interview_id, tenant_id, kind, title, source_type, url, status,
         extracted_text, idempotency_key, retrieved_at)
       select $1,$2,'web',$3,'web',$4,'ready',$5,$6,$7
         from interviews where id = $1 and tenant_id = $2
       on conflict (tenant_id, interview_id, idempotency_key) do update set
         title = excluded.title,
         extracted_text = excluded.extracted_text,
         status = 'ready',
         retrieved_at = excluded.retrieved_at,
         error_code = null`,
      [
        interviewId, tenantOrFounding(), citation.title, citation.url, result.summary,
        sourceIdempotencyKey(interviewId, "web", citation.url), citation.retrieved_at,
      ],
    );
  }
  return listInterviewSources(interviewId, p);
}

export async function replaceInterviewEvidence(
  interviewId: string, evidence: InterviewEvidence[], p: Queryable = db(),
): Promise<void> {
  await p.query(
    "delete from interview_evidence where interview_id = $1 and tenant_id = $2",
    [interviewId, tenantOrFounding()],
  );
  for (const item of evidence) {
    await p.query(
      `insert into interview_evidence
        (interview_id, tenant_id, origin, component, statement, citation)
       values ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        interviewId, tenantOrFounding(), item.origin, item.component, item.statement,
        item.source_title || item.source_url
          ? JSON.stringify({ title: item.source_title, url: item.source_url }) : null,
      ],
    );
  }
}
