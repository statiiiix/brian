import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";
import { pool } from "./pool.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const FOUNDING = "00000000-0000-0000-0000-000000000001";
const FOUNDING_GUARD = "11000000-0000-4000-8000-000000000002";
const INVITER = "11000000-0000-4000-8000-000000000001";
const IDS = Array.from({ length: 10 }, (_, i) =>
  `11000000-0000-4000-8000-${String(i + 10).padStart(12, "0")}`,
);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function assertSafeTestSchema() {
  const schema = (await pool.query("select current_schema() as s")).rows[0].s;
  if (schema === "public") throw new Error("signup migration tests require a non-public TEST_DATABASE_URL search_path");
}

async function signupEnabled(enabled: boolean) {
  await pool.query(
    `insert into app_config (key,value) values ('PUBLIC_SIGNUP_ENABLED',$1)
     on conflict (key) do update set value=excluded.value`,
    [enabled ? "true" : "false"],
  );
}

async function ensureFoundingOwner() {
  await signupEnabled(false);
  await pool.query(
    `insert into brian_auth_users_test (id,email)
     values ($1,'__m011-founding-guard@example.test')
     on conflict (id) do nothing`,
    [FOUNDING_GUARD],
  );
  await pool.query(
    `insert into tenant_memberships (tenant_id,user_id,role,status,is_default)
     values ($1,$2,'owner','active',true)
     on conflict (tenant_id,user_id) do update
       set role='owner',status='active',is_default=true`,
    [FOUNDING, FOUNDING_GUARD],
  );
}

async function cleanup() {
  // A stable test-only founding owner lets cleanup remove temporary owner
  // fixtures without weakening the production last-owner constraint.
  await ensureFoundingOwner();
  await pool.query("delete from security_audit_events where actor_user_id = any($1::uuid[]) or metadata->>'test'='m011'", [[INVITER, ...IDS]]);
  await pool.query("delete from tenant_invitations where invited_by=$1 or email::text like '__m011-%'", [INVITER]);
  await pool.query("delete from agent_connections where user_id = any($1::uuid[])", [IDS]);
  await pool.query("delete from tenants where slug like '__m011-%' or name like '__m011 %'");
  await pool.query("delete from tenant_memberships where user_id = any($1::uuid[])", [[INVITER, ...IDS]]);
  await pool.query("delete from brian_auth_users_test where id = any($1::uuid[])", [[INVITER, ...IDS]]);
}

