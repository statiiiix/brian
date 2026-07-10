import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import { runTenant, FOUNDING_TENANT_ID } from "../db/tenant.js";
import { upsertConnector, insertEvidence, unpromotedEvidence } from "./repo.js";
import { aggregate } from "./aggregate.js";
import type { LlmClient } from "../llm/complete.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

// Orthogonal unit vectors ⇒ same index clusters (cosine distance 0), different
// index is far (distance 1), so K-clustering is deterministic without a model.
const vecAt = (i: number) => { const v = new Array(1536).fill(0); v[i] = 1; return v; };
const skillJson = JSON.stringify({
  name: "__agg Refund flow", trigger: "refund over $200", inputs: [], procedure: "escalate to lead",
  hard_rules: [], tools: [], guardrails: [], escalation_target: "lead", examples: [], owner: null,
});
const mockLlm: LlmClient = { complete: async () => skillJson };

async function clean() {
  await pool.query("delete from evidence where summary like '__agg%'");
  await pool.query("delete from skills where name = '__agg Refund flow'");
  await pool.query("delete from context_entries where source='connector' and summary like '__agg%'");
}

d("connectors aggregate", () => {
  let connId = "";
  let driveConnId = "";
  beforeAll(async () => {
    await runMigrations(pool);
    await clean();
    await runTenant(FOUNDING_TENANT_ID, async () => {
      connId = (await upsertConnector("gmail", { status: "connected" })).id;
      driveConnId = (await upsertConnector("google_drive", { status: "connected" })).id;
    });
  });
  afterAll(async () => { await clean(); await pool.end(); });

  it("drafts a skill only at ≥K and promotes just that cluster", async () => {
    await runTenant(FOUNDING_TENANT_ID, async () => {
      for (let n = 0; n < 3; n++) {
        await insertEvidence({
          connector_id: connId, source_ref: { thread_id: `__aggA${n}` }, kind: "skill_evidence",
          summary: `__agg refund ${n}`, confidence: 0.8, embedding: vecAt(0),
        });
      }
      for (let n = 0; n < 2; n++) {
        await insertEvidence({
          connector_id: connId, source_ref: { thread_id: `__aggB${n}` }, kind: "skill_evidence",
          summary: `__agg other ${n}`, confidence: 0.8, embedding: vecAt(1),
        });
      }
      const res = await aggregate(mockLlm);
      expect(res.skills).toBe(1); // only the 3-cluster drafts

      const remaining = (await unpromotedEvidence("skill_evidence")).map((e) => e.source_ref.thread_id);
      expect(remaining).toContain("__aggB0");     // sub-K cluster stays open
      expect(remaining).not.toContain("__aggA0"); // K-cluster promoted
    });
  });

  it("drafts context directly from one confident context_evidence", async () => {
    await runTenant(FOUNDING_TENANT_ID, async () => {
      await insertEvidence({
        connector_id: connId, source_ref: { thread_id: "__aggCtx" }, kind: "context_evidence",
        summary: "__agg we prioritize retention over margin", confidence: 0.9, embedding: vecAt(5),
      });
      const res = await aggregate(mockLlm);
      expect(res.contexts).toBeGreaterThanOrEqual(1);
      const remaining = (await unpromotedEvidence("context_evidence")).map((e) => e.source_ref.thread_id);
      expect(remaining).not.toContain("__aggCtx");
    });
  });

  it("can draft from one explicit process document without a conversation quorum", async () => {
    await runTenant(FOUNDING_TENANT_ID, async () => {
      await insertEvidence({
        connector_id: driveConnId,
        source_ref: { thread_id: "__aggDoc", source_kind: "document", title: "Refund policy" },
        kind: "skill_evidence", summary: "__agg documented refund procedure", confidence: 0.95, embedding: vecAt(8),
      });
      const res = await aggregate(mockLlm, "refund approval");
      expect(res.skills).toBeGreaterThanOrEqual(1);
      const remaining = (await unpromotedEvidence("skill_evidence")).map((e) => e.source_ref.thread_id);
      expect(remaining).not.toContain("__aggDoc");
    });
  });

  it("does not draft context below the confidence threshold", async () => {
    await runTenant(FOUNDING_TENANT_ID, async () => {
      await insertEvidence({
        connector_id: connId, source_ref: { thread_id: "__aggLow" }, kind: "context_evidence",
        summary: "__agg maybe a preference", confidence: 0.3, embedding: vecAt(6),
      });
      await aggregate(mockLlm);
      const remaining = (await unpromotedEvidence("context_evidence")).map((e) => e.source_ref.thread_id);
      expect(remaining).toContain("__aggLow"); // left for more evidence
    });
  });
});
