import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import { db, tenantOrFounding, type Queryable } from "../db/tenant.js";
import { embed } from "../db/embed.js";
import { toVectorLiteral } from "../db/vector.js";
import type { NewSkill, Skill, SkillStatus, SkillVersion } from "./types.js";

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`skill not found: ${id}`);
    this.name = "NotFoundError";
  }
}

const SKILL_COLUMNS = `id, name, trigger, inputs, procedure, hard_rules, tools,
  guardrails, escalation_target, examples, owner, status, version,
  last_reviewed_at, created_at, updated_at`;

function iso(v: Date | null): string | null {
  return v ? new Date(v).toISOString() : null;
}

function rowToSkill(r: any): Skill {
  return {
    id: r.id,
    name: r.name,
    trigger: r.trigger,
    inputs: r.inputs,
    procedure: r.procedure,
    hard_rules: r.hard_rules,
    tools: r.tools,
    guardrails: r.guardrails,
    escalation_target: r.escalation_target,
    examples: r.examples,
    owner: r.owner,
    status: r.status,
    version: r.version,
    last_reviewed_at: iso(r.last_reviewed_at),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

function embedText(s: Pick<Skill, "name" | "trigger" | "procedure">): string {
  return `${s.name}\n${s.trigger}\n${s.procedure}`;
}

export async function createSkill(input: NewSkill, p: Queryable = db()): Promise<Skill> {
  const tenant = tenantOrFounding();
  const vec = toVectorLiteral(await embed(embedText(input)));
  const { rows } = await p.query(
    `insert into skills
      (name, trigger, inputs, procedure, hard_rules, tools, guardrails,
       escalation_target, examples, owner, status, version, embedding, tenant_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',1,$11::vector,$12)
     returning ${SKILL_COLUMNS}`,
    [
      input.name, input.trigger, JSON.stringify(input.inputs), input.procedure,
      JSON.stringify(input.hard_rules), JSON.stringify(input.tools),
      JSON.stringify(input.guardrails), input.escalation_target,
      JSON.stringify(input.examples), input.owner, vec, tenant,
    ]
  );
  return rowToSkill(rows[0]);
}

export async function getSkill(id: string, p: Queryable = db()): Promise<Skill | null> {
  const { rows } = await p.query(
    `select ${SKILL_COLUMNS} from skills where id = $1 and tenant_id = $2`,
    [id, tenantOrFounding()]
  );
  return rows[0] ? rowToSkill(rows[0]) : null;
}

export async function listSkills(status?: SkillStatus, p: Queryable = db()): Promise<Skill[]> {
  const tenant = tenantOrFounding();
  const { rows } = status
    ? await p.query(
        `select ${SKILL_COLUMNS} from skills where tenant_id = $1 and status = $2 order by updated_at desc`,
        [tenant, status]
      )
    : await p.query(
        `select ${SKILL_COLUMNS} from skills where tenant_id = $1 order by updated_at desc`,
        [tenant]
      );
  return rows.map(rowToSkill);
}

export async function listVersions(id: string, p: Queryable = db()): Promise<SkillVersion[]> {
  const { rows } = await p.query(
    `select id, skill_id, version, snapshot, changed_by, created_at
     from skill_versions where skill_id = $1 and tenant_id = $2 order by version desc`,
    [id, tenantOrFounding()]
  );
  return rows.map((r) => ({
    id: r.id, skill_id: r.skill_id, version: r.version,
    snapshot: r.snapshot, changed_by: r.changed_by, created_at: iso(r.created_at)!,
  }));
}

export async function updateSkill(
  id: string,
  patch: Partial<NewSkill>,
  changedBy: string | null,
  p: pg.Pool = defaultPool
): Promise<Skill> {
  const tenant = tenantOrFounding();
  const client = await p.connect();
  try {
    await client.query("begin");
    // RLS backstop: bind the tenant for this transaction (tenant_isolation, 007).
    await client.query("select set_config('app.tenant_id', $1, true)", [tenant]);
    const { rows: curRows } = await client.query(
      `select ${SKILL_COLUMNS} from skills where id = $1 and tenant_id = $2`,
      [id, tenant]
    );
    if (!curRows[0]) throw new NotFoundError(id);
    const cur = rowToSkill(curRows[0]);

    // snapshot the current state before changing it
    await client.query(
      `insert into skill_versions (skill_id, version, snapshot, changed_by, tenant_id)
       values ($1,$2,$3,$4,$5)`,
      [id, cur.version, JSON.stringify(cur), changedBy, tenant]
    );

    const next = { ...cur, ...patch } as Skill;
    const reembed =
      patch.name !== undefined || patch.trigger !== undefined || patch.procedure !== undefined;
    const vec = reembed ? toVectorLiteral(await embed(embedText(next))) : null;

    const { rows } = await client.query(
      `update skills set
         name=$2, trigger=$3, inputs=$4, procedure=$5, hard_rules=$6, tools=$7,
         guardrails=$8, escalation_target=$9, examples=$10, owner=$11,
         version=version+1, updated_at=now(),
         embedding = coalesce($12::vector, embedding)
       where id=$1 and tenant_id=$13
       returning ${SKILL_COLUMNS}`,
      [
        id, next.name, next.trigger, JSON.stringify(next.inputs), next.procedure,
        JSON.stringify(next.hard_rules), JSON.stringify(next.tools),
        JSON.stringify(next.guardrails), next.escalation_target,
        JSON.stringify(next.examples), next.owner, vec, tenant,
      ]
    );
    await client.query("commit");
    return rowToSkill(rows[0]);
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function setStatus(
  id: string,
  status: SkillStatus,
  p: Queryable = db()
): Promise<Skill> {
  const { rows } = await p.query(
    `update skills set status=$2,
       last_reviewed_at = case when $2 = 'active' then now() else last_reviewed_at end,
       updated_at = now()
     where id=$1 and tenant_id=$3 returning ${SKILL_COLUMNS}`,
    [id, status, tenantOrFounding()]
  );
  if (!rows[0]) throw new NotFoundError(id);
  return rowToSkill(rows[0]);
}

export async function findSkill(query: string, p: Queryable = db()): Promise<Skill | null> {
  const vec = toVectorLiteral(await embed(query));
  const { rows } = await p.query(
    `select ${SKILL_COLUMNS}
     from skills
     where status = 'active' and tenant_id = $2
     order by embedding <=> $1::vector
     limit 1`,
    [vec, tenantOrFounding()]
  );
  return rows[0] ? rowToSkill(rows[0]) : null;
}

// Top-k ACTIVE skills nearest-first with cosine distances, for retrieval
// diagnostics and multi-skill guidance.
export async function findSkillsWithDistance(
  query: string,
  k: number,
  p: Queryable = db()
): Promise<{ skill: Skill; distance: number }[]> {
  const vec = toVectorLiteral(await embed(query));
  const { rows } = await p.query(
    `select ${SKILL_COLUMNS}, embedding <=> $1::vector as distance
     from skills
     where status = 'active' and tenant_id = $3
     order by embedding <=> $1::vector
     limit $2`,
    [vec, k, tenantOrFounding()]
  );
  return rows.map((r) => ({ skill: rowToSkill(r), distance: Number(r.distance) }));
}

// Nearest skill of ANY status (so capture can match and revise drafts too),
// returning the cosine distance for dedup/routing decisions.
export async function findSkillWithDistance(
  query: string,
  p: Queryable = db()
): Promise<{ skill: Skill; distance: number } | null> {
  const vec = toVectorLiteral(await embed(query));
  const { rows } = await p.query(
    `select ${SKILL_COLUMNS}, embedding <=> $1::vector as distance
     from skills where tenant_id = $2 order by embedding <=> $1::vector limit 1`,
    [vec, tenantOrFounding()]
  );
  return rows[0] ? { skill: rowToSkill(rows[0]), distance: Number(rows[0].distance) } : null;
}
