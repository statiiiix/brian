import {
  db, tenantOrFounding, withTenantTransaction,
  type Queryable, type TenantTransactionSource,
} from "../db/tenant.js";
import { embed } from "../db/embed.js";
import { toVectorLiteral } from "../db/vector.js";
import { parsePolicyColumn } from "../policy/repo.js";
import { EMPTY_POLICY, type SkillPolicy } from "../policy/types.js";
import { decideMatch, thresholdsFromEnv, type MatchOutcome } from "./matching.js";
import type { NewSkill, Skill, SkillStatus, SkillVersion } from "./types.js";

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`skill not found: ${id}`);
    this.name = "NotFoundError";
  }
}

const SKILL_COLUMNS = `id, name, trigger, inputs, procedure, hard_rules, tools,
  guardrails, escalation_target, examples, principles, quality_checks, sources,
  owner, status, version, policy, supersedes_skill_id,
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
    principles: r.principles ?? [],
    quality_checks: r.quality_checks ?? [],
    sources: r.sources ?? [],
    policy: parsePolicyColumn(r.policy),
    owner: r.owner,
    supersedes_skill_id: r.supersedes_skill_id ?? null,
    status: r.status,
    version: r.version,
    last_reviewed_at: iso(r.last_reviewed_at),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

function embedText(s: Pick<Skill, "name" | "trigger" | "procedure" | "principles">): string {
  return `${s.name}\n${s.trigger}\n${(s.principles ?? []).join("\n")}\n${s.procedure}`;
}

/**
 * A skill with rules but no compile yet. Skills with no rules at all are not
 * pending — there is nothing to enforce, so they must not be blocked.
 */
function pendingPolicyFor(s: Pick<Skill, "hard_rules" | "guardrails">): SkillPolicy {
  const hasRules = [...(s.hard_rules ?? []), ...(s.guardrails ?? [])].some((r) => r.trim());
  return { constraints: [], advisory: [], compiled_at: null, pending: hasRules };
}

/**
 * @param supersedesSkillId when set, the draft is a proposed revision of that
 * skill rather than a new procedure, and activating it applies the draft onto
 * the target (see applyProposal) instead of adding a skill to the corpus.
 */
export async function createSkill(
  input: NewSkill,
  p: Queryable = db(),
  supersedesSkillId: string | null = null,
): Promise<Skill> {
  const tenant = tenantOrFounding();
  const vec = toVectorLiteral(await embed(embedText(input)));
  const { rows } = await p.query(
    `insert into skills
      (name, trigger, inputs, procedure, hard_rules, tools, guardrails,
       escalation_target, examples, principles, quality_checks, sources, owner,
       status, version, embedding, tenant_id, policy, supersedes_skill_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',1,$14::vector,$15,$16::jsonb,$17)
     returning ${SKILL_COLUMNS}`,
    [
      input.name, input.trigger, JSON.stringify(input.inputs), input.procedure,
      JSON.stringify(input.hard_rules), JSON.stringify(input.tools),
      JSON.stringify(input.guardrails), input.escalation_target,
      JSON.stringify(input.examples), JSON.stringify(input.principles ?? []),
      JSON.stringify(input.quality_checks ?? []), JSON.stringify(input.sources ?? []),
      input.owner, vec, tenant, JSON.stringify(pendingPolicyFor(input)),
      supersedesSkillId,
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
  p?: TenantTransactionSource,
): Promise<Skill> {
  const tenant = tenantOrFounding();
  return withTenantTransaction(async (client) => {
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
      patch.name !== undefined || patch.trigger !== undefined || patch.procedure !== undefined
      || patch.principles !== undefined;
    const vec = reembed ? toVectorLiteral(await embed(embedText(next))) : null;

    // Rules that changed invalidate the compiled policy. Enforcing the previous
    // compile after someone edits a limit would enforce the wrong number, so the
    // skill goes back to `pending` until it is recompiled (policy/gate.ts fails
    // closed on pending skills).
    const rulesChanged =
      patch.hard_rules !== undefined || patch.guardrails !== undefined || patch.tools !== undefined;
    const policy = rulesChanged ? pendingPolicyFor(next) : cur.policy ?? EMPTY_POLICY;

    const { rows } = await client.query(
      `update skills set
         name=$2, trigger=$3, inputs=$4, procedure=$5, hard_rules=$6, tools=$7,
         guardrails=$8, escalation_target=$9, examples=$10, owner=$11,
         principles=$12, quality_checks=$13, sources=$14, policy=$17::jsonb,
         version=version+1, updated_at=now(),
         embedding = coalesce($15::vector, embedding)
       where id=$1 and tenant_id=$16
       returning ${SKILL_COLUMNS}`,
      [
        id, next.name, next.trigger, JSON.stringify(next.inputs), next.procedure,
        JSON.stringify(next.hard_rules), JSON.stringify(next.tools),
        JSON.stringify(next.guardrails), next.escalation_target,
        JSON.stringify(next.examples), next.owner,
        JSON.stringify(next.principles ?? []), JSON.stringify(next.quality_checks ?? []),
        JSON.stringify(next.sources ?? []), vec, tenant, JSON.stringify(policy),
      ]
    );
    return rowToSkill(rows[0]);
  }, p);
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

/**
 * The retrieval entry point for agents: nearest active skills, then an explicit
 * match / ambiguous / no-match decision. Unlike findSkill it can decline to
 * answer, which is what makes NO_MATCHING_SKILL reachable.
 */
export async function lookupSkill(
  query: string,
  p: Queryable = db(),
  thresholds = thresholdsFromEnv(),
): Promise<{ outcome: MatchOutcome; skill: Skill | null }> {
  const hits = await findSkillsWithDistance(query, 3, p);
  const outcome = decideMatch(
    hits.map(({ skill, distance }) => ({
      id: skill.id, name: skill.name, trigger: skill.trigger, distance,
    })),
    thresholds,
  );
  const skill = outcome.kind === "match"
    ? hits.find((h) => h.skill.id === outcome.candidate.id)?.skill ?? null
    : null;
  return { outcome, skill };
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

/**
 * Top-k nearest skills of ANY status. Capture routing needs more than the
 * single nearest row: when the match is too loose to apply automatically, the
 * human is offered the several skills the knowledge might belong to.
 *
 * Proposal drafts are excluded — a pending revision is not itself something new
 * knowledge should be folded into.
 */
export async function findSkillsWithDistanceAnyStatus(
  query: string,
  k: number,
  p: Queryable = db()
): Promise<{ skill: Skill; distance: number }[]> {
  const vec = toVectorLiteral(await embed(query));
  const { rows } = await p.query(
    `select ${SKILL_COLUMNS}, embedding <=> $1::vector as distance
     from skills
     where tenant_id = $3 and supersedes_skill_id is null
     order by embedding <=> $1::vector
     limit $2`,
    [vec, k, tenantOrFounding()]
  );
  return rows.map((r) => ({ skill: rowToSkill(r), distance: Number(r.distance) }));
}

/**
 * Apply a proposal draft onto the skill it supersedes: the target takes the
 * draft's content (snapshotting its previous state through the normal version
 * trail), and the draft is retired so it stops appearing as a skill of its own.
 *
 * Returns the updated target. Status is left alone — approving a revision to a
 * live skill must not silently activate one that was retired or still in draft.
 */
export async function applyProposal(
  draftId: string,
  changedBy: string | null,
  p?: TenantTransactionSource,
): Promise<Skill> {
  return withTenantTransaction(async (client) => {
    const draft = await getSkill(draftId, client);
    if (!draft) throw new NotFoundError(draftId);
    if (!draft.supersedes_skill_id) {
      throw new Error(`skill is not a proposal: ${draftId}`);
    }
    const targetId = draft.supersedes_skill_id;
    if (!(await getSkill(targetId, client))) throw new NotFoundError(targetId);

    const target = await updateSkill(targetId, {
      name: draft.name,
      trigger: draft.trigger,
      inputs: draft.inputs,
      procedure: draft.procedure,
      hard_rules: draft.hard_rules,
      tools: draft.tools,
      guardrails: draft.guardrails,
      escalation_target: draft.escalation_target,
      examples: draft.examples,
      owner: draft.owner,
      principles: draft.principles ?? [],
      quality_checks: draft.quality_checks ?? [],
      sources: draft.sources ?? [],
    }, changedBy, client);

    await setStatus(draftId, "retired", client);
    return target;
  }, p);
}