d("migration 011: signup and invitation provisioning", () => {
  beforeAll(async () => {
    await assertSafeTestSchema();
    await runMigrations(pool);
    await ensureFoundingOwner();
  });
  beforeEach(async () => {
    await cleanup();
    await pool.query(
      "insert into brian_auth_users_test (id,email) values ($1,'__m011-inviter@example.test')",
      [INVITER],
    );
  });
  afterAll(async () => { await cleanup(); await pool.end(); });

  it("self-signup creates exactly one tenant, owner membership, onboarding row, and audit event", async () => {
    await signupEnabled(true);
    await pool.query(
      `insert into brian_auth_users_test (id,email,raw_user_meta_data)
       values ($1,'__m011-owner@example.test',$2::jsonb)`,
      [IDS[0], JSON.stringify({
        company_name: "__m011 Safe Company",
        tenant_id: FOUNDING,
        role: "viewer",
        is_admin: true,
      })],
    );
    const { rows } = await pool.query(
      `select m.tenant_id,m.role,m.status,m.is_default,t.name,t.slug,
              o.current_step,o.completed,o.first_mcp_call_at
         from tenant_memberships m
         join tenants t on t.id=m.tenant_id
         join onboarding_state o on o.tenant_id=m.tenant_id
        where m.user_id=$1`,
      [IDS[0]],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      role: "owner", status: "active", is_default: true,
      name: "__m011 Safe Company", current_step: 1,
      completed: false, first_mcp_call_at: null,
    });
    expect(rows[0].tenant_id).not.toBe(FOUNDING);
    expect(rows[0].slug).toMatch(/^m011-safe-company/);
    expect((await pool.query(
      "select count(*)::int as n from security_audit_events where actor_user_id=$1 and event_type='tenant.self_signup_created'",
      [IDS[0]],
    )).rows[0].n).toBe(1);

    // Updating attacker-controlled metadata cannot move the existing user.
    await pool.query(
      "update brian_auth_users_test set raw_user_meta_data=$2::jsonb where id=$1",
      [IDS[0], JSON.stringify({ company_name: "Changed", tenant_id: FOUNDING, role: "admin" })],
    );
    expect((await pool.query(
      "select count(*)::int as n from tenant_memberships where user_id=$1",
      [IDS[0]],
    )).rows[0].n).toBe(1);
  });

  it("creates collision-safe slugs for equal company names", async () => {
    await signupEnabled(true);
    for (const id of [IDS[1], IDS[2]]) {
      await pool.query(
        `insert into brian_auth_users_test (id,email,raw_user_meta_data)
         values ($1,$2,$3::jsonb)`,
        [id, `__m011-${id.slice(-2)}@example.test`, JSON.stringify({ company_name: "__m011 Collision" })],
      );
    }
    const { rows } = await pool.query(
      `select t.slug from tenants t join tenant_memberships m on m.tenant_id=t.id
        where m.user_id=any($1::uuid[]) order by t.slug`,
      [[IDS[1], IDS[2]]],
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(2);
    expect(rows.every((r) => r.slug.startsWith("m011-collision"))).toBe(true);
  });

  it("does not self-provision while the public-signup flag is off", async () => {
    await signupEnabled(false);
    await pool.query(
      `insert into brian_auth_users_test (id,email,raw_user_meta_data)
       values ($1,'__m011-disabled@example.test',$2::jsonb)`,
      [IDS[3], JSON.stringify({ company_name: "__m011 Disabled" })],
    );
    expect((await pool.query(
      "select count(*)::int as n from tenant_memberships where user_id=$1",
      [IDS[3]],
    )).rows[0].n).toBe(0);
    const report = await pool.query("select * from identity_membership_report where user_id=$1", [IDS[3]]);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].active_memberships).toBe(0);
  });

  it("uses only a valid invitation to choose its tenant and role", async () => {
    await signupEnabled(false);
    const target = "11000000-0000-4000-8000-000000000099";
    const rawToken = "m011-valid-invitation-token";
    await pool.query(
      "insert into tenants (id,name,slug) values ($1,'__m011 Invited','__m011-invited')",
      [target],
    );
    await pool.query(
      `insert into tenant_invitations
        (tenant_id,email,role,token_hash,invited_by,expires_at)
       values ($1,'__m011-invitee@example.test','expert',$2,$3,now()+interval '1 hour')`,
      [target, hash(rawToken), INVITER],
    );
    await pool.query(
      `insert into brian_auth_users_test (id,email,raw_user_meta_data,raw_app_meta_data)
       values ($1,'__m011-invitee@example.test',$2::jsonb,$3::jsonb)`,
      [IDS[4], JSON.stringify({ tenant_id: FOUNDING, role: "owner" }),
        JSON.stringify({ brian_invitation_token_hash: hash(rawToken) })],
    );
    const membership = await pool.query(
      "select tenant_id,role,status from tenant_memberships where user_id=$1",
      [IDS[4]],
    );
    expect(membership.rows).toEqual([{ tenant_id: target, role: "expert", status: "active" }]);
    expect((await pool.query(
      "select accepted_at is not null as accepted from tenant_invitations where tenant_id=$1",
      [target],
    )).rows[0].accepted).toBe(true);
  });

  it("preflights only an active email-bound invitation without exposing its tenant or role", async () => {
    const target = "11000000-0000-4000-8000-000000000097";
    const rawToken = "m011-browser-preflight-token";
    await pool.query(
      "insert into tenants (id,name,slug) values ($1,'__m011 Preflight','__m011-preflight')",
      [target],
    );
    await pool.query(
      `insert into tenant_invitations
        (tenant_id,email,role,token_hash,invited_by,expires_at)
       values ($1,'__m011-preflight@example.test','admin',$2,$3,now()+interval '1 hour')`,
      [target, hash(rawToken), INVITER],
    );
    const result = await pool.query(
      `select
         is_valid_tenant_invitation('__m011-preflight@example.test',$1) as exact,
         is_valid_tenant_invitation('other@example.test',$1) as wrong_email,
         is_valid_tenant_invitation('__m011-preflight@example.test',repeat('0',64)) as wrong_token`,
      [hash(rawToken)],
    );
    expect(result.rows[0]).toEqual({ exact: true, wrong_email: false, wrong_token: false });
    const { rows } = await pool.query(
      `select
         has_function_privilege('brian_app',format('%I.is_valid_tenant_invitation(text,text)',current_schema()),'execute') as runtime_execute,
         has_function_privilege('public',format('%I.is_valid_tenant_invitation(text,text)',current_schema()),'execute') as public_execute`,
    );
    expect(rows[0]).toEqual({ runtime_execute: true, public_execute: false });
  });

  it("fails an expired invitation instead of silently creating another company", async () => {
    await signupEnabled(true);
    const target = "11000000-0000-4000-8000-000000000098";
    const rawToken = "m011-expired-invitation-token";
    await pool.query(
      "insert into tenants (id,name,slug) values ($1,'__m011 Expired','__m011-expired')",
      [target],
    );
    await pool.query(
      `insert into tenant_invitations
        (tenant_id,email,role,token_hash,invited_by,created_at,expires_at)
       values ($1,'__m011-expired@example.test','viewer',$2,$3,
               now()-interval '2 hours',now()-interval '1 hour')`,
      [target, hash(rawToken), INVITER],
    );
    await expect(pool.query(
      `insert into brian_auth_users_test (id,email,raw_user_meta_data,raw_app_meta_data)
       values ($1,'__m011-expired@example.test',$2::jsonb,$3::jsonb)`,
      [IDS[5], JSON.stringify({ company_name: "Should Not Exist" }),
        JSON.stringify({ brian_invitation_token_hash: hash(rawToken) })],
    )).rejects.toThrow(/invalid or expired Brian invitation/);
    expect((await pool.query("select count(*)::int as n from brian_auth_users_test where id=$1", [IDS[5]])).rows[0].n)
      .toBe(0);
  });

  it("defers browser invitation signup without persisting or trusting the raw token", async () => {
    await signupEnabled(true);
    await pool.query(
      `insert into brian_auth_users_test (id,email,raw_user_meta_data)
       values ($1,'__m011-browser-invite@example.test',$2::jsonb)`,
      [IDS[7], JSON.stringify({
        brian_invitation_signup: true,
        company_name: "Must Not Be Provisioned",
      })],
    );
    expect((await pool.query(
      "select count(*)::int as n from tenant_memberships where user_id=$1",
      [IDS[7]],
    )).rows[0].n).toBe(0);
    const metadata = (await pool.query(
      "select raw_user_meta_data from brian_auth_users_test where id=$1",
      [IDS[7]],
    )).rows[0].raw_user_meta_data;
    expect(metadata.brian_invitation_signup).toBe(true);
    expect(metadata.invitation_token).toBeUndefined();
  });

  it("preserves the exact role for future trusted app_metadata provisioning", async () => {
    await signupEnabled(false);
    const client = await pool.connect();
    try {
      await client.query("begin");
      // Prove this is not accidentally relying on an already-present owner:
      // the deferred invariant permits a temporary transfer window, while the
      // provisioning trigger must still preserve the requested admin role.
      await client.query(
        "update tenant_memberships set status='suspended' where tenant_id=$1 and user_id=$2",
        [FOUNDING, FOUNDING_GUARD],
      );
      await client.query(
        `insert into brian_auth_users_test (id,email,raw_app_meta_data)
         values ($1,'__m011-trusted@example.test',$2::jsonb)`,
        [IDS[6], JSON.stringify({ tenant_id: FOUNDING, role: "admin" })],
      );
      await client.query(
        "update tenant_memberships set status='active' where tenant_id=$1 and user_id=$2",
        [FOUNDING, FOUNDING_GUARD],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    expect((await pool.query(
      "select tenant_id,role from tenant_memberships where user_id=$1",
      [IDS[6]],
    )).rows).toEqual([{ tenant_id: FOUNDING, role: "admin" }]);
  });

  it("keeps the ranked legacy promotion for the earliest existing founding admin", async () => {
    await signupEnabled(false);
    await pool.query("alter table brian_auth_users_test disable trigger brian_provision_auth_user");
    try {
      await pool.query(
        `insert into brian_auth_users_test (id,email,raw_app_meta_data)
         values ($1,'__m011-backfill@example.test',$2::jsonb)`,
        [IDS[8], JSON.stringify({ tenant_id: FOUNDING, role: "admin" })],
      );
    } finally {
      await pool.query("alter table brian_auth_users_test enable trigger brian_provision_auth_user");
    }

    await runMigrations(pool);
    expect((await pool.query(
      "select tenant_id,role from tenant_memberships where user_id=$1",
      [IDS[8]],
    )).rows).toEqual([{ tenant_id: FOUNDING, role: "owner" }]);
  });

  it("is convergent", async () => {
    await runMigrations(pool);
  });
});
