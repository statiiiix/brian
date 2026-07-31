// Compile-and-store: the one entry point the API and interview paths call
// after a skill's rules are written, so `pending` never outlives a save.

import { db, type Queryable } from "../db/tenant.js";
import type { LlmClient } from "../llm/complete.js";
import { getSkill } from "../skills/repo.js";
import { compilePolicy } from "./compile.js";
import { setSkillPolicy } from "./repo.js";
import { EMPTY_POLICY, type SkillPolicy } from "./types.js";

/**
 * Compile a skill's hard rules and store the result. Returns the stored policy.
 * Never throws into a save path: if compilation fails the skill stays `pending`,
 * which the gate treats as "cannot authorise actions" — the safe direction.
 */
export async function compileAndStoreSkillPolicy(
  skillId: string,
  llm?: LlmClient,
  p: Queryable = db(),
): Promise<SkillPolicy> {
  const skill = await getSkill(skillId, p);
  if (!skill) return EMPTY_POLICY;

  const hasRules = [...skill.hard_rules, ...skill.guardrails].some((r) => r.trim());
  if (!hasRules) {
    const empty = { ...EMPTY_POLICY, compiled_at: new Date().toISOString() };
    await setSkillPolicy(skillId, empty, p);
    return empty;
  }

  try {
    const policy = await compilePolicy(
      {
        name: skill.name,
        hard_rules: skill.hard_rules,
        guardrails: skill.guardrails,
        tools: skill.tools,
      },
      llm,
    );
    const stored: SkillPolicy = { ...policy, pending: false };
    await setSkillPolicy(skillId, stored, p);
    return stored;
  } catch (error) {
    console.error("policy: compile failed; skill stays unenforced", { skillId, error });
    return { ...EMPTY_POLICY, pending: true };
  }
}
