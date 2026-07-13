import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { hashToken } from "../auth/apiTokens.js";
import { runMigrations } from "./migrate.js";
import { pool } from "./pool.js";

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.APP_TEST_DATABASE_URL;
const dbDescribe = ownerUrl ? describe : describe.skip;
const appIt = appUrl ? it : it.skip;

const TENANT_A = "13000000-0000-4000-8000-000000000001";
const TENANT_B = "13000000-0000-4000-8000-000000000002";

async function cleanup(): Promise<void> {
  await pool.query("delete from api_tokens where label like '__m013%'");
  await pool.query("delete from tenants where id in ($1,$2)", [TENANT_A, TENANT_B]);
}

async function seedTenants(): Promise<void> {
  await pool.query(
    `insert into tenants (id,name,slug) values
      ($1,'M013 A','__m013-a'),($2,'M013 B','__m013-b')`,
    [TENANT_A, TENANT_B],
  );
}

async function insertToken(input: {
  tenantId: string;
  plaintext: string;
  label: string;
  created?: string;
  expires?: string | null;
  revoked?: boolean;
}): Promise<void> {
  await pool.query(
    `insert into api_tokens
      (tenant_id,token_hash,label,created_at,expires_at,revoked_at)
     values ($1,$2,$3,coalesce($4::timestamptz,now()),$5::timestamptz,
       case when $6 then now() else null end)`,
    [
      input.tenantId,
      hashToken(input.plaintext),
      input.label,
      input.created ?? null,
      input.expires ?? null,
      input.revoked ?? false,
    ],
  );
}

