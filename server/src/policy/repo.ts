// Persistence for enforcement: session state and the decision audit trail.
//
// The MCP HTTP transport is stateless (a fresh server per request, see
// mcp/http.ts), so "which skill is governing this agent right now" and "what
// has it looked up" cannot live in memory. They live here, scoped to a session
// key derived from the agent connection.

import {
  currentConnectionId, currentUserId, db, tenantOrFounding, type Queryable,
} from "../db/tenant.js";
import type { PolicyConstraintSet, PolicyDecision, SkillPolicy } from "./types.js";
import { EMPTY_POLICY } from "./types.js";

/** How long a consultation or fact stays valid. Long enough for a real task, short enough that stale context cannot authorise a later action. */
export const SESSION_TTL_MINUTES = Number(process.env.POLICY_SESSION_TTL_MINUTES ?? 60);

/**
 * Identifies one agent session. Prefers the connection (one per client grant),
 * falls back to the user, then to a single system lane for local stdio use.
 */
export function sessionKey(): string {
  return currentConnectionId() ?? currentUserId() ?? "system";
}

export function parsePolicyColumn(value: unknown): SkillPolicy {
  if (!value || typeof value !== "object") return EMPTY_POLICY;
  const row = value as Partial<SkillPolicy>;
  return {
    constraints: Array.isArray(row.constraints) ? row.constraints : [],
    advisory: Array.isArray(row.advisory) ? row.advisory : [],
    compiled_at: typeof row.compiled_at === "string" ? row.compiled_at : null,
    pending: row.pending === true,
  };
}

/** Store a compiled policy. Called after a skill's rules are written or edited. */
export async function setSkillPolicy(
  skillId: string, policy: SkillPolicy, p: Queryable = db()
): Promise<void> {
  await p.query(
    `update skills set policy = $2::jsonb where id = $1 and tenant_id = $3`,
    [skillId, JSON.stringify(policy), tenantOrFounding()]
  );
}

/** Skills whose rules still need compiling — the dashboard surfaces these. */
export async function listPendingPolicySkills(p: Queryable = db()): Promise<{ id: string; name: string }[]> {
  const { rows } = await p.query(
    `select id, name from skills
      where tenant_id = $1 and (policy->>'pending')::boolean is true
      order by updated_at desc`,
    [tenantOrFounding()]
  );
  return rows as { id: string; name: string }[];
}

/** Remember that the agent consulted this skill; it now governs its actions. */
export async function recordConsultation(skillId: string, p: Queryable = db()): Promise<void> {
  await p.query(
    `insert into agent_session_state (tenant_id, session_key, kind, ref, value)
     values ($1, $2, 'skill', $3, '{}'::jsonb)
     on conflict (tenant_id, session_key, kind, ref)
     do update set created_at = now()`,
    [tenantOrFounding(), sessionKey(), skillId]
  );
}

/** Remember what a safe lookup established, so rules about it can be checked. */
export async function recordFact(
  subject: string, value: unknown, p: Queryable = db()
): Promise<void> {
  await p.query(
    `insert into agent_session_state (tenant_id, session_key, kind, ref, value)
     values ($1, $2, 'fact', $3, $4::jsonb)
     on conflict (tenant_id, session_key, kind, ref)
     do update set value = excluded.value, created_at = now()`,
    [tenantOrFounding(), sessionKey(), subject, JSON.stringify(value ?? null)]
  );
}

/** The compiled policies of every skill consulted in this session. */
export async function loadGoverningPolicies(p: Queryable = db()): Promise<PolicyConstraintSet[]> {
  const { rows } = await p.query(
    `select s.id, s.name, s.policy, s.escalation_target
       from agent_session_state a
       join skills s on s.id = a.ref::uuid and s.tenant_id = a.tenant_id
      where a.tenant_id = $1 and a.session_key = $2 and a.kind = 'skill'
        and a.created_at > now() - ($3 || ' minutes')::interval
      order by a.created_at desc`,
    [tenantOrFounding(), sessionKey(), SESSION_TTL_MINUTES]
  );
  return rows.map((r: any) => ({
    skill_id: r.id,
    skill_name: r.name,
    escalation_target: r.escalation_target,
    policy: parsePolicyColumn(r.policy),
  }));
}

/** Facts established this session, shaped for constraint field paths. */
export async function loadFacts(p: Queryable = db()): Promise<Record<string, unknown>> {
  const { rows } = await p.query(
    `select ref, value from agent_session_state
      where tenant_id = $1 and session_key = $2 and kind = 'fact'
        and created_at > now() - ($3 || ' minutes')::interval`,
    [tenantOrFounding(), sessionKey(), SESSION_TTL_MINUTES]
  );
  return Object.fromEntries(rows.map((r: any) => [r.ref, r.value]));
}

export interface DecisionRecord {
  tool: string;
  args: Record<string, unknown>;
  decision: PolicyDecision;
  skillIds: (string | null)[];
}

/** Write the decision to the audit trail. Never throws into the tool path. */
export async function recordDecision(
  record: DecisionRecord, p: Queryable = db()
): Promise<void> {
  await p.query(
    `insert into policy_decisions
      (tenant_id, session_key, connection_id, actor_user_id, tool, decision,
       args, skill_ids, violations, evaluated)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10)`,
    [
      tenantOrFounding(), sessionKey(), currentConnectionId(), currentUserId(),
      record.tool, record.decision.decision,
      JSON.stringify(record.args ?? {}),
      JSON.stringify(record.skillIds.filter(Boolean)),
      JSON.stringify(record.decision.violations),
      record.decision.evaluated,
    ]
  );
}

export async function listDecisions(limit = 200, p: Queryable = db()): Promise<unknown[]> {
  const { rows } = await p.query(
    `select id, tool, decision, args, skill_ids, violations, evaluated, created_at
       from policy_decisions where tenant_id = $1
      order by created_at desc limit $2`,
    [tenantOrFounding(), limit]
  );
  return rows;
}

/** Retention: session state is working memory, not history. */
export async function pruneSessionState(p: Queryable = db()): Promise<number> {
  const { rowCount } = await p.query(
    `delete from agent_session_state
      where created_at < now() - ($1 || ' minutes')::interval`,
    [SESSION_TTL_MINUTES * 24]
  );
  return rowCount ?? 0;
}
