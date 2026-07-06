import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Mock embeddings so the pipeline runs without OpenAI and is deterministic.
vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import { runTenant, FOUNDING_TENANT_ID } from "../db/tenant.js";
import { upsertConnector, getConnector } from "./repo.js";
import { syncConnector } from "./sync.js";
import type { Connector, RawThread } from "./types.js";
import type { LlmClient } from "../llm/complete.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const goodThread = (id: string): RawThread => ({
  thread_id: id, permalink: `p/${id}`,
  participants: [
    { id: "a@us.com", is_company_member: true, is_bot: false },
    { id: "b@x.com", is_company_member: false, is_bot: false },
  ],
  messages: [
    { from: "a@us.com", ts: "1", text: "how do we handle refunds over $200?" },
    { from: "b@x.com", ts: "2", text: "escalate to the lead and note the order id" },
  ],
});
const junkThread: RawThread = {
  thread_id: "__syncj1", permalink: "p/j",
  participants: [{ id: "noreply@x.com", is_company_member: false, is_bot: true }],
  messages: [{ from: "noreply@x.com", ts: "1", text: "your receipt" }],
};

const fakeConnector = (items: RawThread[], nextCursor: unknown): Connector => ({
  type: "gmail",
  fetch: async () => ({ items, nextCursor }),
});
const mockLlm: LlmClient = {
  complete: async () => JSON.stringify({ kind: "skill_evidence", confidence: 0.8, summary: "refund escalation over $200" }),
};

async function clean() {
  await pool.query("delete from evidence where source_ref->>'thread_id' in ('__syncg1','__syncg2','__syncj1')");
  await pool.query("delete from connectors where type='gmail' and tenant_id=$1", [FOUNDING_TENANT_ID]);
}

d("connectors sync orchestrator", () => {
  beforeAll(async () => {
    await runMigrations(pool);
    await clean();
    await runTenant(FOUNDING_TENANT_ID, () => upsertConnector("gmail", { status: "connected" }));
  });
  afterAll(async () => { await clean(); await pool.end(); });

  it("fetch → filter → extract → store, advances cursor, and dedupes on re-run", async () => {
    const conn = fakeConnector([goodThread("__syncg1"), goodThread("__syncg2"), junkThread], { historyId: "777" });

    const s = await runTenant(FOUNDING_TENANT_ID, () => syncConnector("gmail", { llm: mockLlm, connector: conn }));
    expect(s.fetched).toBe(3);
    expect(s.kept).toBe(2);       // junk thread filtered out
    expect(s.evidence).toBe(2);   // two skill_evidence rows stored
    expect(s.drafts).toBe(0);     // 2 < K, no skill drafted yet

    const c = await runTenant(FOUNDING_TENANT_ID, () => getConnector("gmail"));
    expect(c?.cursor).toEqual({ historyId: "777" });

    const s2 = await runTenant(FOUNDING_TENANT_ID, () => syncConnector("gmail", { llm: mockLlm, connector: conn }));
    expect(s2.evidence).toBe(0);  // same threads → deduped
  });
});
