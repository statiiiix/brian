import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import { runMigrations } from "./migrate.js";
import { pool } from "./pool.js";
import {
  processDueAccountDeletions,
  processDueCompanyDeletions,
  pruneRetention,
} from "../privacy/maintenance.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const OWNER = "14000000-0000-4000-8000-000000000001";
const SECOND = "14000000-0000-4000-8000-000000000002";
const TENANT_A = "14000000-0000-4000-8000-000000000011";
const TENANT_B = "14000000-0000-4000-8000-000000000012";

async function assertSafeTestSchema() {
  const schema = (await pool.query("select current_schema() as schema")).rows[0].schema;
  if (schema === "public") throw new Error("privacy migration tests require a non-public TEST_DATABASE_URL search_path");
}

async function cleanup() {
  await pool.query("delete from data_deletion_requests");
  await pool.query(
    "delete from security_audit_events where actor_user_id=any($1::uuid[]) or target_id like '__m014%'",
    [[OWNER, SECOND]],
  );
  await pool.query("delete from connectors where tenant_id in ($1,$2)", [TENANT_A, TENANT_B]);
  await pool.query("delete from api_tokens where tenant_id in ($1,$2)", [TENANT_A, TENANT_B]);
  await pool.query("delete from agent_connections where tenant_id in ($1,$2)", [TENANT_A, TENANT_B]);
  // Tenant deletion cascades memberships while satisfying the deferred
  // last-owner trigger from migration 010.
  await pool.query("delete from tenants where id in ($1,$2)", [TENANT_A, TENANT_B]);
  await pool.query("delete from tenant_memberships where user_id=any($1::uuid[])", [[OWNER, SECOND]]);
  await pool.query("delete from brian_auth_users_test where id=any($1::uuid[])", [[OWNER, SECOND]]);
}

async function seed() {
  await pool.query(
    `insert into brian_auth_users_test (id,email) values
      ($1,'__m014-owner@example.test'),($2,'__m014-second@example.test')`,
    [OWNER, SECOND],
  );
  await pool.query(
    `insert into tenants (id,name,slug) values
      ($1,'M014 A','__m014-a'),($2,'M014 B','__m014-b')`,
    [TENANT_A, TENANT_B],
  );
  await pool.query(
    `insert into tenant_memberships
      (tenant_id,user_id,role,status,is_default) values
      ($1,$3,'owner','active',true),
      ($1,$4,'admin','active',false),
      ($2,$3,'owner','active',false),
      ($2,$4,'admin','active',true)`,
    [TENANT_A, TENANT_B, OWNER, SECOND],
  );
}

