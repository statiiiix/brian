import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runMigrations } from "./migrate.js";
import { pool } from "./pool.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

// Every tenant-owned table must carry the tenant_isolation policy.
const TENANT_TABLES = [
  "skills", "skill_versions", "context_entries", "context_versions",
  "executions", "users", "interviews", "connectors", "evidence", "api_tokens",
];

d("migration 007: RLS backstop (brian_app role + tenant_isolation policies)", () => {
  beforeAll(async () => { await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("creates the non-login brian_app role", async () => {
    const { rows } = await pool.query(
      "select rolcanlogin from pg_roles where rolname = 'brian_app'",
    );
    expect(rows.length).toBe(1);
  });

  it("puts a tenant_isolation policy on every tenant-owned table (current schema)", async () => {
    const { rows } = await pool.query(
      `select tablename from pg_policies
        where schemaname = current_schema() and policyname = 'tenant_isolation'`,
    );
    const tables = rows.map((r) => r.tablename).sort();
    expect(tables).toEqual([...TENANT_TABLES].sort());
  });

  it("allows token lookup and tenant status reads without a tenant context", async () => {
    const { rows } = await pool.query(
      `select tablename, policyname from pg_policies
        where schemaname = current_schema() and policyname = 'pre_tenant_lookup'
        order by tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(["api_tokens", "tenants"]);
  });

  it("grants brian_app DML on the current schema's tables", async () => {
    const { rows } = await pool.query(
      `select distinct privilege_type from information_schema.role_table_grants
        where grantee = 'brian_app' and table_schema = current_schema() and table_name = 'skills'`,
    );
    const privs = rows.map((r) => r.privilege_type).sort();
    expect(privs).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  });
});