dbDescribe("migration 013: legacy-token retirement controls", () => {
  beforeAll(async () => {
    const schema = (await pool.query("select current_schema() as schema")).rows[0].schema;
    if (schema === "public") throw new Error("migration 013 tests require a non-public TEST_DATABASE_URL");
    await runMigrations(pool);
  });
  beforeEach(async () => {
    await cleanup();
    await seedTenants();
  });
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it("adds nullable lifecycle columns, a safe constraint, and a partial report index", async () => {
    const columns = await pool.query(
      `select column_name,is_nullable
         from information_schema.columns
        where table_schema=current_schema() and table_name='api_tokens'
          and column_name in ('last_used_at','expires_at')
        order by column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: "expires_at", is_nullable: "YES" },
      { column_name: "last_used_at", is_nullable: "YES" },
    ]);
    expect((await pool.query(
      `select count(*)::int as count from pg_constraint
        where conname='api_tokens_expiry_after_creation'
          and conrelid='api_tokens'::regclass`,
    )).rows[0].count).toBe(1);
    const index = (await pool.query(
      `select indexdef from pg_indexes
        where schemaname=current_schema() and indexname='api_tokens_active_retirement_idx'`,
    )).rows[0].indexdef as string;
    expect(index).toContain("WHERE (revoked_at IS NULL)");
  });

  it("exposes only non-secret active credential metadata through a security-invoker view", async () => {
    const viewColumns = (await pool.query(
      `select column_name from information_schema.columns
        where table_schema=current_schema() and table_name='legacy_token_migration_report'
        order by ordinal_position`,
    )).rows.map((row) => row.column_name);
    expect(viewColumns).toEqual([
      "token_id", "tenant_id", "tenant_name", "tenant_slug", "tenant_status",
      "label", "created_at", "last_used_at", "expires_at", "has_no_expiry", "usage_state",
    ]);
    expect(viewColumns).not.toContain("token_hash");
    const options = (await pool.query(
      "select reloptions from pg_class where oid='legacy_token_migration_report'::regclass",
    )).rows[0].reloptions as string[];
    expect(options).toEqual(expect.arrayContaining(["security_invoker=true", "security_barrier=true"]));

    await insertToken({ tenantId: TENANT_A, plaintext: "m013-null", label: "__m013 active null" });
    await insertToken({
      tenantId: TENANT_A,
      plaintext: "m013-future",
      label: "__m013 active future",
      expires: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await insertToken({
      tenantId: TENANT_A,
      plaintext: "m013-expired",
      label: "__m013 expired",
      created: new Date(Date.now() - 172_800_000).toISOString(),
      expires: new Date(Date.now() - 86_400_000).toISOString(),
    });
    await insertToken({
      tenantId: TENANT_A,
      plaintext: "m013-revoked",
      label: "__m013 revoked",
      revoked: true,
    });

    // Re-running the convergent migration must not assign an expiry to an
    // existing compatibility token.
    await runMigrations(pool);
    expect((await pool.query(
      "select expires_at from api_tokens where label='__m013 active null'",
    )).rows).toEqual([{ expires_at: null }]);

    const report = await pool.query(
      `select * from legacy_token_migration_report
        where tenant_id=$1 order by label`,
      [TENANT_A],
    );
    expect(report.rows.map((row) => ({
      label: row.label,
      hasNoExpiry: row.has_no_expiry,
      usageState: row.usage_state,
    }))).toEqual([
      { label: "__m013 active future", hasNoExpiry: false, usageState: "never_used" },
      { label: "__m013 active null", hasNoExpiry: true, usageState: "never_used" },
    ]);
    for (const row of report.rows) expect(Object.keys(row)).not.toContain("token_hash");
  });

  it("keeps the resolver volatile, narrow, and unavailable to public browser roles", async () => {
    const routine = (await pool.query(
      `select p.provolatile,p.prosecdef,p.proconfig
         from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname=current_schema() and p.proname='resolve_legacy_agent_token'`,
    )).rows[0];
    expect(routine.provolatile).toBe("v");
    expect(routine.prosecdef).toBe(true);
    expect(routine.proconfig).toContain(`search_path=pg_catalog, ${
      (await pool.query("select current_schema() as schema")).rows[0].schema
    }`);

    const routineGrants = (await pool.query(
      `select grantee,privilege_type from information_schema.routine_privileges
        where specific_schema=current_schema() and routine_name='resolve_legacy_agent_token'`,
    )).rows;
    expect(routineGrants).toContainEqual({ grantee: "brian_app", privilege_type: "EXECUTE" });
    expect(routineGrants.some((grant) => ["PUBLIC", "anon", "authenticated"].includes(grant.grantee)))
      .toBe(false);

    const viewGrants = (await pool.query(
      `select grantee,privilege_type from information_schema.role_table_grants
        where table_schema=current_schema() and table_name='legacy_token_migration_report'`,
    )).rows;
    expect(viewGrants).toContainEqual({ grantee: "brian_app", privilege_type: "SELECT" });
    expect(viewGrants.some((grant) => ["PUBLIC", "anon", "authenticated"].includes(grant.grantee)))
      .toBe(false);

    const columnPrivileges = (await pool.query(
      `select
         has_column_privilege('brian_app',format('%I.api_tokens',current_schema()),'token_hash','select') as hash_select,
         has_column_privilege('brian_app',format('%I.api_tokens',current_schema()),'label','select') as label_select`,
    )).rows[0];
    expect(columnPrivileges).toEqual({ hash_select: false, label_select: true });
  });

  appIt("keeps the report tenant-scoped for brian_app and denies direct hash reads", async () => {
    await insertToken({ tenantId: TENANT_A, plaintext: "m013-a", label: "__m013 tenant a" });
    await insertToken({ tenantId: TENANT_B, plaintext: "m013-b", label: "__m013 tenant b" });
    const appPool = new pg.Pool({ connectionString: appUrl! });
    const client = await appPool.connect();
    try {
      const identity = await client.query(
        "select current_user,current_schema(),rolbypassrls from pg_roles where rolname=current_user",
      );
      expect(identity.rows[0]).toMatchObject({ current_schema: "test", rolbypassrls: false });
      expect(identity.rows[0].current_user).not.toBe("postgres");

      await client.query("begin");
      await client.query("select set_config('app.tenant_id',$1,true)", [TENANT_A]);
      expect((await client.query(
        "select tenant_id,label from legacy_token_migration_report order by label",
      )).rows).toEqual([{ tenant_id: TENANT_A, label: "__m013 tenant a" }]);
      await expect(client.query("select token_hash from api_tokens"))
        .rejects.toThrow(/permission denied/);
      await client.query("rollback");
    } finally {
      client.release();
      await appPool.end();
    }
  });
});
