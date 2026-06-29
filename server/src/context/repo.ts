import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
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

export async function createContext(input: NewContext, p: pg.Pool = defaultPool): Promise<ContextEntry> {
  const vec = toVectorLiteral(await embed(embedText(input)));
  const { rows } = await p.query(
    `insert into context_entries (content, summary, tags, source, status, owner, version, embedding)
     values ($1,$2,$3,$4,'active',$5,1,$6::vector)
     returning ${COLUMNS}`,
    [input.content, input.summary, JSON.stringify(input.tags), input.source, input.owner, vec]
  );
  return rowToContext(rows[0]);
}

export async function getContext(id: string, p: pg.Pool = defaultPool): Promise<ContextEntry | null> {
  const { rows } = await p.query(`select ${COLUMNS} from context_entries where id = $1`, [id]);
  return rows[0] ? rowToContext(rows[0]) : null;
}

export async function listContext(status?: ContextStatus, p: pg.Pool = defaultPool): Promise<ContextEntry[]> {
  const { rows } = status
    ? await p.query(`select ${COLUMNS} from context_entries where status=$1 order by updated_at desc`, [status])
    : await p.query(`select ${COLUMNS} from context_entries order by updated_at desc`);
  return rows.map(rowToContext);
}

export async function listContextVersions(id: string, p: pg.Pool = defaultPool): Promise<ContextVersion[]> {
  const { rows } = await p.query(
    `select id, context_id, version, snapshot, changed_by, created_at
     from context_versions where context_id=$1 order by version desc`, [id]);
  return rows.map((r) => ({
    id: r.id, context_id: r.context_id, version: r.version, snapshot: r.snapshot,
    changed_by: r.changed_by, created_at: iso(r.created_at)!,
  }));
}

export async function updateContext(
  id: string, patch: Partial<NewContext>, changedBy: string | null, p: pg.Pool = defaultPool
): Promise<ContextEntry> {
  const client = await p.connect();
  try {
    await client.query("begin");
    const { rows: curRows } = await client.query(`select ${COLUMNS} from context_entries where id=$1`, [id]);
    if (!curRows[0]) throw new NotFoundError(id);
    const cur = rowToContext(curRows[0]);
    await client.query(
      `insert into context_versions (context_id, version, snapshot, changed_by) values ($1,$2,$3,$4)`,
      [id, cur.version, JSON.stringify(cur), changedBy]);
    const next = { ...cur, ...patch } as ContextEntry;
    const reembed = patch.content !== undefined || patch.summary !== undefined;
    const vec = reembed ? toVectorLiteral(await embed(embedText(next))) : null;
    const { rows } = await client.query(
      `update context_entries set content=$2, summary=$3, tags=$4, source=$5, owner=$6,
         version=version+1, updated_at=now(), embedding = coalesce($7::vector, embedding)
       where id=$1 returning ${COLUMNS}`,
      [id, next.content, next.summary, JSON.stringify(next.tags), next.source, next.owner, vec]);
    await client.query("commit");
    return rowToContext(rows[0]);
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function retireContext(id: string, p: pg.Pool = defaultPool): Promise<ContextEntry> {
  const { rows } = await p.query(
    `update context_entries set status='retired', updated_at=now() where id=$1 returning ${COLUMNS}`, [id]);
  if (!rows[0]) throw new NotFoundError(id);
  return rowToContext(rows[0]);
}

export async function findContextWithDistance(
  query: string, p: pg.Pool = defaultPool
): Promise<{ entry: ContextEntry; distance: number } | null> {
  const vec = toVectorLiteral(await embed(query));
  const { rows } = await p.query(
    `select ${COLUMNS}, embedding <=> $1::vector as distance
     from context_entries where status='active'
     order by embedding <=> $1::vector limit 1`, [vec]);
  return rows[0] ? { entry: rowToContext(rows[0]), distance: Number(rows[0].distance) } : null;
}
