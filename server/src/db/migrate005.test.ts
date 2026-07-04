import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runMigrations } from "./migrate.js";
import { pool } from "./pool.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const FOUNDING = "00000000-0000-0000-0000-000000000001";

d("migration 005: tenants + api_tokens + tenant_id", () => {
  beforeAll(async () => { await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("creates the founding tenant with the fixed id", async () => {
    const { rows } = await pool.query("select id, slug, status from tenants where slug = 'sameh'");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(FOUNDING);
    expect(rows[0].status).toBe("active");
  });

  it("adds tenant_id defaulting to the founding tenant on existing tables", async () => {
    const { rows } = await pool.query(
      "insert into skills (name, trigger, procedure) values ('__t005','__t005','p') returning tenant_id",
    );
    expect(rows[0].tenant_id).toBe(FOUNDING);
    await pool.query("delete from skills where name = '__t005'");
  });

  it("api_tokens enforces a unique token_hash", async () => {
    await pool.query("delete from api_tokens where label like '__t005%'");
    await pool.query(
      "insert into api_tokens (tenant_id, token_hash, label) values ($1,'__t005hash','__t005a')",
      [FOUNDING],
    );
    await expect(
      pool.query("insert into api_tokens (tenant_id, token_hash, label) values ($1,'__t005hash','__t005b')", [FOUNDING]),
    ).rejects.toThrow();
    await pool.query("delete from api_tokens where token_hash = '__t005hash'");
  });

  it("user email uniqueness is now per-tenant", async () => {
    await pool.query("delete from users where email = '__t005@b.c'");
    await pool.query("insert into tenants (id, name, slug) values ('00000000-0000-0000-0000-0000000000ff','Other','__t005-other') on conflict (slug) do nothing");
    const other = (await pool.query("select id from tenants where slug='__t005-other'")).rows[0].id;

    await pool.query("insert into users (email, password_hash, tenant_id) values ('__t005@b.c','h',$1)", [FOUNDING]);
    // same email under a DIFFERENT tenant is now allowed
    await pool.query("insert into users (email, password_hash, tenant_id) values ('__t005@b.c','h',$1)", [other]);
    // but a duplicate within the SAME tenant still fails
    await expect(
      pool.query("insert into users (email, password_hash, tenant_id) values ('__t005@b.c','h',$1)", [FOUNDING]),
    ).rejects.toThrow();

    await pool.query("delete from users where email = '__t005@b.c'");
    await pool.query("delete from tenants where slug = '__t005-other'");
  });

  it("is convergent (re-runs cleanly)", async () => {
    await runMigrations(pool);
  });
});