async function asUser<T>(userId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id',$1,true)", [userId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

d("migration 014: privacy deletion lifecycle", () => {
  beforeAll(async () => {
    await assertSafeTestSchema();
    await runMigrations(pool);
  });
  beforeEach(async () => { await cleanup(); await seed(); });
  afterAll(async () => { await cleanup(); await pool.end(); });

  it("fails account scheduling closed when any company would lose its sole active owner", async () => {
    await expect(asUser(OWNER, (client) => client.query(
      "select * from request_data_deletion($1,$2,'account',30)",
      [OWNER, TENANT_A],
    ))).rejects.toThrow(/transfer ownership/);
    expect((await pool.query(
      "select count(*)::int as count from data_deletion_requests where target_user_id=$1",
      [OWNER],
    )).rows[0].count).toBe(0);
  });

  it("schedules account deletion across memberships and revokes only attributable credentials", async () => {
    await pool.query(
      "update tenant_memberships set role='owner' where user_id=$1 and tenant_id in ($2,$3)",
      [SECOND, TENANT_A, TENANT_B],
    );
    await pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,status,approved_at) values
        ($1,$3,'__m014-client-a','Client A','active',now()),
        ($2,$3,'__m014-client-b','Client B','active',now())`,
      [TENANT_A, TENANT_B, OWNER],
    );
    await pool.query(
      `insert into api_tokens
        (tenant_id,token_hash,label,expires_at,created_by_user_id) values
        ($1,repeat('a',64),'__m014-attributed',now()+interval '1 day',$3),
        ($2,repeat('b',64),'__m014-unattributed',now()+interval '1 day',null)`,
      [TENANT_A, TENANT_B, OWNER],
    );

    const result = await asUser(OWNER, (client) => client.query(
      "select * from request_data_deletion($1,$2,'account',30)",
      [OWNER, TENANT_A],
    ));
    expect(result.rows[0]).toMatchObject({ request_scope: "account", request_status: "pending" });
    expect((await pool.query(
      "select distinct status from agent_connections where user_id=$1",
      [OWNER],
    )).rows).toEqual([{ status: "revoked" }]);
    expect((await pool.query(
      "select label,revoked_at is not null as revoked from api_tokens where label like '__m014-%' order by label",
    )).rows).toEqual([
      { label: "__m014-attributed", revoked: true },
      { label: "__m014-unattributed", revoked: false },
    ]);
    expect((await pool.query(
      "select distinct status from tenants where id in ($1,$2)",
      [TENANT_A, TENANT_B],
    )).rows).toEqual([{ status: "active" }]);
  });

  it("serializes concurrent account scheduling into one request and one per-membership audit batch", async () => {
    await pool.query(
      "update tenant_memberships set role='owner' where user_id=$1 and tenant_id in ($2,$3)",
      [SECOND, TENANT_A, TENANT_B],
    );
    const schedule = () => asUser(OWNER, (client) => client.query(
      "select * from request_data_deletion($1,$2,'account',30)",
      [OWNER, TENANT_A],
    ));
    const [first, second] = await Promise.all([schedule(), schedule()]);
    expect(first.rows[0].request_id).toBe(second.rows[0].request_id);
    expect((await pool.query(
      `select count(*)::int as count from data_deletion_requests
        where scope='account' and target_user_id=$1 and status='pending'`,
      [OWNER],
    )).rows[0].count).toBe(1);
    expect((await pool.query(
      `select count(*)::int as count from security_audit_events
        where actor_user_id=$1 and event_type='privacy.account_deletion.scheduled'`,
      [OWNER],
    )).rows[0].count).toBe(2);
  });

  it("blocks replacement agent credentials until a pending account deletion is cancelled", async () => {
    await pool.query(
      "update tenant_memberships set role='owner' where user_id=$1 and tenant_id in ($2,$3)",
      [SECOND, TENANT_A, TENANT_B],
    );
    const scheduled = await asUser(OWNER, (client) => client.query(
      "select * from request_data_deletion($1,$2,'account',30)",
      [OWNER, TENANT_A],
    ));
    const requestId = scheduled.rows[0].request_id;
    await expect(pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,status)
       values ($1,$2,'__m014-replacement','Replacement','pending')`,
      [TENANT_A, OWNER],
    )).rejects.toMatchObject({
      code: "55000",
      constraint: "account_deletion_pending",
      message: expect.stringMatching(/account deletion is pending/),
    });
    await expect(pool.query(
      `insert into api_tokens
        (tenant_id,token_hash,label,expires_at,created_by_user_id)
       values ($1,repeat('d',64),'__m014-replacement',now()+interval '1 day',$2)`,
      [TENANT_A, OWNER],
    )).rejects.toThrow(/account deletion is pending/);

    const cancelled = await asUser(OWNER, (client) => client.query(
      "select * from cancel_data_deletion_request($1,$2)",
      [OWNER, requestId],
    ));
    expect(cancelled.rows[0].request_status).toBe("cancelled");
    await expect(pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,status)
       values ($1,$2,'__m014-replacement','Replacement','pending')`,
      [TENANT_A, OWNER],
    )).resolves.toBeDefined();
  });

  it("makes company scheduling owner-only, suspends access, erases connectors, and cancels without restoration", async () => {
    await pool.query(
      `insert into connectors (tenant_id,type,status,credentials,settings,cursor)
       values ($1,'__m014','connected','{"refresh_token":"secret"}','{"selected_page_ids":["secret"]}','{"cursor":"secret"}')`,
      [TENANT_A],
    );
    await pool.query(
      `insert into api_tokens (tenant_id,token_hash,label,expires_at)
       values ($1,repeat('c',64),'__m014-company',now()+interval '1 day')`,
      [TENANT_A],
    );
    await pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,status,approved_at)
       values ($1,$2,'__m014-company-client','Company Client','active',now())`,
      [TENANT_A, SECOND],
    );

    await expect(asUser(SECOND, (client) => client.query(
      "select * from request_data_deletion($1,$2,'company',30)",
      [SECOND, TENANT_A],
    ))).rejects.toThrow(/active owner/);

    const scheduled = await asUser(OWNER, (client) => client.query(
      "select * from request_data_deletion($1,$2,'company',30)",
      [OWNER, TENANT_A],
    ));
    const requestId = scheduled.rows[0].request_id;
    expect(scheduled.rows[0]).toMatchObject({ request_scope: "company", request_status: "pending" });
    expect((await pool.query("select status from tenants where id=$1", [TENANT_A])).rows[0].status)
      .toBe("suspended");
    expect((await pool.query(
      "select status,credentials,settings,cursor from connectors where tenant_id=$1",
      [TENANT_A],
    )).rows[0]).toEqual({ status: "disabled", credentials: {}, settings: {}, cursor: {} });
    await expect(pool.query(
      "update connectors set settings=$2::jsonb where tenant_id=$1",
      [TENANT_A, JSON.stringify({ selected_page_ids: ["blocked"] })],
    )).rejects.toMatchObject({ constraint: "company_deletion_pending" });
    expect((await pool.query(
      "select revoked_at is not null as revoked from api_tokens where label='__m014-company'",
    )).rows[0].revoked).toBe(true);

    const hidden = await asUser(SECOND, (client) => client.query(
      "select * from list_my_data_deletion_requests($1)", [SECOND],
    ));
    expect(hidden.rows).toEqual([]);
    const wrongCancel = await asUser(SECOND, (client) => client.query(
      "select * from cancel_data_deletion_request($1,$2)", [SECOND, requestId],
    ));
    expect(wrongCancel.rows).toEqual([]);

    const cancelled = await asUser(OWNER, (client) => client.query(
      "select * from cancel_data_deletion_request($1,$2)", [OWNER, requestId],
    ));
    expect(cancelled.rows[0].request_status).toBe("cancelled");
    expect((await pool.query("select status from tenants where id=$1", [TENANT_A])).rows[0].status)
      .toBe("active");
    expect((await pool.query(
      "select status,credentials,settings,cursor from connectors where tenant_id=$1",
      [TENANT_A],
    )).rows[0]).toEqual({ status: "disabled", credentials: {}, settings: {}, cursor: {} });
    expect((await pool.query(
      "select status from agent_connections where oauth_client_id='__m014-company-client'",
    )).rows[0].status).toBe("revoked");
  });

  it("erases settings when company deletion starts from an already-disabled connector", async () => {
    await pool.query(
      `insert into connectors (tenant_id,type,status,credentials,settings,cursor)
       values ($1,'__m014-terminal','disabled','{}','{}','{}')`,
      [TENANT_A],
    );
    // While active, a legacy terminal row can still contain stale selections.
    await pool.query(
      "update connectors set settings=$2::jsonb where tenant_id=$1 and type='__m014-terminal'",
      [TENANT_A, JSON.stringify({ selected_page_ids: ["stale-page"] })],
    );
    expect((await pool.query(
      "select settings from connectors where tenant_id=$1 and type='__m014-terminal'", [TENANT_A],
    )).rows[0].settings).toEqual({ selected_page_ids: ["stale-page"] });

    await asUser(OWNER, (client) => client.query(
      "select * from request_data_deletion($1,$2,'company',30)", [OWNER, TENANT_A],
    ));
    expect((await pool.query(
      "select status,credentials,settings,cursor from connectors where tenant_id=$1 and type='__m014-terminal'", [TENANT_A],
    )).rows[0]).toEqual({ status: "disabled", credentials: {}, settings: {}, cursor: {} });
  });

  it("keeps the table private, uses fixed function paths, and forbids runtime status mutation", async () => {
    const { rows } = await pool.query(
      `select
         has_table_privilege('brian_app',format('%I.data_deletion_requests',current_schema()),'select') as table_select,
         has_function_privilege('brian_app',format('%I.request_data_deletion(uuid,uuid,text,integer)',current_schema()),'execute') as request_execute,
         has_column_privilege('brian_app',format('%I.tenants',current_schema()),'status','update') as status_update,
         has_column_privilege('brian_app',format('%I.tenants',current_schema()),'name','update') as name_update,
         (select relrowsecurity from pg_class where oid='data_deletion_requests'::regclass) as rls`,
    );
    expect(rows[0]).toEqual({
      table_select: false,
      request_execute: true,
      status_update: false,
      name_update: true,
      rls: true,
    });

    const functions = await pool.query(
      `select p.proname, p.prosecdef, p.proconfig
         from pg_proc p
         join pg_namespace n on n.oid=p.pronamespace
        where n.nspname=current_schema()
          and p.proname in (
            'request_data_deletion','list_my_data_deletion_requests','cancel_data_deletion_request'
          )
        order by p.proname`,
    );
    expect(functions.rows).toHaveLength(3);
    for (const row of functions.rows) {
      expect(row.prosecdef).toBe(true);
      expect(row.proconfig).toEqual([`search_path=pg_catalog, ${
        (await pool.query("select current_schema() as schema")).rows[0].schema
      }`]);
    }
  });

  it("processes due account deletion through the admin boundary with a final ownership recheck", async () => {
    await pool.query(
      "update tenant_memberships set role='owner' where user_id=$1 and tenant_id in ($2,$3)",
      [SECOND, TENANT_A, TENANT_B],
    );
    const scheduled = await asUser(OWNER, (client) => client.query(
      "select * from request_data_deletion($1,$2,'account',30)",
      [OWNER, TENANT_A],
    ));
    const requestId = scheduled.rows[0].request_id;
    await pool.query(
      `update data_deletion_requests
          set created_at=statement_timestamp()-interval '31 days',
              scheduled_for=statement_timestamp()-interval '1 day'
        where id=$1`,
      [requestId],
    );

    const result = await processDueAccountDeletions({
      pool,
      limit: 10,
      admin: {
        deleteUser: async (userId) => {
          await pool.query("delete from brian_auth_users_test where id=$1", [userId]);
        },
      },
    });
    expect(result).toEqual({ processed: 1, failed: 0 });
    expect((await pool.query(
      "select status,target_user_id,completed_at is not null as completed from data_deletion_requests where id=$1",
      [requestId],
    )).rows[0]).toEqual({ status: "completed", target_user_id: null, completed: true });
    expect((await pool.query(
      "select count(*)::int as count from brian_auth_users_test where id=$1",
      [OWNER],
    )).rows[0].count).toBe(0);
  });

  it("deletes due company data in FK-safe order while retaining audit/request evidence", async () => {
    await pool.query(
      "insert into skills (tenant_id,name,trigger,procedure) values ($1,'__m014-skill','x','x')",
      [TENANT_A],
    );
    await pool.query(
      "insert into context_entries (tenant_id,content) values ($1,'__m014-context')",
      [TENANT_A],
    );
    const scheduled = await asUser(OWNER, (client) => client.query(
      "select * from request_data_deletion($1,$2,'company',30)",
      [OWNER, TENANT_A],
    ));
    const requestId = scheduled.rows[0].request_id;
    await pool.query(
      `update data_deletion_requests
          set created_at=statement_timestamp()-interval '31 days',
              scheduled_for=statement_timestamp()-interval '1 day'
        where id=$1`,
      [requestId],
    );

    expect(await processDueCompanyDeletions(pool, 10)).toBe(1);
    expect((await pool.query(
      "select count(*)::int as count from tenants where id=$1", [TENANT_A],
    )).rows[0].count).toBe(0);
    expect((await pool.query(
      "select tenant_id,status,completed_at is not null as completed from data_deletion_requests where id=$1",
      [requestId],
    )).rows[0]).toEqual({ tenant_id: null, status: "completed", completed: true });
    expect((await pool.query(
      "select tenant_id from security_audit_events where target_id=$1 and event_type='privacy.company_deletion.completed'",
      [requestId],
    )).rows[0]).toEqual({ tenant_id: null });
  });

  it("prunes audit/execution retention only through owner maintenance and records aggregate evidence", async () => {
    await pool.query(
      `insert into executions (tenant_id,outcome,created_at)
       values ($1,'__m014-old',statement_timestamp()-interval '181 days')`,
      [TENANT_A],
    );
    await pool.query(
      `insert into security_audit_events (tenant_id,event_type,target_id,created_at)
       values ($1,'__m014.old','__m014-old',statement_timestamp()-interval '366 days')`,
      [TENANT_A],
    );
    const result = await pruneRetention({
      pool,
      policy: { securityAuditDays: 365, executionDays: 180 },
      limit: 100,
    });
    expect(result.auditEvents).toBeGreaterThanOrEqual(1);
    expect(result.executions).toBeGreaterThanOrEqual(1);
    expect((await pool.query(
      "select count(*)::int as count from security_audit_events where event_type='privacy.retention.pruned'",
    )).rows[0].count).toBeGreaterThanOrEqual(1);
  });
});
