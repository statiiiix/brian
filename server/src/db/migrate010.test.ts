import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";
import { pool } from "./pool.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const USER = "10000000-0000-4000-8000-000000000010";
const SECOND_OWNER = "10000000-0000-4000-8000-000000000013";
const TENANT_A = "10000000-0000-4000-8000-000000000011";
const TENANT_B = "10000000-0000-4000-8000-000000000012";
const SKILL_A1 = "10000000-0000-4000-8000-000000000021";
const SKILL_A2 = "10000000-0000-4000-8000-000000000022";
const SKILL_B = "10000000-0000-4000-8000-000000000023";

async function assertSafeTestSchema() {
  const schema = (await pool.query("select current_schema() as s")).rows[0].s;
  if (schema === "public") throw new Error("identity migration tests require a non-public TEST_DATABASE_URL search_path");
}

async function cleanup() {
  await pool.query(
    `insert into app_config (key,value) values ('PUBLIC_SIGNUP_ENABLED','false')
     on conflict (key) do update set value='false'`,
  );
  await pool.query(
    "delete from security_audit_events where actor_user_id=any($1::uuid[]) or tenant_id in ($2,$3)",
    [[USER, SECOND_OWNER], TENANT_A, TENANT_B],
  );
  await pool.query("delete from skill_links where relation like '__m010-%'");
  await pool.query("delete from skills where id=any($1::uuid[])", [[SKILL_A1, SKILL_A2, SKILL_B]]);
  await pool.query("delete from agent_connections where user_id=any($1::uuid[])", [[USER, SECOND_OWNER]]);
  await pool.query("delete from tenant_invitations where invited_by=any($1::uuid[])", [[USER, SECOND_OWNER]]);
  await pool.query("delete from onboarding_state where tenant_id in ($1,$2)", [TENANT_A, TENANT_B]);
  // Delete tenants before their owner memberships; the deferred owner trigger
  // intentionally permits this cascade but blocks an orphaned live tenant.
  await pool.query("delete from tenants where id in ($1,$2)", [TENANT_A, TENANT_B]);
  await pool.query("delete from tenant_memberships where user_id=any($1::uuid[])", [[USER, SECOND_OWNER]]);
  await pool.query("delete from brian_auth_users_test where id=any($1::uuid[])", [[USER, SECOND_OWNER]]);
}

async function seed() {
  await pool.query(
    `insert into brian_auth_users_test (id,email) values
      ($1,'__m010@example.test'),($2,'__m010-second@example.test')`,
    [USER, SECOND_OWNER],
  );
  await pool.query(
    `insert into tenants (id,name,slug) values
     ($1,'M010 A','__m010-a'),($2,'M010 B','__m010-b')`,
    [TENANT_A, TENANT_B],
  );
}

async function waitForBlock(blockedPid: number, blockingPid: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { rows } = await pool.query(
      "select $2::int = any(pg_blocking_pids($1::int)) as blocked",
      [blockedPid, blockingPid],
    );
    if (rows[0].blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`backend ${blockedPid} did not block behind ${blockingPid}`);
}

