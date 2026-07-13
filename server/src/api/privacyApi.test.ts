import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { buildApp } from "./app.js";
import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { testClient } from "../test/http.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const USER = "14100000-0000-4000-8000-000000000001";
const OTHER = "14100000-0000-4000-8000-000000000002";
const TENANT = "14100000-0000-4000-8000-000000000011";

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
function tokenFor(userId: string): string {
  return `${b64({ alg: "ES256" })}.${b64({
    iss: "https://x.supabase.co/auth/v1",
    sub: userId,
    aud: "authenticated",
  })}.sig`;
}

function bearer(userId: string) {
  return { authorization: `Bearer ${tokenFor(userId)}` };
}

function userFromAuthorization(value: string): string | null {
  try {
    const token = value.replace(/^Bearer /, "");
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub ?? null;
  } catch {
    return null;
  }
}

async function cleanup() {
  await pool.query(
    "delete from data_deletion_requests where requested_by_user_id=any($1::uuid[]) or tenant_id=$2",
    [[USER, OTHER], TENANT],
  );
  await pool.query(
    "delete from security_audit_events where actor_user_id=any($1::uuid[]) or tenant_id=$2",
    [[USER, OTHER], TENANT],
  );
  await pool.query("delete from agent_connections where tenant_id=$1", [TENANT]);
  await pool.query("delete from api_tokens where tenant_id=$1", [TENANT]);
  await pool.query("delete from connectors where tenant_id=$1", [TENANT]);
  await pool.query("delete from tenants where id=$1", [TENANT]);
  await pool.query("delete from tenant_memberships where user_id=any($1::uuid[])", [[USER, OTHER]]);
  await pool.query("delete from brian_auth_users_test where id=any($1::uuid[])", [[USER, OTHER]]);
}

d("privacy deletion API", () => {
  beforeAll(async () => {
    const schema = (await pool.query("select current_schema() as schema")).rows[0].schema;
    if (schema === "public") throw new Error("privacy API tests require an isolated test schema");
    await runMigrations(pool);
  });

  beforeEach(async () => {
    await cleanup();
    await pool.query(
      `insert into brian_auth_users_test(id,email) values
        ($1,'privacy-api-user@example.test'),($2,'privacy-api-other@example.test')`,
      [USER, OTHER],
    );
    await pool.query("insert into tenants(id,name,slug) values ($1,'Privacy API','__privacy-api')", [TENANT]);
    await pool.query(
      `insert into tenant_memberships(tenant_id,user_id,role,status,is_default) values
        ($1,$2,'owner','active',true),($1,$3,'owner','active',true)`,
      [TENANT, USER, OTHER],
    );
  });

  afterAll(async () => { await cleanup(); await pool.end(); });

  function client() {
    const fetchFn = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const userId = userFromAuthorization(headers.get("authorization") ?? "");
      if (userId === USER || userId === OTHER) {
        return new Response(JSON.stringify({
          id: userId,
          email: userId === USER
            ? "privacy-api-user@example.test"
            : "privacy-api-other@example.test",
        }));
      }
      return new Response("{}", { status: 401 });
    });
    return testClient(buildApp({
      authRequired: true,
      supabaseAuth: { url: "https://x.supabase.co", anonKey: "anon", fetchFn },
      mcpOAuth: null,
    }));
  }

  it("lets a viewer schedule only their own account deletion", async () => {
    await pool.query(
      "update tenant_memberships set role='viewer' where tenant_id=$1 and user_id=$2",
      [TENANT, USER],
    );
    const api = client();
    const invalid = await api.inject({
      method: "POST", url: "/api/privacy/deletion-requests", headers: bearer(USER),
      payload: { scope: "tenant", tenantId: OTHER },
    });
    expect(invalid.statusCode).toBe(400);

    const forbiddenCompany = await api.inject({
      method: "POST", url: "/api/privacy/deletion-requests", headers: bearer(USER),
      payload: { scope: "company" },
    });
    expect(forbiddenCompany.statusCode).toBe(403);

    const scheduled = await api.inject({
      method: "POST", url: "/api/privacy/deletion-requests", headers: bearer(USER),
      payload: { scope: "account", tenantId: OTHER, userId: OTHER },
    });
    expect(scheduled.statusCode).toBe(201);
    expect(scheduled.json().request).toMatchObject({ scope: "account", status: "pending" });
    expect(Object.keys(scheduled.json().request).sort()).toEqual([
      "cancelledAt", "completedAt", "createdAt", "id", "scheduledFor", "scope", "status",
    ]);
    expect((await pool.query(
      "select target_user_id from data_deletion_requests where id=$1",
      [scheduled.json().request.id],
    )).rows[0].target_user_id).toBe(USER);
    await api.close();
  });

  it("lists and cancels a company request after suspension without exposing it cross-user", async () => {
    const api = client();
    const scheduled = await api.inject({
      method: "POST", url: "/api/privacy/deletion-requests", headers: bearer(USER),
      payload: { scope: "company" },
    });
    expect(scheduled.statusCode).toBe(201);
    const requestId = scheduled.json().request.id;
    expect((await pool.query("select status from tenants where id=$1", [TENANT])).rows[0].status)
      .toBe("suspended");

    const hidden = await api.inject({
      method: "GET", url: "/api/privacy/deletion-requests", headers: bearer(OTHER),
    });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json()).toEqual({ requests: [] });
    const wrongCancel = await api.inject({
      method: "DELETE", url: `/api/privacy/deletion-requests/${requestId}`, headers: bearer(OTHER),
    });
    expect(wrongCancel.statusCode).toBe(404);
    expect((await pool.query("select status from tenants where id=$1", [TENANT])).rows[0].status)
      .toBe("suspended");

    const listed = await api.inject({
      method: "GET", url: "/api/privacy/deletion-requests", headers: bearer(USER),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().requests).toEqual([
      expect.objectContaining({ id: requestId, scope: "company", status: "pending" }),
    ]);
    const cancelled = await api.inject({
      method: "DELETE", url: `/api/privacy/deletion-requests/${requestId}`, headers: bearer(USER),
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().request).toMatchObject({ id: requestId, status: "cancelled" });
    expect((await pool.query("select status from tenants where id=$1", [TENANT])).rows[0].status)
      .toBe("active");
    await api.close();
  });
});
