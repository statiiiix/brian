import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0)),
}));

import pg from "pg";
import { runMigrations } from "./migrate.js";
import { runTenant } from "./tenant.js";
import { capture } from "../ingestion/capture.js";
import type { LlmClient } from "../llm/complete.js";

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.APP_TEST_DATABASE_URL;
const dbDescribe = ownerUrl && appUrl ? describe : describe.skip;

const ACME = "00000000-0000-0000-0000-0000000ac1e2";
const GLOBEX = "00000000-0000-0000-0000-00000006b0be";
const TENANTS = [ACME, GLOBEX];
const PREFIX = "__runtime-rls-";

const skillBase = {
  name: `${PREFIX}shared-skill`,
  trigger: "a runtime RLS transaction is tested",
  inputs: [],
  procedure: "persist only inside the active tenant",
  hard_rules: [],
  tools: [],
  guardrails: [],
  escalation_target: null,
  examples: [],
  owner: null,
};

function llmReturning(items: unknown[]): LlmClient {
  return { complete: async () => JSON.stringify(items) };
}

function skillLlm(name = skillBase.name): LlmClient {
  return llmReturning([{
    kind: "skill",
    confidence: 0.99,
    skill: { ...skillBase, name },
  }]);
}

async function cleanup(ownerPool: pg.Pool): Promise<void> {
  await ownerPool.query("delete from security_audit_events where tenant_id = any($1::uuid[])", [TENANTS]);
  await ownerPool.query("delete from skill_versions where tenant_id = any($1::uuid[])", [TENANTS]);
  await ownerPool.query("delete from context_versions where tenant_id = any($1::uuid[])", [TENANTS]);
  await ownerPool.query("delete from skills where tenant_id = any($1::uuid[])", [TENANTS]);
  await ownerPool.query("delete from context_entries where tenant_id = any($1::uuid[])", [TENANTS]);
  await ownerPool.query("delete from tenants where id = any($1::uuid[])", [TENANTS]);
}

async function seedTenants(ownerPool: pg.Pool): Promise<void> {
  await ownerPool.query(
    `insert into tenants (id, name, slug) values
       ($1, 'Runtime RLS Acme', '__runtime-rls-acme'),
       ($2, 'Runtime RLS Globex', '__runtime-rls-globex')`,
    [ACME, GLOBEX],
  );
}

async function queryAsTenant(
  appPool: pg.Pool,
  tenantId: string,
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult> {
  const client = await appPool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await client.query(text, params);
    await client.query("commit");
    return result;
  } catch (error) {
    try { await client.query("rollback"); } catch { /* connection-level failure */ }
    throw error;
  } finally {
    client.release();
  }
}

dbDescribe("non-owner runtime tenant transactions", () => {
  let ownerPool: pg.Pool;
  let appPool: pg.Pool;

  beforeAll(async () => {
    ownerPool = new pg.Pool({ connectionString: ownerUrl! });
    appPool = new pg.Pool({ connectionString: appUrl! });
    const [ownerPath, appIdentity] = await Promise.all([
      ownerPool.query("select current_setting('search_path') as search_path"),
      appPool.query(
        `select current_setting('search_path') as search_path, current_user, rolbypassrls
           from pg_roles where rolname=current_user`,
      ),
    ]);
    if (!String(ownerPath.rows[0].search_path).trim().startsWith("test") ||
        !String(appIdentity.rows[0].search_path).trim().startsWith("test")) {
      throw new Error("runtime RLS integration tests require search_path=test,public");
    }
    if (appIdentity.rows[0].rolbypassrls || appIdentity.rows[0].current_user === "postgres") {
      throw new Error("APP_TEST_DATABASE_URL must use a non-owner role without BYPASSRLS");
    }
    await runMigrations(ownerPool);
  });

  beforeEach(async () => {
    await cleanup(ownerPool);
    await seedTenants(ownerPool);
  });

  afterAll(async () => {
    await cleanup(ownerPool);
    await appPool.end();
    await ownerPool.end();
  });

  it("persists capture and audit rows through brian_app with transaction-local tenant context", async () => {
    const role = await appPool.query(
      "select current_user, current_schema(), rolbypassrls from pg_roles where rolname = current_user",
    );
    expect(role.rows[0]).toMatchObject({ current_schema: "test", rolbypassrls: false });
    expect(role.rows[0].current_user).not.toBe("postgres");

    const result = await runTenant(ACME, () => capture("runtime transaction capture", skillLlm(), appPool));
    expect(result.items).toHaveLength(1);

    const persisted = await ownerPool.query(
      "select tenant_id, status from skills where id=$1",
      [result.items[0].id],
    );
    expect(persisted.rows).toEqual([{ tenant_id: ACME, status: "active" }]);

    const audit = await ownerPool.query(
      `select tenant_id, event_type, target_id from security_audit_events
        where target_id=$1 order by id`,
      [result.items[0].id],
    );
    expect(audit.rows).toEqual([{
      tenant_id: ACME,
      event_type: "knowledge.capture.created",
      target_id: result.items[0].id,
    }]);

    // SET LOCAL must disappear after commit, even when this pool reuses the
    // same physical connection for an unscoped query.
    expect((await appPool.query("select id from skills where id=$1", [result.items[0].id])).rows)
      .toEqual([]);
  });

  it("keeps identical runtime captures tenant-bound and cannot mutate the other tenant", async () => {
    const acme = await runTenant(ACME, () => capture("shared capture", skillLlm(), appPool));
    const globex = await runTenant(GLOBEX, () => capture("shared capture", skillLlm(), appPool));
    const acmeId = acme.items[0].id;
    const globexId = globex.items[0].id;

    expect(globexId).not.toBe(acmeId);
    const stored = await ownerPool.query(
      "select id, tenant_id from skills where id=any($1::uuid[])",
      [[acmeId, globexId]],
    );
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows).toEqual(expect.arrayContaining([
      { id: acmeId, tenant_id: ACME },
      { id: globexId, tenant_id: GLOBEX },
    ]));

    const crossTenantUpdate = await queryAsTenant(
      appPool,
      GLOBEX,
      "update skills set name=$2 where id=$1 returning id",
      [acmeId, `${PREFIX}cross-tenant-write`],
    );
    expect(crossTenantUpdate.rowCount).toBe(0);
    expect((await ownerPool.query("select name from skills where id=$1", [acmeId])).rows[0].name)
      .toBe(skillBase.name);
  });

  it("rolls back earlier capture and audit writes when a later item fails", async () => {
    const rollbackContent = `${PREFIX}rollback-context`;
    const invalidBatch = llmReturning([
      {
        kind: "context",
        confidence: 0.99,
        content: rollbackContent,
        summary: "rollback the whole capture transaction",
        tags: ["test"],
      },
      {
        kind: "skill",
        confidence: 0.99,
        skill: { ...skillBase, name: "" },
      },
    ]);

    await expect(
      runTenant(ACME, () => capture("capture must roll back", invalidBatch, appPool)),
    ).rejects.toMatchObject({ name: "ValidationError" });

    expect((await ownerPool.query(
      "select id from context_entries where tenant_id=$1 and content=$2",
      [ACME, rollbackContent],
    )).rows).toEqual([]);
    expect((await ownerPool.query(
      "select id from security_audit_events where tenant_id=$1 and event_type like 'knowledge.capture.%'",
      [ACME],
    )).rows).toEqual([]);
  });
});
