import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { upsertUser } from "../auth/users.js";
import { buildApp } from "./app.js";
import { testClient } from "../test/http.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

d("auth routes + dual-mode guard", () => {
  const FOUNDING_TENANT = "00000000-0000-0000-0000-000000000001";
  let founderId: string;

  beforeAll(async () => {
    await runMigrations(pool);
    const founder = await upsertUser({ email: "founder@test.io", password: "hunter22", name: "Founder" });
    founderId = founder.id;
    // Since migration 010 the dashboard is fail-closed on memberships: a
    // legacy JWT is honored only when its user id has an active membership
    // (mirroring the trusted founding-user backfill). Seed that link here.
    await pool.query(
      "insert into brian_auth_users_test(id,email) values ($1,'founder@test.io') on conflict (id) do nothing",
      [founderId],
    );
    await pool.query(
      `insert into tenant_memberships(tenant_id,user_id,role,status,is_default)
         values ($1,$2,'owner','active',true)
       on conflict (tenant_id,user_id) do update set role='owner', status='active'`,
      [FOUNDING_TENANT, founderId],
    );
  });
  afterAll(async () => {
    await pool.query("delete from tenant_memberships where user_id=$1", [founderId]);
    await pool.query("delete from brian_auth_users_test where id=$1", [founderId]);
    await pool.end();
  });

  const app = () => testClient(buildApp({
    authToken: "static-tok",
    jwtSecret: "jwt-secret",
    legacyPasswordLoginEnabled: true,
  }));

  it("logs in with correct credentials and rejects wrong ones", async () => {
    const a = app();
    const ok = await a.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "founder@test.io", password: "hunter22" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().token).toBeTruthy();
    expect(ok.json().user.email).toBe("founder@test.io");

    const bad = await a.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "founder@test.io", password: "wrong" } });
    expect(bad.statusCode).toBe(401);
    await a.close();
  });

  it("human JWT works on dashboard routes while the static agent token is rejected there", async () => {
    const a = app();
    const login = await a.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "founder@test.io", password: "hunter22" } });
    const jwt = login.json().token;

    const viaJwt = await a.inject({ method: "GET", url: "/api/skills",
      headers: { authorization: `Bearer ${jwt}` } });
    expect(viaJwt.statusCode).toBe(200);

    const me = await a.inject({ method: "GET", url: "/api/auth/me",
      headers: { authorization: `Bearer ${jwt}` } });
    expect(me.json().email).toBe("founder@test.io");

    const viaStatic = await a.inject({ method: "GET", url: "/api/skills",
      headers: { authorization: "Bearer static-tok" } });
    expect(viaStatic.statusCode).toBe(401);

    const meStatic = await a.inject({ method: "GET", url: "/api/auth/me",
      headers: { authorization: "Bearer static-tok" } });
    expect(meStatic.statusCode).toBe(401);

    const nope = await a.inject({ method: "GET", url: "/api/skills",
      headers: { authorization: "Bearer garbage" } });
    expect(nope.statusCode).toBe(401);
    await a.close();
  });
});
