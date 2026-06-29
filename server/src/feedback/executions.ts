import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import type { Execution, ExecutionOutcome } from "../skills/types.js";

export interface NewExecution {
  skill_id: string | null;
  skill_version: number | null;
  task_input: unknown;
  actions_taken: unknown;
  outcome: ExecutionOutcome;
  human_override: unknown;
}

function rowToExecution(r: any): Execution {
  return {
    id: r.id,
    skill_id: r.skill_id,
    skill_version: r.skill_version,
    task_input: r.task_input,
    actions_taken: r.actions_taken,
    outcome: r.outcome,
    human_override: r.human_override,
    created_at: new Date(r.created_at).toISOString(),
  };
}

export async function logExecution(row: NewExecution, p: pg.Pool = defaultPool): Promise<Execution> {
  const { rows } = await p.query(
    `insert into executions (skill_id, skill_version, task_input, actions_taken, outcome, human_override)
     values ($1,$2,$3,$4,$5,$6)
     returning id, skill_id, skill_version, task_input, actions_taken, outcome, human_override, created_at`,
    [
      row.skill_id, row.skill_version, JSON.stringify(row.task_input),
      JSON.stringify(row.actions_taken), row.outcome,
      row.human_override === null ? null : JSON.stringify(row.human_override),
    ]
  );
  return rowToExecution(rows[0]);
}

export async function listExecutions(skillId?: string, p: pg.Pool = defaultPool): Promise<Execution[]> {
  const { rows } = skillId
    ? await p.query(
        `select id, skill_id, skill_version, task_input, actions_taken, outcome, human_override, created_at
         from executions where skill_id = $1 order by created_at desc limit 200`, [skillId])
    : await p.query(
        `select id, skill_id, skill_version, task_input, actions_taken, outcome, human_override, created_at
         from executions order by created_at desc limit 200`);
  return rows.map(rowToExecution);
}
