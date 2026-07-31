import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Deterministic fake embeddings: a sparse vector keyed on keywords.
function fakeVec(text: string): number[] {
  const v = Array.from({ length: 1536 }, () => 0);
  if (/refund/i.test(text)) v[0] = 1;
  if (/incident|outage|sev/i.test(text)) v[1] = 1;
  return v;
}
vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async (t: string) => fakeVec(t)),
}));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { createSkill, setStatus, findSkill, findSkillsWithDistance, lookupSkill } from "./repo.js";
import { decideMatch, thresholdsFromEnv, type SkillCandidate } from "./matching.js";

// Abstention is pure, so it is tested without a database. The property that
// matters: nearest-neighbour search always returns something, and this is the
// layer allowed to say "that is not a match".
describe("decideMatch", () => {
  const thresholds = { maxDistance: 0.55, ambiguityMargin: 0.04 };
  const candidate = (name: string, distance: number): SkillCandidate =>
    ({ id: name, name, trigger: `${name} trigger`, distance });

  it("matches a clear winner", () => {
    const outcome = decideMatch([candidate("Refunds", 0.12), candidate("Incidents", 0.48)], thresholds);
    expect(outcome.kind).toBe("match");
    if (outcome.kind === "match") {
      expect(outcome.candidate.name).toBe("Refunds");
      expect(outcome.runnerUp?.name).toBe("Incidents");
    }
  });

  it("declines when the nearest skill is still unrelated", () => {
    const outcome = decideMatch([candidate("Refunds", 0.83)], thresholds);
    expect(outcome.kind).toBe("no_match");
    if (outcome.kind === "no_match") expect(outcome.nearest?.name).toBe("Refunds");
  });

  it("declines on an empty corpus", () => {
    expect(decideMatch([], thresholds)).toEqual({ kind: "no_match", nearest: null });
  });

  it("refuses to guess between near-duplicate procedures", () => {
    // The bench's residual misses: several teams' merge-request processes all
    // plausibly answer "can you review my MR?".
    const outcome = decideMatch([
      candidate("Static Analysis MR Review", 0.31),
      candidate("Distribution MR Handling", 0.33),
      candidate("Incidents", 0.52),
    ], thresholds);
    expect(outcome.kind).toBe("ambiguous");
    if (outcome.kind === "ambiguous") {
      expect(outcome.candidates.map((c) => c.name)).toEqual([
        "Static Analysis MR Review", "Distribution MR Handling",
      ]);
    }
  });

  it("does not let a far-away runner-up create ambiguity", () => {
    const outcome = decideMatch([candidate("Refunds", 0.53), candidate("Other", 0.56)], thresholds);
    expect(outcome.kind).toBe("match");
  });

  it("sorts unsorted candidates before deciding", () => {
    const outcome = decideMatch([candidate("Far", 0.5), candidate("Near", 0.1)], thresholds);
    expect(outcome.kind === "match" && outcome.candidate.name).toBe("Near");
  });

  it("reads thresholds from the environment so a corpus can be tuned", () => {
    expect(thresholdsFromEnv({ SKILL_MATCH_MAX_DISTANCE: "0.3" } as NodeJS.ProcessEnv).maxDistance).toBe(0.3);
    expect(thresholdsFromEnv({} as NodeJS.ProcessEnv)).toEqual({ maxDistance: 0.55, ambiguityMargin: 0.04 });
  });
});

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("findSkill", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("returns the active skill whose trigger matches the query", async () => {
    const refund = await createSkill(
      { name: "Refund Handling", trigger: "customer wants a refund", inputs: [], procedure: "refund flow",
        hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    const incident = await createSkill(
      { name: "Incident Response", trigger: "production outage sev-2", inputs: [], procedure: "incident flow",
        hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    await setStatus(refund.id, "active", pool);
    await setStatus(incident.id, "active", pool);

    const hit = await findSkill("a customer is asking for a refund", pool);
    expect(hit?.name).toBe("Refund Handling");
  });

  it("ignores non-active skills", async () => {
    const refund = await createSkill(
      { name: "Refund Handling", trigger: "customer wants a refund", inputs: [], procedure: "refund flow",
        hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    // left as draft
    const hit = await findSkill("refund please", pool);
    expect(hit).toBeNull();
    expect(refund.status).toBe("draft");
  });

  it("findSkillsWithDistance returns k active skills nearest-first, excluding drafts", async () => {
    const refund = await createSkill(
      { name: "Refund Handling", trigger: "customer wants a refund", inputs: [], procedure: "refund flow",
        hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    const incident = await createSkill(
      { name: "Incident Response", trigger: "production outage sev-2", inputs: [], procedure: "incident flow",
        hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    const draft = await createSkill(
      { name: "Refund Drafts", trigger: "refund refund refund", inputs: [], procedure: "p",
        hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    await setStatus(refund.id, "active", pool);
    await setStatus(incident.id, "active", pool);
    // draft stays draft

    const hits = await findSkillsWithDistance("a customer is asking for a refund", 3, pool);
    expect(hits.length).toBe(2); // draft excluded even though it matches
    expect(hits[0].skill.name).toBe("Refund Handling");
    expect(hits[0].distance).toBeLessThanOrEqual(hits[1].distance);
    expect(hits.map((h) => h.skill.id)).not.toContain(draft.id);
  });
});

d("lookupSkill", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  const base = {
    inputs: [], hard_rules: [], tools: [], guardrails: [],
    escalation_target: null, examples: [], owner: null,
  };

  it("returns NO match when the brain holds nothing about the task", async () => {
    const incident = await createSkill(
      { ...base, name: "Incident Response", trigger: "production outage sev-2", procedure: "incident flow" }, pool);
    await setStatus(incident.id, "active", pool);

    // The fake embedder puts refunds and incidents on orthogonal axes, so a
    // refund query is maximally far from the only skill on file.
    const { outcome, skill } = await lookupSkill("a customer is asking for a refund", pool);
    expect(outcome.kind).toBe("no_match");
    expect(skill).toBeNull();
  });

  it("returns the governing skill when one clearly matches", async () => {
    const refund = await createSkill(
      { ...base, name: "Refund Handling", trigger: "customer wants a refund", procedure: "refund flow" }, pool);
    await setStatus(refund.id, "active", pool);

    const { outcome, skill } = await lookupSkill("a customer is asking for a refund", pool);
    expect(outcome.kind).toBe("match");
    expect(skill?.name).toBe("Refund Handling");
  });
});
