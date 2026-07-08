import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { runMigrations } from "./../db/migrate.js";
import { pool } from "../db/pool.js";
import { runTenant, FOUNDING_TENANT_ID } from "../db/tenant.js";
import { createSkill } from "../skills/repo.js";
import { buildApp } from "./app.js";
import { testClient } from "../test/http.js";
import type { NewSkill } from "../skills/types.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const ACME = "00000000-0000-0000-0000-0000000a0703";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
// Shaped like a Supabase access token (issuer pre-filter); signature unchecked
// because validation happens at the (mocked) auth server.
const sbToken = `${b64({ alg: "ES256" })}.${b64({ iss: "https://x.supabase.co/auth/v1", sub: "u1" })}.sig`;

function newSkill(name: string): NewSkill {
  return {
    name, trigger: `${name} trigger`, inputs: [], procedure: `${name} procedure`,
    hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null,
  };
}

async function cleanup() {
  await pool.query("delete from skills where name like '__sbauth-%'");
  await pool.query("delete from tenants where id = $1", [ACME]);
}

d("Supabase Auth on the guard", () => {
  let acmeSkillId = "";
  let foundingSkillId = "";

  const authServer = (user: object | null) =>
    vi.fn(async () => user
      ? new Response(JSON.stringify(user), { status: 200 })
      : new Response("{}", { status: 401 }));

  const app = (fetchFn: any) => testClient(buildApp({
    authToken: "static-__sbauth",
    supabaseAuth: { url: "https://x.supabase.co", anonKey: "anon", fetchFn },
  }));

  beforeAll(async () => {
    await runMigrations(pool);
    await cleanup();
    await pool.query(
      "insert into tenants (id, name, slug) values ($1,'Acme','__sbauth-acme') on conflict (id) do nothing",
      [ACME],
    );
    foundingSkillId = (await runTenant(FOUNDING_TENANT_ID, () => createSkill(newSkill("__sbauth-founding")))).id;
    acmeSkillId = (await runTenant(ACME, () => createSkill(newSkill("__sbauth-acme")))).id;
  });
  afterAll(async () => { await cleanup(); await pool.end(); });

  it("accepts a Supabase token and binds the app_metadata tenant", async () => {
    const a = app(authServer({
      id: "u1", email: "expert@acme.io", app_metadata: { tenant_id: ACME, role: "expert" },
    }));
    const res = await a.inject({
      method: "GET", url: "/api/skills", headers: { authorization: `Bearer ${sbToken}` },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { id: string }[]).map((s) => s.id);
    expect(ids).toContain(acmeSkillId);
    expect(ids).not.toContain(foundingSkillId);

    const me = await a.inject({
      method: "GET", url: "/api/auth/me", headers: { authorization: `Bearer ${sbToken}` },
    });
    expect(me.json()).toEqual({ id: "u1", email: "expert@acme.io", role: "expert" });
  });

  it("falls back to the founding tenant when app_metadata has no tenant", async () => {
    const a = app(authServer({ id: "u2", email: "founder@x.io", app_metadata: {} }));
    const res = await a.inject({
      method: "GET", url: "/api/skills", headers: { authorization: `Bearer ${sbToken}` },
    });
    const ids = (res.json() as { id: string }[]).map((s) => s.id);
    expect(ids).toContain(foundingSkillId);
  });

  it("rejects a token the auth server does not recognize", async () => {
    const a = app(authServer(null));
    const res = await a.inject({
      method: "GET", url: "/api/skills", headers: { authorization: `Bearer ${sbToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("never calls the auth server for non-Supabase bearers", async () => {
    const fetchFn = authServer(null);
    const a = app(fetchFn);
    const res = await a.inject({
      method: "GET", url: "/api/skills", headers: { authorization: "Bearer static-__sbauth" },
    });
    expect(res.statusCode).toBe(200);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
