import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import { NotFoundError } from "../skills/repo.js";
import type { NewSkill } from "../skills/types.js";
import { EMPTY_COVERAGE, type Coverage, type Interview, type InterviewMessage } from "./types.js";

const COLS = `id, topic, owner, status, messages, coverage, draft,
  resulting_skill_id, created_by, created_at, updated_at`;

function hydrate(row: Record<string, unknown>): Interview {
  const iv = row as unknown as Interview;
  return { ...iv, coverage: { ...EMPTY_COVERAGE, ...(iv.coverage ?? {}) } };
}

export async function createInterview(
  input: { topic: string; owner?: string | null; created_by?: string | null },
  p: pg.Pool = defaultPool
): Promise<Interview> {
  const { rows } = await p.query(
    `insert into interviews (topic, owner, created_by) values ($1,$2,$3) returning ${COLS}`,
    [input.topic, input.owner ?? null, input.created_by ?? null]
  );
  return hydrate(rows[0]);
}

export async function getInterview(id: string, p: pg.Pool = defaultPool): Promise<Interview | null> {
  const { rows } = await p.query(`select ${COLS} from interviews where id = $1`, [id]);
  return rows[0] ? hydrate(rows[0]) : null;
}

export async function listInterviews(p: pg.Pool = defaultPool): Promise<Interview[]> {
  const { rows } = await p.query(`select ${COLS} from interviews order by created_at desc`);
  return rows.map(hydrate);
}

async function mustGet(id: string, p: pg.Pool): Promise<void> {
  const { rowCount } = await p.query("select 1 from interviews where id = $1", [id]);
  if (!rowCount) throw new NotFoundError(`interview ${id} not found`);
}

export async function appendMessage(
  id: string, msg: { role: InterviewMessage["role"]; content: string }, p: pg.Pool = defaultPool
): Promise<Interview> {
  await mustGet(id, p);
  const entry: InterviewMessage = { ...msg, at: new Date().toISOString() };
  const { rows } = await p.query(
    `update interviews set messages = messages || $2::jsonb, updated_at = now()
     where id = $1 returning ${COLS}`,
    [id, JSON.stringify([entry])]
  );
  return hydrate(rows[0]);
}

export async function setTurnResult(
  id: string, result: { coverage: Coverage; draft?: NewSkill }, p: pg.Pool = defaultPool
): Promise<Interview> {
  await mustGet(id, p);
  const { rows } = await p.query(
    `update interviews set coverage = $2::jsonb,
       draft = coalesce($3::jsonb, draft),
       status = case when $3::jsonb is not null then 'ready' else status end,
       updated_at = now()
     where id = $1 returning ${COLS}`,
    [id, JSON.stringify(result.coverage), result.draft ? JSON.stringify(result.draft) : null]
  );
  return hydrate(rows[0]);
}

export async function completeInterview(
  id: string, skillId: string, p: pg.Pool = defaultPool
): Promise<Interview> {
  await mustGet(id, p);
  const { rows } = await p.query(
    `update interviews set status = 'completed', resulting_skill_id = $2, updated_at = now()
     where id = $1 returning ${COLS}`, [id, skillId]);
  return hydrate(rows[0]);
}

export async function abandonInterview(id: string, p: pg.Pool = defaultPool): Promise<Interview> {
  await mustGet(id, p);
  const { rows } = await p.query(
    `update interviews set status = 'abandoned', updated_at = now()
     where id = $1 returning ${COLS}`, [id]);
  return hydrate(rows[0]);
}
