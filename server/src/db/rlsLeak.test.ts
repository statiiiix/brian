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
import { assertOwnerMaintenanceConnection, previewMaintenance } from "../privacy/maintenance.js";

// These tests connect as the NON-OWNER brian_app role and prove the RLS
// policies (007) isolate tenants at the database layer — even against
// hand-crafted queries with no WHERE clause. They need a brian_app login
// credential in APP_TEST_DATABASE_URL (same search_path=test,public shape as
// TEST_DATABASE_URL); they skip when it is not configured.
const appUrl = process.env.APP_TEST_DATABASE_URL;
const d = process.env.TEST_DATABASE_URL && appUrl ? describe : describe.skip;

const ACME = "00000000-0000-0000-0000-0000000ac1e0";
const FOUNDING_USER = "12000000-0000-4000-8000-000000000001";
const ACME_USER = "12000000-0000-4000-8000-000000000002";
const TENANT_TABLES = [
  "tenant_memberships",
  "agent_connections",
  "tenant_invitations",
  "security_audit_events",
  "onboarding_state",
  "skill_links",
] as const;

function newSkill(name: string): NewSkill {
  return {
    name, trigger: `${name} trigger`, inputs: [], procedure: `${name} procedure`,
    hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null,
  };
}

async function cleanup() {
  await pool.query(
    `insert into app_config (key,value) values ('PUBLIC_SIGNUP_ENABLED','false')
     on conflict (key) do update set value='false'`,
  );
  await pool.query(
    "delete from security_audit_events where left(event_type,6)='__rls.' or actor_user_id=any($1::uuid[])",
    [[FOUNDING_USER, ACME_USER]],
  );
  await pool.query("delete from skill_links where left(relation,6)='__rls-'");
  await pool.query("delete from api_tokens where left(label,6)='__rls-'");
  await pool.query("delete from agent_connections where user_id=any($1::uuid[])", [[FOUNDING_USER, ACME_USER]]);
  await pool.query("delete from tenant_invitations where invited_by=any($1::uuid[])", [[FOUNDING_USER, ACME_USER]]);
  await pool.query("delete from onboarding_state where tenant_id=$1", [ACME]);
  await pool.query("delete from tenant_memberships where user_id=any($1::uuid[])", [[FOUNDING_USER, ACME_USER]]);
  await pool.query("delete from skills where left(name,6)='__rls-'");
  await pool.query("delete from tenants where id = $1", [ACME]);
  await pool.query("delete from brian_auth_users_test where id=any($1::uuid[])", [[FOUNDING_USER, ACME_USER]]);
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
    await pool.query(
      `insert into brian_auth_users_test (id,email) values
       ($1,'__rls-founding@example.test'),($2,'__rls-acme@example.test')`,
      [FOUNDING_USER, ACME_USER],
    );
    await pool.query(
      `insert into tenant_memberships
         (tenant_id,user_id,role,status,is_default) values
       ($1,$2,'admin','active',true),
       ($3,$4,'admin','active',true)`,
      [FOUNDING_TENANT_ID, FOUNDING_USER, ACME, ACME_USER],
    );
    foundingSkillId = (await runTenant(FOUNDING_TENANT_ID, () => createSkill(newSkill("__rls-founding")))).id;
    acmeSkillId = (await runTenant(ACME, () => createSkill(newSkill("__rls-acme")))).id;
    await pool.query(
      `insert into agent_connections
         (tenant_id,user_id,oauth_client_id,client_name,permissions) values
       ($1,$2,'__rls-founding-client','RLS founding',array['skills:read']),
       ($3,$4,'__rls-acme-client','RLS Acme',array['skills:read'])`,
      [FOUNDING_TENANT_ID, FOUNDING_USER, ACME, ACME_USER],
    );
    await pool.query(
      `insert into tenant_invitations
         (tenant_id,email,role,token_hash,invited_by,expires_at) values
       ($1,'__rls-founding-invite@example.test','viewer',$2,$3,now()+interval '1 hour'),
       ($4,'__rls-acme-invite@example.test','viewer',$5,$6,now()+interval '1 hour')`,
      [FOUNDING_TENANT_ID, "1".repeat(64), FOUNDING_USER, ACME, "2".repeat(64), ACME_USER],
    );
    await pool.query(
      `insert into security_audit_events
         (tenant_id,actor_user_id,event_type,metadata) values
       ($1,$2,'__rls.fixture',jsonb_build_object('tenant','founding')),
       ($3,$4,'__rls.fixture',jsonb_build_object('tenant','acme'))`,
      [FOUNDING_TENANT_ID, FOUNDING_USER, ACME, ACME_USER],
    );
    await pool.query(
      `insert into onboarding_state (tenant_id) values ($1),($2)
       on conflict (tenant_id) do nothing`,
      [FOUNDING_TENANT_ID, ACME],
    );
    await pool.query(
      `insert into skill_links (tenant_id,from_skill_id,to_skill_id,relation) values
       ($1,$2,$2,'__rls-founding-link'),
       ($3,$4,$4,'__rls-acme-link')`,
      [FOUNDING_TENANT_ID, foundingSkillId, ACME, acmeSkillId],
    );
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

  it("cannot inspect deletion requests or invoke owner-only privacy maintenance", async () => {
    await expect(appPool.query("select id from data_deletion_requests"))
      .rejects.toThrow(/permission denied/);
    await expect(assertOwnerMaintenanceConnection(appPool))
      .rejects.toThrow(/database owner credential/);
    await expect(previewMaintenance(appPool))
      .rejects.toThrow(/database owner credential/);
  });

  it("sees NOTHING without a tenant context — even with no WHERE clause", async () => {
    const { rows } = await appPool.query("select id from skills");
    expect(rows.length).toBe(0);
  });

  it("sees no rows from any identity table without tenant context", async () => {
    for (const table of TENANT_TABLES) {
      const { rows } = await appPool.query(`select tenant_id from ${table}`);
      expect(rows, table).toEqual([]);
    }
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

  it("bound to tenant A, every identity table returns only tenant A rows", async () => {
    const client = await appPool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [FOUNDING_TENANT_ID]);
      for (const table of TENANT_TABLES) {
        const { rows } = await client.query(`select distinct tenant_id from ${table}`);
        expect(rows, table).toEqual([{ tenant_id: FOUNDING_TENANT_ID }]);
        expect((await client.query(
          `select tenant_id from ${table} where tenant_id=$1`,
          [ACME],
        )).rows, table).toEqual([]);
      }
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

  it("cannot enumerate tenants without context after broad lookup policies are removed", async () => {
    const { rows } = await appPool.query("select id from tenants");
    expect(rows).toEqual([]);
  });

  it("can resolve only an exact active legacy hash through the narrow function", async () => {
    const hash = "a".repeat(64);
    await pool.query(
      `insert into api_tokens (tenant_id, token_hash, label)
       values ($1,$2,'__rls-legacy') on conflict (token_hash) do nothing`,
      [ACME, hash],
    );
    const { rows } = await appPool.query("select * from resolve_legacy_agent_token($1)", [hash]);
    expect(rows).toEqual([{ tenant_id: ACME, connection_id: null }]);
    expect((await appPool.query("select * from resolve_legacy_agent_token($1)", ["b".repeat(64)])).rows)
      .toEqual([]);
    await pool.query("delete from api_tokens where token_hash=$1", [hash]);
  });

  it("lets brian_app append and read audit events but never update or delete them", async () => {
    const writer = await appPool.connect();
    let auditId = "";
    try {
      await writer.query("begin");
      await writer.query("select set_config('app.tenant_id', $1, true)", [FOUNDING_TENANT_ID]);
      const inserted = await writer.query(
        `insert into security_audit_events
           (tenant_id,actor_user_id,event_type,metadata)
         values ($1,$2,'__rls.runtime_append',jsonb_build_object('immutable',true))
         returning id`,
        [FOUNDING_TENANT_ID, FOUNDING_USER],
      );
      auditId = inserted.rows[0].id;
      expect((await writer.query(
        "select event_type from security_audit_events where id=$1",
        [auditId],
      )).rows).toEqual([{ event_type: "__rls.runtime_append" }]);
      await writer.query("commit");
    } catch (error) {
      await writer.query("rollback");
      throw error;
    } finally {
      writer.release();
    }

    for (const statement of [
      "update security_audit_events set event_type='__rls.tampered' where id=$1",
      "delete from security_audit_events where id=$1",
    ]) {
      const client = await appPool.connect();
      try {
        await client.query("begin");
        await client.query("select set_config('app.tenant_id', $1, true)", [FOUNDING_TENANT_ID]);
        await expect(client.query(statement, [auditId])).rejects.toThrow(/permission denied/);
        await client.query("rollback");
      } finally {
        client.release();
      }
    }

    expect((await pool.query(
      "select event_type,metadata from security_audit_events where id=$1",
      [auditId],
    )).rows).toEqual([{
      event_type: "__rls.runtime_append",
      metadata: { immutable: true },
    }]);
  });
});
