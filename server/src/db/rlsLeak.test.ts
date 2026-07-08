import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("./embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import pg from "pg";
import { runMigrations } from "./migrate.js";
import { pool } from "./pool.js";
import { runTenant, FOUNDING_TENANT_ID } from "./tenant.js";
import { createSkill } from "../skills/repo.js";
import type { NewSkill } from "../skills/types.js";

// These tests connect as the NON-OWNER brian_app role and prove the RLS
// policies (007) isolate tenants at the database layer — even against
// hand-crafted queries with no WHERE clause. They need a brian_app login
// credential in APP_TEST_DATABASE_URL (same search_path=test,public shape as
// TEST_DATABASE_URL); they skip when it is not configured.
const appUrl = process.env.APP_TEST_DATABASE_URL;
const d = process.env.TEST_DATABASE_URL && appUrl ? describe : describe.skip;

const ACME = "00000000-0000-0000-0000-0000000ac1e0";

function newSkill(name: string): NewSkill {
  return {
    name, trigger: `${name} trigger`, inputs: [], procedure: `${name} procedure`,
    hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null,
  };
}

async function cleanup() {
  await pool.query("delete from skills where name like '__rls-%'");
  await pool.query("delete from tenants where id = $1", [ACME]);
}

d("RLS backstop: brian_app cannot cross tenants", () => {
  const appPool = new pg.Pool({ connectionString: appUrl });
  let foundingSkillId = "";
  let acmeSkillId = "";

  beforeAll(async () => {
    await runMigrations(pool);
    await cleanup();
    await pool.query(
      "insert into tenants (id, name, slug) values ($1,'Acme','__rls-acme') on conflict (id) do nothing",
      [ACME],
    );
    foundingSkillId = (await runTenant(FOUNDING_TENANT_ID, () => createSkill(newSkill("__rls-founding")))).id;
    acmeSkillId = (await runTenant(ACME, () => createSkill(newSkill("__rls-acme")))).id;
  });

  afterAll(async () => {
    await cleanup();
    await appPool.end();
    await pool.end();
  });

  it("connects as a non-owner (RLS actually applies)", async () => {
    const { rows } = await appPool.query(
      "select current_user, rolbypassrls from pg_roles where rolname = current_user",
    );
    expect(rows[0].rolbypassrls).toBe(false);
    expect(rows[0].current_user).not.toBe("postgres");
  });

  it("sees NOTHING without a tenant context — even with no WHERE clause", async () => {
    const { rows } = await appPool.query("select id from skills");
    expect(rows.length).toBe(0);
  });

  it("bound to tenant A, a hand-crafted unfiltered query returns only A's rows", async () => {
    const client = await appPool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [FOUNDING_TENANT_ID]);
      const { rows } = await client.query("select id from skills where name like '__rls-%'");
      expect(rows.map((r) => r.id)).toEqual([foundingSkillId]);
      await client.query("commit");
    } finally {
      client.release();
    }
  });

  it("bound to tenant A, cannot read tenant B's row by id", async () => {
    const client = await appPool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [FOUNDING_TENANT_ID]);
      const { rows } = await client.query("select id from skills where id = $1", [acmeSkillId]);
      expect(rows.length).toBe(0);
      await client.query("commit");
    } finally {
      client.release();
    }
  });

  it("bound to tenant A, cannot INSERT a row for tenant B", async () => {
    const client = await appPool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [FOUNDING_TENANT_ID]);
      await expect(
        client.query(
          `insert into skills (name, trigger, procedure, tenant_id)
           values ('__rls-smuggle','t','p',$1)`,
          [ACME],
        ),
      ).rejects.toThrow(/row-level security/);
      await client.query("rollback");
    } finally {
      client.release();
    }
  });

  it("token lookup works pre-tenant (pre_tenant_lookup policy)", async () => {
    const { rows } = await appPool.query("select count(*)::int as n from tenants");
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
