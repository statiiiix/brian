import { draftFromText } from "../ingestion/draftFromText.js";
import { createContext } from "../context/repo.js";
import { parseNewContext } from "../context/validation.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import { unpromotedEvidence, nearbyUnpromotedEvidence, markPromoted } from "./repo.js";

// One email is not an SOP: only draft a skill once ≥K independent pieces of
// evidence describe the same process. Context is low-risk (v2 graduated
// autonomy) — a single confident piece drafts directly.
const K = Number(process.env.CONNECTORS_CLUSTER_K ?? 3);
const TAU = Number(process.env.CONNECTORS_CLUSTER_TAU ?? 0.15);
const CONTEXT_MIN = Number(process.env.CONNECTORS_CONTEXT_MIN ?? 0.7);

export async function aggregate(llm: LlmClient = defaultLlm()): Promise<{ skills: number; contexts: number }> {
  let skills = 0;
  let contexts = 0;

  // Skill evidence: greedy clustering by embedding similarity.
  const promoted = new Set<string>();
  for (const seed of await unpromotedEvidence("skill_evidence")) {
    if (promoted.has(seed.id)) continue;
    const cluster = (await nearbyUnpromotedEvidence(seed.id, "skill_evidence", TAU))
      .filter((e) => !promoted.has(e.id));
    if (cluster.length < K) continue;

    const skill = await draftFromText(cluster.map((e) => e.summary).join("\n\n"), llm);
    const ids = cluster.map((e) => e.id);
    await markPromoted(ids, "skill", skill.id);
    ids.forEach((id) => promoted.add(id));
    skills++;
  }

  // Context evidence: a single confident piece drafts directly.
  for (const e of await unpromotedEvidence("context_evidence")) {
    if (e.confidence < CONTEXT_MIN) continue;
    const created = await createContext(
      parseNewContext({ content: e.summary, summary: e.summary, tags: ["connector"], source: "connector", owner: null }),
    );
    await markPromoted([e.id], "context", created.id);
    contexts++;
  }

  return { skills, contexts };
}
