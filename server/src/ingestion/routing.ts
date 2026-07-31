// Deciding, at capture time, whether new knowledge revises a skill the brain
// already has or introduces a new one.
//
// This is the mirror image of skills/matching.ts. There the failure is routing
// an agent to the wrong procedure; here it is quietly forking one. Dedup runs
// at a deliberately tight distance (0.2), so a genuine restatement of an
// existing process that lands slightly outside it becomes a second, nearly
// identical skill — and near-duplicate procedures are exactly what produced the
// residual mis-routes in the retrieval bench (docs/bench/2026-07-02-retrieval.md).
// Loosening the dedup threshold would only trade silent forks for silent
// overwrites, so the band between "certainly the same" and "certainly new" is
// handed to a human instead.
//
// Pure: no database, no embeddings.

import type { SkillStatus } from "../skills/types.js";

export interface CaptureCandidate {
  id: string;
  name: string;
  trigger: string;
  status: SkillStatus;
  distance: number;
}

export type CaptureRoute =
  /** Close enough to be the same knowledge: revise it without asking. */
  | { kind: "merge"; target: CaptureCandidate }
  /** Plausibly a revision of something we already know. Only a human can say. */
  | { kind: "ask"; candidates: CaptureCandidate[] }
  /** Nothing close enough to be worth offering as a merge target. */
  | { kind: "create" };

export interface CaptureThresholds {
  /**
   * Cosine distance within which a capture is treated as the same knowledge as
   * the skill it matched, and merged with no human in the loop.
   */
  simMax: number;
  /**
   * Outer edge of the grey zone. Past this the nearest skill is unrelated
   * enough that offering it as a merge target is noise, so the capture becomes
   * a new skill as before. Kept below skills/matching.ts's retrieval
   * maxDistance (0.55): a skill too far to route to is also too far to revise.
   */
  askMax: number;
  /** How many merge targets to put in front of the human at once. */
  maxCandidates: number;
}

export function captureThresholdsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CaptureThresholds {
  return {
    simMax: Number(env.CAPTURE_SIM_MAX ?? 0.2),
    askMax: Number(env.CAPTURE_ASK_MAX ?? 0.45),
    maxCandidates: Number(env.CAPTURE_ASK_CANDIDATES ?? 3),
  };
}

/**
 * Retired skills are never merge targets. Folding new knowledge into a retired
 * procedure would resurrect a process the company deliberately stopped running,
 * and a proposal to revise something nobody can execute is noise in the review
 * queue. They are dropped before routing, so a capture whose nearest neighbour
 * is retired is treated as new knowledge.
 */
export function routeCapture(
  candidates: CaptureCandidate[],
  thresholds: CaptureThresholds = captureThresholdsFromEnv(),
): CaptureRoute {
  const ranked = [...candidates]
    .filter((c) => c.status !== "retired")
    .sort((a, b) => a.distance - b.distance);

  const best = ranked[0];
  if (!best) return { kind: "create" };
  if (best.distance <= thresholds.simMax) return { kind: "merge", target: best };

  const inBand = ranked
    .filter((c) => c.distance <= thresholds.askMax)
    .slice(0, Math.max(1, thresholds.maxCandidates));
  if (inBand.length === 0) return { kind: "create" };

  return { kind: "ask", candidates: inBand };
}
