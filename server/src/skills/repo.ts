import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
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

export async function createSkill(input: NewSkill, p: pg.Pool = defaultPool): Promise<Skill> {
  const vec = toVectorLiteral(await embed(embedText(input)));
  const { rows } = await p.query(
    `insert into skills
      (name, trigger, inputs, procedure, hard_rules, tools, guardrails,
       escalation_target, examples, owner, status, version, embedding)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',1,$11::vector)
     returning ${SKILL_COLUMNS}`,
    [
      input.name, input.trigger, JSON.stringify(input.inputs), input.procedure,
      JSON.stringify(input.hard_rules), JSON.stringify(input.tools),
      JSON.stringify(input.guardrails), input.escalation_target,
      JSON.stringify(input.examples), input.owner, vec,
    ]
  );
  return rowToSkill(rows[0]);
}

export async function getSkill(id: string, p: pg.Pool = defaultPool): Promise<Skill | null> {
  const { rows } = await p.query(`select ${SKILL_COLUMNS} from skills where id = $1`, [id]);
  return rows[0] ? rowToSkill(rows[0]) : null;
}

export async function listSkills(status?: SkillStatus, p: pg.Pool = defaultPool): Promise<Skill[]> {
  const { rows } = status
    ? await p.query(`select ${SKILL_COLUMNS} from skills where status = $1 order by updated_at desc`, [status])
    : await p.query(`select ${SKILL_COLUMNS} from skills order by updated_at desc`);
  return rows.map(rowToSkill);
}

export async function listVersions(id: string, p: pg.Pool = defaultPool): Promise<SkillVersion[]> {
  const { rows } = await p.query(
    `select id, skill_id, version, snapshot, changed_by, created_at
     from skill_versions where skill_id = $1 order by version desc`,
    [id]
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
  const client = await p.connect();
  try {
    await client.query("begin");
    const { rows: curRows } = await client.query(`select ${SKILL_COLUMNS} from skills where id = $1`, [id]);
    if (!curRows[0]) throw new NotFoundError(id);
    const cur = rowToSkill(curRows[0]);

    // snapshot the current state before changing it
    await client.query(
      `insert into skill_versions (skill_id, version, snapshot, changed_by)
       values ($1,$2,$3,$4)`,
      [id, cur.version, JSON.stringify(cur), changedBy]
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
       where id=$1
       returning ${SKILL_COLUMNS}`,
      [
        id, next.name, next.trigger, JSON.stringify(next.inputs), next.procedure,
        JSON.stringify(next.hard_rules), JSON.stringify(next.tools),
        JSON.stringify(next.guardrails), next.escalation_target,
        JSON.stringify(next.examples), next.owner, vec,
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
  p: pg.Pool = defaultPool
): Promise<Skill> {
  const { rows } = await p.query(
    `update skills set status=$2,
       last_reviewed_at = case when $2 = 'active' then now() else last_reviewed_at end,
       updated_at = now()
     where id=$1 returning ${SKILL_COLUMNS}`,
    [id, status]
  );
  if (!rows[0]) throw new NotFoundError(id);
  return rowToSkill(rows[0]);
}

export async function findSkill(query: string, p: pg.Pool = defaultPool): Promise<Skill | null> {
  const vec = toVectorLiteral(await embed(query));
  const { rows } = await p.query(
    `select ${SKILL_COLUMNS}
     from skills
     where status = 'active'
     order by embedding <=> $1::vector
     limit 1`,
    [vec]
  );
  return rows[0] ? rowToSkill(rows[0]) : null;
}

// Nearest skill of ANY status (so capture can match and revise drafts too),
// returning the cosine distance for dedup/routing decisions.
export async function findSkillWithDistance(
  query: string,
  p: pg.Pool = defaultPool
): Promise<{ skill: Skill; distance: number } | null> {
  const vec = toVectorLiteral(await embed(query));
  const { rows } = await p.query(
    `select ${SKILL_COLUMNS}, embedding <=> $1::vector as distance
     from skills order by embedding <=> $1::vector limit 1`,
    [vec]
  );
  return rows[0] ? { skill: rowToSkill(rows[0]), distance: Number(rows[0].distance) } : null;
}
