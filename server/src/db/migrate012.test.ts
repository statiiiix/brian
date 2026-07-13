import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "./migrate.js";
import { pool } from "./pool.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const USER = "12000000-0000-4000-8000-000000000001";
const OTHER_USER = "12000000-0000-4000-8000-000000000002";
const TENANT = "12000000-0000-4000-8000-000000000010";
const SECOND_TENANT = "12000000-0000-4000-8000-000000000011";
const CLIENT = "m012-oauth-client";

async function assertSafeTestSchema() {
  const schema = (await pool.query("select current_schema() as s")).rows[0].s;
  if (schema === "public") throw new Error("OAuth migration tests require a non-public TEST_DATABASE_URL search_path");
}

async function cleanup() {
  await pool.query("delete from security_audit_events where actor_user_id in ($1,$2) or tenant_id in ($3,$4)", [USER, OTHER_USER, TENANT, SECOND_TENANT]);
  await pool.query("delete from agent_connections where user_id in ($1,$2)", [USER, OTHER_USER]);
  await pool.query("delete from tenant_invitations where invited_by in ($1,$2) or tenant_id in ($3,$4)", [USER, OTHER_USER, TENANT, SECOND_TENANT]);
  await pool.query("delete from oauth_states where tenant_id in ($1,$2) or provider='__m012'", [TENANT, SECOND_TENANT]);
  await pool.query("delete from tenant_memberships where user_id in ($1,$2)", [USER, OTHER_USER]);
  await pool.query("delete from api_tokens where label like '__m012%'");
  await pool.query("delete from brian_auth_users_test where id in ($1,$2)", [USER, OTHER_USER]);
  await pool.query("delete from tenants where id in ($1,$2)", [TENANT, SECOND_TENANT]);
}

async function seedPrincipal() {
  await pool.query(
    `insert into app_config (key,value) values ('PUBLIC_SIGNUP_ENABLED','false')
     on conflict (key) do update set value='false'`,
  );
  await pool.query(
    `insert into brian_auth_users_test (id,email) values
      ($1,'__m012-user@example.test'),($2,'__m012-other@example.test')`,
    [USER, OTHER_USER],
  );
  await pool.query(
    "insert into tenants (id,name,slug) values ($1,'M012 Tenant','__m012-tenant')",
    [TENANT],
  );
  await pool.query(
    `insert into tenant_memberships (tenant_id,user_id,role,status,is_default)
     values ($1,$2,'expert','active',true)`,
    [TENANT, USER],
  );
}

