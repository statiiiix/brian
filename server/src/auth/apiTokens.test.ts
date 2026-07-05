import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import { hashToken, tenantForToken, ensureToken } from "./apiTokens.js";
import { FOUNDING_TENANT_ID } from "../db/tenant.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("api tokens", () => {
  beforeAll(async () => { await runMigrations(pool); });
  afterAll(async () => {
    await pool.query("delete from api_tokens where label like '__t_apitok%'");
    await pool.end();
  });

  it("hashToken is deterministic sha256 hex", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("ensureToken is idempotent and tenantForToken resolves it", async () => {
    await pool.query("delete from api_tokens where label like '__t_apitok%'");
    await ensureToken(FOUNDING_TENANT_ID, "secret-plain", "__t_apitok-a");
    await ensureToken(FOUNDING_TENANT_ID, "secret-plain", "__t_apitok-a"); // idempotent
    const { rows } = await pool.query(
      "select count(*)::int as n from api_tokens where token_hash = $1",
      [hashToken("secret-plain")],
    );
    expect(rows[0].n).toBe(1);
    expect(await tenantForToken("secret-plain")).toBe(FOUNDING_TENANT_ID);
  });

  it("unknown token resolves to null", async () => {
    expect(await tenantForToken("does-not-exist-xyz")).toBeNull();
  });

  it("revoked token resolves to null", async () => {
    await ensureToken(FOUNDING_TENANT_ID, "revoked-plain", "__t_apitok-rev");
    await pool.query("update api_tokens set revoked_at = now() where token_hash = $1", [hashToken("revoked-plain")]);
    expect(await tenantForToken("revoked-plain")).toBeNull();
  });
});
