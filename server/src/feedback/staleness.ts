import { db, tenantOrFounding, type Queryable } from "../db/tenant.js";

export async function markStale(
  staleDays = Number(process.env.STALE_DAYS ?? 30),
  p: Queryable = db(),
): Promise<number> {
  const { rowCount } = await p.query(
    `update skills
     set status = 'needs_review', updated_at = now()
     where status = 'active'
       and tenant_id = $2
       and (last_reviewed_at is null or last_reviewed_at < now() - ($1 || ' days')::interval)`,
    [staleDays, tenantOrFounding()]
  );
  return rowCount ?? 0;
}
