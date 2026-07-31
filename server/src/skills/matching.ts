// Deciding whether a retrieved skill is actually a match.
//
// Nearest-neighbour search always returns a nearest row. For a search box that
// is fine; for a system that tells an agent "this is the company's approved
// procedure for your task" it is not — the wrong procedure, stated with
// authority, is worse than admitting no procedure exists. The benchmark
// (docs/bench/2026-07-02-retrieval.md) measured 85% top-1 at 120 skills, so
// roughly one in seven answers was previously a confident mis-route.
//
// Two decisions live here, both deterministic and both tunable:
//   - too far away  -> no match, so the agent asks a human
//   - too close to call -> ambiguous, so the agent picks or asks
// Pure: no database, no embeddings.

export interface SkillCandidate {
  id: string;
  name: string;
  trigger: string;
  distance: number;
}

export type MatchOutcome =
  | { kind: "match"; candidate: SkillCandidate; runnerUp: SkillCandidate | null }
  | { kind: "ambiguous"; candidates: SkillCandidate[] }
  | { kind: "no_match"; nearest: SkillCandidate | null };

export interface MatchThresholds {
  /**
   * Cosine distance beyond which the nearest skill is treated as unrelated.
   * Default 0.55 is deliberately permissive — it is meant to catch "nothing in
   * this brain is about your task", not to second-guess close calls. Calibrate
   * per corpus with `npm run bench` before moving it.
   */
  maxDistance: number;
  /**
   * When the runner-up is within this distance of the winner, the two are not
   * meaningfully distinguishable by embedding alone (the bench's residual
   * misses were near-duplicates like three teams' merge-request processes).
   * Guessing here is what produces silent mis-governance.
   */
  ambiguityMargin: number;
}

export function thresholdsFromEnv(env: NodeJS.ProcessEnv = process.env): MatchThresholds {
  return {
    maxDistance: Number(env.SKILL_MATCH_MAX_DISTANCE ?? 0.55),
    ambiguityMargin: Number(env.SKILL_MATCH_AMBIGUITY_MARGIN ?? 0.04),
  };
}

export function decideMatch(
  candidates: SkillCandidate[],
  thresholds: MatchThresholds = thresholdsFromEnv(),
): MatchOutcome {
  const ranked = [...candidates].sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  if (!best) return { kind: "no_match", nearest: null };
  if (best.distance > thresholds.maxDistance) return { kind: "no_match", nearest: best };

  // Only candidates that are themselves plausible can make a match ambiguous.
  const contenders = ranked.filter(
    (c) => c.distance <= thresholds.maxDistance
      && c.distance - best.distance <= thresholds.ambiguityMargin,
  );
  if (contenders.length > 1) return { kind: "ambiguous", candidates: contenders };

  return { kind: "match", candidate: best, runnerUp: ranked[1] ?? null };
}
