import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import { listSkills, setStatus } from "../skills/repo.js";
import type { Skill } from "../skills/types.js";

// Skills parked by the graduated-autonomy gate (draft) or staleness
// detection (needs_review).
export async function listReviewable(p: pg.Pool = defaultPool): Promise<Skill[]> {
  const drafts = await listSkills("draft", p);
  const flagged = await listSkills("needs_review", p);
  return [...drafts, ...flagged];
}

export async function approveSkill(id: string, p: pg.Pool = defaultPool): Promise<Skill> {
  return setStatus(id, "active", p);
}

export async function rejectSkill(id: string, p: pg.Pool = defaultPool): Promise<Skill> {
  return setStatus(id, "retired", p);
}

export function formatSkillLine(s: Skill): string {
  return `[${s.status}] ${s.name} (v${s.version}, owner: ${s.owner ?? "unassigned"})  id=${s.id}`;
}