d("migration 010: identity, agent grants, audit, and isolation schema", () => {
  beforeAll(async () => {
    await assertSafeTestSchema();
    await runMigrations(pool);
  });
  beforeEach(async () => { await cleanup(); await seed(); });
  afterAll(async () => { await cleanup(); await pool.end(); });

  it("creates every identity table with RLS and tenant policies", async () => {
    const tables = [
      "tenant_memberships", "agent_connections", "tenant_invitations",
      "security_audit_events", "onboarding_state", "skill_links",
    ];
    const { rows } = await pool.query(
      `select c.relname, c.relrowsecurity,
              exists (
                select 1 from pg_policies p
                 where p.schemaname=current_schema()
                   and p.tablename=c.relname and p.policyname='tenant_isolation'
              ) as has_policy
         from pg_class c
        where c.oid = any($1::regclass[])
        order by c.relname`,
      [tables],
    );
    expect(rows.map((r) => r.relname)).toEqual([...tables].sort());
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.has_policy).toBe(true);
    }
  });

  it("adds execution and security-audit attribution columns plus the complete onboarding shape", async () => {
    const { rows } = await pool.query(
      `select table_name, column_name
         from information_schema.columns
        where table_schema=current_schema()
          and (
            (table_name='executions' and column_name in ('actor_user_id','connection_id'))
            or (table_name='security_audit_events' and column_name='connection_id')
            or (table_name='onboarding_state' and column_name in
              ('tenant_id','current_step','completed_steps','completed','updated_at','first_mcp_call_at'))
          )
        order by table_name, column_name`,
    );
    expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([
      "executions.actor_user_id",
      "executions.connection_id",
      "onboarding_state.completed",
      "onboarding_state.completed_steps",
      "onboarding_state.current_step",
      "onboarding_state.first_mcp_call_at",
      "onboarding_state.tenant_id",
      "onboarding_state.updated_at",
      "security_audit_events.connection_id",
    ]);
  });

  it("constrains tenant status and maintains updated_at", async () => {
    await expect(pool.query("update tenants set status='made_up' where id=$1", [TENANT_A]))
      .rejects.toThrow();
    await pool.query("update tenants set updated_at='2000-01-01', name='M010 A updated' where id=$1", [TENANT_A]);
    const { rows } = await pool.query("select updated_at from tenants where id=$1", [TENANT_A]);
    expect(new Date(rows[0].updated_at).getUTCFullYear()).toBeGreaterThan(2000);
  });

  it("allows only supported agent permissions", async () => {
    await expect(pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,permissions)
       values ($1,$2,'bad-client','Bad',array['root:everything'])`,
      [TENANT_A, USER],
    )).rejects.toThrow();
  });

  it("allows only one pending/active grant per user and OAuth client across tenants", async () => {
    const first = await pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,display_name,permissions)
       values ($1,$2,'shared-client','Client','My Agent',array['skills:read'])
       returning id`,
      [TENANT_A, USER],
    );
    await expect(pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,permissions)
       values ($1,$2,'shared-client','Client 2',array['skills:read'])`,
      [TENANT_B, USER],
    )).rejects.toThrow();

    await pool.query(
      "update agent_connections set status='revoked', revoked_at=now() where id=$1",
      [first.rows[0].id],
    );
    await expect(pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,permissions)
       values ($1,$2,'shared-client','Client 2',array['skills:read'])`,
      [TENANT_B, USER],
    )).resolves.toBeTruthy();
  });

  it("prevents direct loss of the last active owner but permits an ownership transfer and tenant deletion", async () => {
    await pool.query(
      `insert into tenant_memberships (tenant_id,user_id,role,status,is_default)
       values ($1,$2,'owner','active',true)`,
      [TENANT_A, USER],
    );

    await expect(pool.query(
      "update tenant_memberships set status='suspended' where tenant_id=$1 and user_id=$2",
      [TENANT_A, USER],
    )).rejects.toThrow(/retain at least one active owner/);
    await expect(pool.query("delete from brian_auth_users_test where id=$1", [USER]))
      .rejects.toThrow(/retain at least one active owner/);
    expect((await pool.query(
      "select role,status from tenant_memberships where tenant_id=$1 and user_id=$2",
      [TENANT_A, USER],
    )).rows).toEqual([{ role: "owner", status: "active" }]);
    expect((await pool.query(
      "select count(*)::int as n from brian_auth_users_test where id=$1",
      [USER],
    )).rows[0].n).toBe(1);

    await pool.query(
      `insert into tenant_memberships (tenant_id,user_id,role,status,is_default)
       values ($1,$2,'admin','active',false)`,
      [TENANT_A, SECOND_OWNER],
    );
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "update tenant_memberships set role='owner' where tenant_id=$1 and user_id=$2",
        [TENANT_A, SECOND_OWNER],
      );
      await client.query(
        "update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",
        [TENANT_A, USER],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    expect((await pool.query(
      `select user_id from tenant_memberships
        where tenant_id=$1 and role='owner' and status='active'`,
      [TENANT_A],
    )).rows).toEqual([{ user_id: SECOND_OWNER }]);

    await expect(pool.query("delete from tenants where id=$1", [TENANT_A]))
      .resolves.toBeTruthy();
    expect((await pool.query(
      "select count(*)::int as n from tenant_memberships where tenant_id=$1",
      [TENANT_A],
    )).rows[0].n).toBe(0);
  });

  it("serializes concurrent active-owner losses and rejects the transaction that would orphan the tenant", async () => {
    await pool.query(
      `insert into tenant_memberships (tenant_id,user_id,role,status,is_default) values
       ($1,$2,'owner','active',true),
       ($1,$3,'owner','active',false)`,
      [TENANT_A, USER, SECOND_OWNER],
    );
    const first = await pool.connect();
    const second = await pool.connect();
    let firstOpen = false;
    let secondOpen = false;
    try {
      const firstPid = Number((await first.query("select pg_backend_pid() as pid")).rows[0].pid);
      const secondPid = Number((await second.query("select pg_backend_pid() as pid")).rows[0].pid);
      await first.query("begin");
      firstOpen = true;
      await second.query("begin");
      secondOpen = true;
      await first.query(
        "update tenant_memberships set status='suspended' where tenant_id=$1 and user_id=$2",
        [TENANT_A, USER],
      );

      const competingLoss = second.query(
        "update tenant_memberships set status='suspended' where tenant_id=$1 and user_id=$2",
        [TENANT_A, SECOND_OWNER],
      );
      await waitForBlock(secondPid, firstPid);

      await first.query("commit");
      firstOpen = false;
      await competingLoss;
      await expect(second.query("commit"))
        .rejects.toThrow(/retain at least one active owner/);
      await second.query("rollback").catch(() => undefined);
      secondOpen = false;
    } finally {
      if (firstOpen) await first.query("rollback").catch(() => undefined);
      if (secondOpen) await second.query("rollback").catch(() => undefined);
      first.release();
      second.release();
    }

    expect((await pool.query(
      `select user_id from tenant_memberships
        where tenant_id=$1 and role='owner' and status='active'`,
      [TENANT_A],
    )).rows).toEqual([{ user_id: SECOND_OWNER }]);
  });

  it("backfills skill-link tenancy from its skills and enforces both tenant agreements", async () => {
    await pool.query(
      `insert into skills (id,tenant_id,name,trigger,procedure) values
       ($1,$4,'__m010-a1','t','p'),
       ($2,$4,'__m010-a2','t','p'),
       ($3,$5,'__m010-b','t','p')`,
      [SKILL_A1, SKILL_A2, SKILL_B, TENANT_A, TENANT_B],
    );
    await expect(pool.query(
      `insert into skill_links (tenant_id,from_skill_id,to_skill_id,relation)
       values ($1,$2,$3,'__m010-same-tenant')`,
      [TENANT_A, SKILL_A1, SKILL_A2],
    )).resolves.toBeTruthy();
    await expect(pool.query(
      `insert into skill_links (tenant_id,from_skill_id,to_skill_id,relation)
       values ($1,$2,$3,'__m010-cross-tenant')`,
      [TENANT_A, SKILL_A1, SKILL_B],
    )).rejects.toThrow(/foreign key constraint/);

    // Model the prerelease shape that had a mutable tenant_id but no
    // composite skill/tenant constraints. Replay must repair it safely.
    await pool.query(
      `alter table skill_links
         drop constraint skill_links_from_skill_tenant_fkey,
         drop constraint skill_links_to_skill_tenant_fkey`,
    );
    await pool.query(
      "update skill_links set tenant_id=$1 where relation='__m010-same-tenant'",
      [TENANT_B],
    );
    await runMigrations(pool);
    expect((await pool.query(
      "select tenant_id from skill_links where relation='__m010-same-tenant'",
    )).rows).toEqual([{ tenant_id: TENANT_A }]);
    await expect(pool.query(
      `insert into skill_links (tenant_id,from_skill_id,to_skill_id,relation)
       values ($1,$2,$3,'__m010-cross-tenant-after-replay')`,
      [TENANT_A, SKILL_A1, SKILL_B],
    )).rejects.toThrow(/foreign key constraint/);
  });

  it("installs deferred ownership checks, indexed foreign keys, optimized policies, and append-only audit grants", async () => {
    const triggers = await pool.query(
      `select tgname, tgdeferrable, tginitdeferred
         from pg_trigger
        where tgrelid='tenant_memberships'::regclass
          and tgname in ('brian_require_owner_after_delete','brian_require_owner_after_update')
        order by tgname`,
    );
    expect(triggers.rows).toEqual([
      { tgname: "brian_require_owner_after_delete", tgdeferrable: true, tginitdeferred: true },
      { tgname: "brian_require_owner_after_update", tgdeferrable: true, tginitdeferred: true },
    ]);

    const indexes = await pool.query(
      `select indexname from pg_indexes
        where schemaname=current_schema()
          and indexname in (
            'tenant_invitations_invited_by_idx',
            'skill_links_tenant_from_skill_idx',
            'skill_links_tenant_to_skill_idx'
          )
        order by indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "skill_links_tenant_from_skill_idx",
      "skill_links_tenant_to_skill_idx",
      "tenant_invitations_invited_by_idx",
    ]);

    const policies = await pool.query(
      `select tablename, qual, with_check
         from pg_policies
        where schemaname=current_schema() and policyname='tenant_isolation'
          and tablename in (
            'tenants','tenant_memberships','agent_connections',
            'tenant_invitations','security_audit_events','onboarding_state','skill_links'
          )`,
    );
    expect(policies.rows).toHaveLength(7);
    for (const policy of policies.rows) {
      expect(policy.qual).toMatch(/select[\s\S]*current_setting/i);
      expect(policy.with_check).toMatch(/select[\s\S]*current_setting/i);
    }

    const privileges = await pool.query(
      `select
         has_table_privilege('brian_app', 'security_audit_events', 'SELECT') as can_select,
         has_table_privilege('brian_app', 'security_audit_events', 'INSERT') as can_insert,
         has_table_privilege('brian_app', 'security_audit_events', 'UPDATE') as can_update,
         has_table_privilege('brian_app', 'security_audit_events', 'DELETE') as can_delete`,
    );
    expect(privileges.rows[0]).toEqual({
      can_select: true,
      can_insert: true,
      can_update: false,
      can_delete: false,
    });
  });

  it("is convergent", async () => {
    await runMigrations(pool);
  });
});
