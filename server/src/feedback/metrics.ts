// The feedback loop, read back.
//
// Executions and policy decisions were both write-only: rows accumulated and
// nothing ever read them, so "the brain gets better" had no evidence behind it.
// These aggregates are what the dashboard shows and what a weekly review acts
// on — which skills escalate, which get blocked, which have gone quiet.

import { db, tenantOrFounding, type Queryable } from "../db/tenant.js";

export interface OutcomeCounts {
  completed: number;
  escalated: number;
  failed: number;
}

export interface WeekPoint {
  week: string;
  completed: number;
  escalated: number;
  failed: number;
  denied: number;
}

export interface SkillHealth {
  skill_id: string;
  name: string;
  status: string;
  runs: number;
  escalated: number;
  failed: number;
  denied: number;
  enforced_rules: number;
  advisory_rules: number;
  policy_pending: boolean;
  last_run_at: string | null;
}

export interface BrainMetrics {
  outcomes: OutcomeCounts;
  totalRuns: number;
  /** Share of runs that ended in escalation rather than completion. */
  escalationRate: number;
  /** Actions the enforcement gate refused outright. */
  blockedActions: number;
  /** Of all governed attempts, the share Brian refused. */
  blockRate: number;
  weeks: WeekPoint[];
  skills: SkillHealth[];
  /** Rules written but not yet compiled into anything enforceable. */
  unenforcedSkills: number;
}

/** Pure: share of runs that escalated, guarding the empty case. */
export function rate(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 1000) / 1000;
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function brainMetrics(weeks = 8, p: Queryable = db()): Promise<BrainMetrics> {
  const tenant = tenantOrFounding();

  const [outcomeRows, weekRows, denyRows, skillRows] = await Promise.all([
    p.query(
      `select outcome, count(*)::int as n from executions
        where tenant_id = $1 group by outcome`, [tenant]),
    p.query(
      `select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week,
              outcome, count(*)::int as n
         from executions
        where tenant_id = $1 and created_at > now() - ($2 || ' weeks')::interval
        group by 1, 2`, [tenant, weeks]),
    p.query(
      `select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week,
              decision, count(*)::int as n
         from policy_decisions
        where tenant_id = $1 and created_at > now() - ($2 || ' weeks')::interval
        group by 1, 2`, [tenant, weeks]),
    p.query(
      `select s.id as skill_id, s.name, s.status,
              coalesce(jsonb_array_length(s.policy->'constraints'), 0)::int as enforced_rules,
              coalesce(jsonb_array_length(s.policy->'advisory'), 0)::int as advisory_rules,
              coalesce((s.policy->>'pending')::boolean, false) as policy_pending,
              count(e.id)::int as runs,
              count(e.id) filter (where e.outcome = 'escalated')::int as escalated,
              count(e.id) filter (where e.outcome = 'failed')::int as failed,
              max(e.created_at) as last_run_at,
              (select count(*)::int from policy_decisions d
                where d.tenant_id = s.tenant_id and d.decision = 'deny'
                  and d.skill_ids @> to_jsonb(s.id::text)) as denied
         from skills s
         left join executions e on e.skill_id = s.id and e.tenant_id = s.tenant_id
        where s.tenant_id = $1 and s.status <> 'retired'
        group by s.id, s.name, s.status, s.policy, s.tenant_id
        order by runs desc, s.name asc`, [tenant]),
  ]);

  const outcomes: OutcomeCounts = { completed: 0, escalated: 0, failed: 0 };
  for (const row of outcomeRows.rows as { outcome: keyof OutcomeCounts | null; n: number }[]) {
    if (row.outcome && row.outcome in outcomes) outcomes[row.outcome] = num(row.n);
  }

  const byWeek = new Map<string, WeekPoint>();
  const point = (week: string): WeekPoint => {
    const existing = byWeek.get(week);
    if (existing) return existing;
    const fresh: WeekPoint = { week, completed: 0, escalated: 0, failed: 0, denied: 0 };
    byWeek.set(week, fresh);
    return fresh;
  };
  for (const row of weekRows.rows as { week: string; outcome: keyof OutcomeCounts | null; n: number }[]) {
    if (row.outcome && row.outcome in outcomes) point(row.week)[row.outcome] = num(row.n);
  }
  let blockedActions = 0;
  let governedAttempts = 0;
  for (const row of denyRows.rows as { week: string; decision: string; n: number }[]) {
    governedAttempts += num(row.n);
    if (row.decision === "deny") {
      point(row.week).denied = num(row.n);
      blockedActions += num(row.n);
    }
  }

  const totalRuns = outcomes.completed + outcomes.escalated + outcomes.failed;
  const skills = (skillRows.rows as Record<string, unknown>[]).map((r) => ({
    skill_id: String(r.skill_id),
    name: String(r.name),
    status: String(r.status),
    runs: num(r.runs),
    escalated: num(r.escalated),
    failed: num(r.failed),
    denied: num(r.denied),
    enforced_rules: num(r.enforced_rules),
    advisory_rules: num(r.advisory_rules),
    policy_pending: r.policy_pending === true,
    last_run_at: r.last_run_at ? new Date(r.last_run_at as string).toISOString() : null,
  }));

  return {
    outcomes,
    totalRuns,
    escalationRate: rate(outcomes.escalated, totalRuns),
    blockedActions,
    blockRate: rate(blockedActions, governedAttempts),
    weeks: [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week)),
    skills,
    unenforcedSkills: skills.filter((s) => s.policy_pending).length,
  };
}

/**
 * Skills that need a human: they escalate or get blocked often, or they have
 * rules that are not enforceable. This is the queue that turns the execution
 * log into revisions rather than an archive.
 */
export function needsAttention(metrics: BrainMetrics): SkillHealth[] {
  return metrics.skills
    .filter((s) =>
      s.policy_pending
      || s.denied > 0
      || s.failed > 0
      || (s.runs >= 3 && rate(s.escalated, s.runs) >= 0.3))
    .sort((a, b) => (b.denied + b.failed + b.escalated) - (a.denied + a.failed + a.escalated));
}