async function withAppUser<T>(
  userId: string,
  fn: (client: any) => Promise<T>,
  commit = false,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id',$1,true)", [userId]);
    const result = await fn(client);
    await client.query(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function oauthEvent() {
  return {
    user_id: USER,
    authentication_method: "oauth_provider/authorization_code",
    claims: { sub: USER, aud: "authenticated", role: "authenticated", client_id: CLIENT },
  };
}

d("migration 012: OAuth claims and narrow principal resolution", () => {
  beforeAll(async () => {
    await assertSafeTestSchema();
    await runMigrations(pool);
  });
  beforeEach(async () => {
    await cleanup();
    await seedPrincipal();
  });
  afterAll(async () => { await cleanup(); await pool.end(); });

  it("leaves non-OAuth access-token events unchanged", async () => {
    const event = { user_id: USER, authentication_method: "password", claims: { sub: USER, aud: "authenticated" } };
    const { rows } = await pool.query("select custom_access_token_hook($1::jsonb) as event", [JSON.stringify(event)]);
    expect(rows[0].event).toEqual(event);
  });

  it("activates one pending grant and emits exact MCP claims", async () => {
    const connection = await pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,permissions)
       values ($1,$2,$3,'M012 Agent',array['skills:read','executions:write'])
       returning id`,
      [TENANT, USER, CLIENT],
    );
    const { rows } = await pool.query("select custom_access_token_hook($1::jsonb) as event", [JSON.stringify(oauthEvent())]);
    expect(rows[0].event.claims).toMatchObject({
      aud: "https://api.brianthebrain.app/mcp",
      tenant_id: TENANT,
      brian_role: "expert",
      brian_permissions: ["skills:read", "executions:write"],
      brian_connection_id: connection.rows[0].id,
      brian_resource: "https://api.brianthebrain.app/mcp",
      brian_token_type: "mcp",
      client_id: CLIENT,
    });
    expect((await pool.query(
      "select status,approved_at is not null as approved from agent_connections where id=$1",
      [connection.rows[0].id],
    )).rows[0]).toEqual({ status: "active", approved: true });
    expect((await pool.query(
      `select connection_id,event_type,target_id from security_audit_events
        where event_type='agent_connection.activated' and target_id=$1`,
      [connection.rows[0].id],
    )).rows).toEqual([{
      connection_id: connection.rows[0].id,
      event_type: "agent_connection.activated",
      target_id: connection.rows[0].id,
    }]);
  });

  it("fails token issuance when the grant is absent or revoked", async () => {
    await expect(pool.query("select custom_access_token_hook($1::jsonb)", [JSON.stringify(oauthEvent())]))
      .rejects.toThrow(/absent, inactive, or ambiguous/);

    await pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,permissions,status,approved_at,revoked_at)
       values ($1,$2,$3,'Revoked',array['skills:read'],'revoked',now(),now())`,
      [TENANT, USER, CLIENT],
    );
    await expect(pool.query("select custom_access_token_hook($1::jsonb)", [JSON.stringify(oauthEvent())]))
      .rejects.toThrow(/absent, inactive, or ambiguous/);
  });

  it("resolves dashboard and MCP principals only for the matching app.user_id", async () => {
    const connection = await pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,permissions,status,approved_at)
       values ($1,$2,$3,'Active',array['skills:read'],'active',now()) returning id`,
      [TENANT, USER, CLIENT],
    );
    const allowed = await withAppUser(USER, async (client) => ({
      dashboard: (await client.query("select * from resolve_dashboard_principal($1,null)", [USER])).rows,
      memberships: (await client.query("select * from list_user_memberships($1)", [USER])).rows,
      mcp: (await client.query("select * from resolve_mcp_principal($1,$2,$3)", [USER, TENANT, CLIENT])).rows,
    }));
    expect(allowed.dashboard).toHaveLength(1);
    expect(allowed.dashboard[0]).toMatchObject({ tenant_id: TENANT, user_id: USER, role: "expert" });
    expect(allowed.memberships).toEqual([expect.objectContaining({
      tenant_id: TENANT, tenant_name: "M012 Tenant", tenant_slug: "__m012-tenant",
      role: "expert", is_default: true,
    })]);
    expect(allowed.mcp).toEqual([{
      tenant_id: TENANT,
      user_id: USER,
      role: "expert",
      permissions: ["skills:read"],
      connection_id: connection.rows[0].id,
    }]);

    const denied = await withAppUser(OTHER_USER, async (client) =>
      (await client.query("select * from resolve_mcp_principal($1,$2,$3)", [USER, TENANT, CLIENT])).rows,
    );
    expect(denied).toEqual([]);
  });

  it("fails closed for suspended membership or tenant", async () => {
    await pool.query(
      `insert into agent_connections
        (tenant_id,user_id,oauth_client_id,client_name,permissions,status,approved_at)
       values ($1,$2,$3,'Active',array['skills:read'],'active',now())`,
      [TENANT, USER, CLIENT],
    );
    await pool.query("update tenant_memberships set status='suspended' where tenant_id=$1 and user_id=$2", [TENANT, USER]);
    expect(await withAppUser(USER, async (c) =>
      (await c.query("select * from resolve_mcp_principal($1,$2,$3)", [USER, TENANT, CLIENT])).rows,
    )).toEqual([]);
    await pool.query("update tenant_memberships set status='active' where tenant_id=$1 and user_id=$2", [TENANT, USER]);
    await pool.query("update tenants set status='suspended' where id=$1", [TENANT]);
    expect(await withAppUser(USER, async (c) =>
      (await c.query("select * from resolve_dashboard_principal($1,$2)", [USER, TENANT])).rows,
    )).toEqual([]);
  });

  it("resolves an exact active legacy token hash without broad table visibility", async () => {
    const tokenHash = "c".repeat(64);
    await pool.query(
      "insert into api_tokens (tenant_id,token_hash,label) values ($1,$2,'__m012 legacy')",
      [TENANT, tokenHash],
    );
    expect((await pool.query("select * from resolve_legacy_agent_token($1)", [tokenHash])).rows)
      .toEqual([{ tenant_id: TENANT, connection_id: null }]);
    await pool.query("update api_tokens set revoked_at=now() where token_hash=$1", [tokenHash]);
    expect((await pool.query("select * from resolve_legacy_agent_token($1)", [tokenHash])).rows).toEqual([]);
  });

  it("consumes an exact OAuth state hash once through the narrow resolver", async () => {
    const stateHash = "e".repeat(64);
    await pool.query(
      `insert into oauth_states
        (tenant_id,provider,connector_types,state_hash,expires_at)
       values ($1,'__m012','["gmail"]'::jsonb,$2,now()+interval '5 minutes')`,
      [TENANT, stateHash],
    );
    expect((await pool.query("select * from consume_oauth_state($1)", [stateHash])).rows)
      .toEqual([{ tenant_id: TENANT, provider: "__m012", connector_types: ["gmail"] }]);
    expect((await pool.query("select * from consume_oauth_state($1)", [stateHash])).rows).toEqual([]);
    expect((await pool.query("select * from consume_oauth_state('invalid')")).rows).toEqual([]);
  });

  it("consumes an invitation once and only for the authenticated matching email", async () => {
    const tokenHash = "d".repeat(64);
    await pool.query(
      "insert into tenants (id,name,slug) values ($1,'M012 Second','__m012-second')",
      [SECOND_TENANT],
    );
    await pool.query(
      `insert into tenant_invitations
        (tenant_id,email,role,token_hash,invited_by,expires_at)
       values ($1,'__m012-user@example.test','viewer',$2,$3,now()+interval '1 hour')`,
      [SECOND_TENANT, tokenHash, USER],
    );
    const accepted = await withAppUser(
      USER,
      async (client) =>
        (await client.query("select * from consume_tenant_invitation($1,$2)", [USER, tokenHash])).rows,
      true,
    );
    expect(accepted).toEqual([{ tenant_id: SECOND_TENANT, role: "viewer" }]);
    expect(await withAppUser(USER, async (client) =>
      (await client.query("select * from consume_tenant_invitation($1,$2)", [USER, tokenHash])).rows,
    )).toEqual([]);
    expect(await withAppUser(OTHER_USER, async (client) =>
      (await client.query("select * from consume_tenant_invitation($1,$2)", [USER, tokenHash])).rows,
    )).toEqual([]);
  });

  it("revokes PUBLIC execution and grants only the intended server functions", async () => {
    const { rows } = await pool.query(
      `select routine_name, grantee
         from information_schema.routine_privileges
        where specific_schema=current_schema()
          and routine_name in (
            'resolve_dashboard_principal','list_user_memberships','resolve_mcp_principal',
            'resolve_legacy_agent_token','consume_oauth_state','consume_tenant_invitation',
            'custom_access_token_hook'
          )`,
    );
    expect(rows.some((r) => r.grantee === "PUBLIC")).toBe(false);
    for (const name of [
      "resolve_dashboard_principal", "list_user_memberships", "resolve_mcp_principal",
      "resolve_legacy_agent_token", "consume_oauth_state", "consume_tenant_invitation",
    ]) {
      expect(rows).toContainEqual(expect.objectContaining({ routine_name: name, grantee: "brian_app" }));
    }
    expect(rows).not.toContainEqual(expect.objectContaining({ routine_name: "custom_access_token_hook", grantee: "brian_app" }));
  });
});
