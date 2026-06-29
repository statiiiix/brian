import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";

export async function markStale(
  staleDays = Number(process.env.STALE_DAYS ?? 30),
  p: pg.Pool = defaultPool
): Promise<number> {
  const { rowCount } = await p.query(
    `update skills
     set status = 'needs_review', updated_at = now()
     where status = 'active'
       and (last_reviewed_at is null or last_reviewed_at < now() - ($1 || ' days')::interval)`,
    [staleDays]
  );
  return rowCount ?? 0;
}
