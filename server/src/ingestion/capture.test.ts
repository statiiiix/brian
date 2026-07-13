import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

function fakeVec(text: string): number[] {
  const v = Array.from({ length: 1536 }, () => 0);
  if (/launch|goal|q3|q4/i.test(text)) v[0] = 1;
  if (/refund/i.test(text)) v[1] = 1;
  if (/onboard/i.test(text)) v[2] = 1;
  if (/order status|lookup order/i.test(text)) v[3] = 1;
  return v;
}
vi.mock("../db/embed.js", () => ({ EMBED_DIM: 1536, embed: vi.fn(async (t: string) => fakeVec(t)) }));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { getSkill } from "../skills/repo.js";
import { capture, type CapturedItem } from "./capture.js";
import { FOUNDING_TENANT_ID, runPrincipal } from "../db/tenant.js";
import type { McpPrincipal } from "../auth/principal.js";
import type { LlmClient } from "../llm/complete.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const ACTOR = "14000000-0000-4000-8000-000000000001";

function clientReturning(items: CapturedItem[]): LlmClient {
  return { complete: async () => JSON.stringify(items) };
}

const skillBase = { name: "", trigger: "", inputs: [], procedure: "p", hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null };

d("capture", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => {
    await resetDb(pool);
    await pool.query("delete from brian_auth_users_test where id=$1", [ACTOR]);
    await pool.end();
  });
  beforeEach(async () => {
    await resetDb(pool);
    await pool.query("delete from brian_auth_users_test where id=$1", [ACTOR]);
  });

  it("stores a context item active", async () => {
    const c = clientReturning([{ kind: "context", confidence: 0.9, content: "Launch in Q3", summary: "Q3 launch goal", tags: ["goal"] }]);
    const r = await capture("we want to launch in Q3", c, pool);
    expect(r.items[0]).toMatchObject({ kind: "context", action: "created_active" });
  });

  it("auto-activates a confident skill that uses only safe tools", async () => {
    const c = clientReturning([{ kind: "skill", confidence: 0.95, skill: { ...skillBase, name: "Lookup Order Status", trigger: "customer asks order status", tools: ["get_order"] } }]);
    const r = await capture("when a customer asks status, look up the order", c, pool);
    expect(r.items[0].action).toBe("created_active");
    expect((await getSkill(r.items[0].id, pool))!.status).toBe("active");
  });

  it("keeps a destructive-tool skill as draft even when confident", async () => {
    const c = clientReturning([{ kind: "skill", confidence: 0.99, skill: { ...skillBase, name: "Refund Flow", trigger: "refund request", tools: ["get_order", "issue_refund"] } }]);
    const r = await capture("how we refund", c, pool);
    expect(r.items[0].action).toBe("created_draft");
    expect((await getSkill(r.items[0].id, pool))!.status).toBe("draft");
  });

  it("keeps a low-confidence safe skill as draft", async () => {
    const c = clientReturning([{ kind: "skill", confidence: 0.4, skill: { ...skillBase, name: "Maybe Onboarding", trigger: "onboard new user", tools: ["get_ticket"] } }]);
    const r = await capture("not sure how onboarding works", c, pool);
    expect(r.items[0].action).toBe("created_draft");
  });

  it("updates an existing context instead of duplicating", async () => {
    const c1 = clientReturning([{ kind: "context", confidence: 0.9, content: "Launch in Q3", summary: "launch goal q3", tags: [] }]);
    const first = await capture("launch q3", c1, pool);
    const c2 = clientReturning([{ kind: "context", confidence: 0.9, content: "Launch moved to Q4", summary: "launch goal q4", tags: [] }]);
    const second = await capture("update launch", c2, pool);
    expect(second.items[0].action).toBe("updated_active");
    expect(second.items[0].id).toBe(first.items[0].id);
  });

  it("audits captured skill/context creates and updates with actor and connection attribution", async () => {
    await pool.query(
      "insert into brian_auth_users_test(id,email) values ($1,'__capture-actor@example.test')",
      [ACTOR],
    );
    const inserted = await pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,permissions,status,approved_at)
       values ($1,$2,'capture-audit-client','Capture Audit Client',array['knowledge:write'],'active',now())
       returning id`,
      [FOUNDING_TENANT_ID, ACTOR],
    );
    const principal: McpPrincipal = {
      kind: "mcp",
      tenantId: FOUNDING_TENANT_ID,
      userId: ACTOR,
      clientId: "capture-audit-client",
      connectionId: inserted.rows[0].id,
      role: "admin",
      permissions: ["knowledge:write"],
    };

    const captured = await runPrincipal(principal, async () => {
      const results = [];
      results.push(await capture("raw-secret-context-create", clientReturning([
        { kind: "context", confidence: 0.91, content: "Launch in Q3", summary: "launch goal q3", tags: [] },
      ]), pool));
      results.push(await capture("raw-secret-context-update", clientReturning([
        { kind: "context", confidence: 0.92, content: "Launch moved to Q4", summary: "launch goal q4", tags: [] },
      ]), pool));
      results.push(await capture("raw-secret-skill-create", clientReturning([
        { kind: "skill", confidence: 0.93, skill: { ...skillBase, name: "Lookup Order Status", trigger: "customer asks order status", tools: ["get_order"] } },
      ]), pool));
      results.push(await capture("raw-secret-skill-update", clientReturning([
        { kind: "skill", confidence: 0.94, skill: { ...skillBase, name: "Lookup Order Status Updated", trigger: "customer asks for order status", tools: ["get_order"] } },
      ]), pool));
      return results;
    });

    const { rows } = await pool.query(
      `select actor_user_id,connection_id,event_type,target_type,target_id,metadata
         from security_audit_events where actor_user_id=$1 order by id`,
      [ACTOR],
    );
    expect(rows.map((row) => ({
      eventType: row.event_type,
      targetType: row.target_type,
      action: row.metadata.action,
    }))).toEqual([
      { eventType: "knowledge.capture.created", targetType: "context", action: "created_active" },
      { eventType: "knowledge.capture.updated", targetType: "context", action: "updated_active" },
      { eventType: "knowledge.capture.created", targetType: "skill", action: "created_active" },
      { eventType: "knowledge.capture.updated", targetType: "skill", action: "updated_active" },
    ]);
    for (const [index, row] of rows.entries()) {
      expect(row.actor_user_id).toBe(ACTOR);
      expect(row.connection_id).toBe(principal.connectionId);
      expect(row.target_id).toBe(captured[index].items[0].id);
    }
    expect(JSON.stringify(rows)).not.toContain("raw-secret");
  });
});
