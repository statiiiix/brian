import {
  db, tenantOrFounding, withTenantTransaction,
  type Queryable, type TenantTransactionSource,
} from "../db/tenant.js";
import { embed } from "../db/embed.js";
import { toVectorLiteral } from "../db/vector.js";
import { NotFoundError } from "../skills/repo.js";
import type { ContextEntry, ContextStatus, ContextVersion, NewContext } from "./types.js";

const COLUMNS = `id, content, summary, tags, source, status, owner, version, created_at, updated_at`;

function iso(v: Date | null): string | null { return v ? new Date(v).toISOString() : null; }

function rowToContext(r: any): ContextEntry {
  return {
    id: r.id, content: r.content, summary: r.summary, tags: r.tags, source: r.source,
    status: r.status, owner: r.owner, version: r.version,
    created_at: iso(r.created_at)!, updated_at: iso(r.updated_at)!,
  };
}

function embedText(c: Pick<ContextEntry, "summary" | "content">): string {
  return c.summary && c.summary.length > 0 ? c.summary : c.content;
}

export async function createContext(input: NewContext, p: Queryable = db()): Promise<ContextEntry> {
  const vec = toVectorLiteral(await embed(embedText(input)));
  const { rows } = await p.query(
    `insert into context_entries (content, summary, tags, source, status, owner, version, embedding, tenant_id)
     values ($1,$2,$3,$4,'active',$5,1,$6::vector,$7)
     returning ${COLUMNS}`,
    [input.content, input.summary, JSON.stringify(input.tags), input.source, input.owner, vec, tenantOrFounding()]
  );
  return rowToContext(rows[0]);
}

export async function getContext(id: string, p: Queryable = db()): Promise<ContextEntry | null> {
  const { rows } = await p.query(
    `select ${COLUMNS} from context_entries where id = $1 and tenant_id = $2`,
    [id, tenantOrFounding()]
  );
  return rows[0] ? rowToContext(rows[0]) : null;
}

export async function listContext(status?: ContextStatus, p: Queryable = db()): Promise<ContextEntry[]> {
  const tenant = tenantOrFounding();
  const { rows } = status
    ? await p.query(
        `select ${COLUMNS} from context_entries where tenant_id=$1 and status=$2 order by updated_at desc`,
        [tenant, status]
      )
    : await p.query(
        `select ${COLUMNS} from context_entries where tenant_id=$1 order by updated_at desc`,
        [tenant]
      );
  return rows.map(rowToContext);
}

export async function listContextVersions(id: string, p: Queryable = db()): Promise<ContextVersion[]> {
  const { rows } = await p.query(
    `select id, context_id, version, snapshot, changed_by, created_at
     from context_versions where context_id=$1 and tenant_id=$2 order by version desc`,
    [id, tenantOrFounding()]
  );
  return rows.map((r) => ({
    id: r.id, context_id: r.context_id, version: r.version, snapshot: r.snapshot,
    changed_by: r.changed_by, created_at: iso(r.created_at)!,
  }));
}

export async function updateContext(
  id: string, patch: Partial<NewContext>, changedBy: string | null, p?: TenantTransactionSource,
): Promise<ContextEntry> {
  const tenant = tenantOrFounding();
  return withTenantTransaction(async (client) => {
    const { rows: curRows } = await client.query(
      `select ${COLUMNS} from context_entries where id=$1 and tenant_id=$2`, [id, tenant]);
    if (!curRows[0]) throw new NotFoundError(id);
    const cur = rowToContext(curRows[0]);
    await client.query(
      `insert into context_versions (context_id, version, snapshot, changed_by, tenant_id) values ($1,$2,$3,$4,$5)`,
      [id, cur.version, JSON.stringify(cur), changedBy, tenant]);
    const next = { ...cur, ...patch } as ContextEntry;
    const reembed = patch.content !== undefined || patch.summary !== undefined;
    const vec = reembed ? toVectorLiteral(await embed(embedText(next))) : null;
    const { rows } = await client.query(
      `update context_entries set content=$2, summary=$3, tags=$4, source=$5, owner=$6,
         version=version+1, updated_at=now(), embedding = coalesce($7::vector, embedding)
       where id=$1 and tenant_id=$8 returning ${COLUMNS}`,
      [id, next.content, next.summary, JSON.stringify(next.tags), next.source, next.owner, vec, tenant]);
    return rowToContext(rows[0]);
  }, p);
}

export async function retireContext(id: string, p: Queryable = db()): Promise<ContextEntry> {
  const { rows } = await p.query(
    `update context_entries set status='retired', updated_at=now() where id=$1 and tenant_id=$2 returning ${COLUMNS}`,
    [id, tenantOrFounding()]);
  if (!rows[0]) throw new NotFoundError(id);
  return rowToContext(rows[0]);
}

export async function findContextWithDistance(
  query: string, p: Queryable = db()
): Promise<{ entry: ContextEntry; distance: number } | null> {
  const vec = toVectorLiteral(await embed(query));
  const { rows } = await p.query(
    `select ${COLUMNS}, embedding <=> $1::vector as distance
     from context_entries where status='active' and tenant_id=$2
     order by embedding <=> $1::vector limit 1`, [vec, tenantOrFounding()]);
  return rows[0] ? { entry: rowToContext(rows[0]), distance: Number(rows[0].distance) } : null;
}
