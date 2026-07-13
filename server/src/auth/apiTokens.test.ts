import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";
import { ensureLegacyToken, ensureToken, hashToken, tenantForToken } from "./apiTokens.js";
import { FOUNDING_TENANT_ID, runPrincipal } from "../db/tenant.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const futureExpiry = () => new Date(Date.now() + 60 * 60 * 1000);
const ISSUER = "15000000-0000-4000-8000-000000000014";

d("api tokens", () => {
  beforeAll(async () => {
    const schema = (await pool.query("select current_schema() as schema")).rows[0].schema;
    if (schema === "public") throw new Error("api token tests require a non-public TEST_DATABASE_URL");
    await runMigrations(pool);
  });
  beforeEach(async () => {
    await pool.query("delete from api_tokens where label like '__t_apitok%'");
    await pool.query(
      `insert into brian_auth_users_test(id,email,raw_user_meta_data)
       values ($1,'__t_apitok-issuer@example.test','{"brian_invitation_signup":true}')
       on conflict (id) do nothing`,
      [ISSUER],
    );
  });
  afterAll(async () => {
    await pool.query("delete from api_tokens where label like '__t_apitok%'");
    await pool.query("delete from brian_auth_users_test where id=$1", [ISSUER]);
    await pool.end();
  });

  it("hashToken is deterministic sha256 hex", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });

  it("requires an explicit future expiry and remains idempotent", async () => {
    const expiresAt = futureExpiry();
    await ensureToken(FOUNDING_TENANT_ID, "secret-plain", "__t_apitok-a", expiresAt);
    await ensureToken(FOUNDING_TENANT_ID, "secret-plain", "__t_apitok-a", expiresAt);
    const { rows } = await pool.query(
      "select count(*)::int as n, max(expires_at) as expires_at from api_tokens where token_hash = $1",
      [hashToken("secret-plain")],
    );
    expect(rows[0].n).toBe(1);
    expect(new Date(rows[0].expires_at).toISOString()).toBe(expiresAt.toISOString());
    expect(await tenantForToken("secret-plain")).toBe(FOUNDING_TENANT_ID);
  });

  it("rejects invalid or elapsed issuance expiries without inserting", async () => {
    await expect(ensureToken(
      FOUNDING_TENANT_ID, "invalid-expiry", "__t_apitok-invalid", "not-a-date",
    )).rejects.toThrow(/valid future timestamp/);
    await expect(ensureToken(
      FOUNDING_TENANT_ID,
      "past-expiry",
      "__t_apitok-past",
      new Date(Date.now() - 1000),
    )).rejects.toThrow(/valid future timestamp/);
    expect((await pool.query(
      "select count(*)::int as count from api_tokens where label like '__t_apitok%'",
    )).rows[0].count).toBe(0);
  });

  it("keeps the founding bootstrap's existing null-expiry behavior explicit", async () => {
    await ensureLegacyToken(FOUNDING_TENANT_ID, "legacy-plain", "__t_apitok-legacy");
    expect((await pool.query(
      "select expires_at from api_tokens where token_hash=$1",
      [hashToken("legacy-plain")],
    )).rows).toEqual([{ expires_at: null }]);
    expect(await tenantForToken("legacy-plain")).toBe(FOUNDING_TENANT_ID);
  });

  it("attributes runtime issuance to a verified human without attributing bootstrap tokens", async () => {
    await ensureLegacyToken(FOUNDING_TENANT_ID, "bootstrap-plain", "__t_apitok-bootstrap");
    await runPrincipal({
      kind: "human",
      tenantId: FOUNDING_TENANT_ID,
      userId: ISSUER,
      email: "__t_apitok-issuer@example.test",
      membershipId: "15000000-0000-4000-8000-000000000015",
      role: "owner",
      permissions: [],
    }, () => ensureToken(
      FOUNDING_TENANT_ID,
      "attributed-plain",
      "__t_apitok-attributed",
      futureExpiry(),
    ));
    expect((await pool.query(
      `select label,created_by_user_id from api_tokens
        where label in ('__t_apitok-bootstrap','__t_apitok-attributed')
        order by label`,
    )).rows).toEqual([
      { label: "__t_apitok-attributed", created_by_user_id: ISSUER },
      { label: "__t_apitok-bootstrap", created_by_user_id: null },
    ]);
  });

  it("unknown token resolves to null", async () => {
    expect(await tenantForToken("does-not-exist-xyz")).toBeNull();
  });

  it("revoked token resolves to null", async () => {
    await ensureToken(FOUNDING_TENANT_ID, "revoked-plain", "__t_apitok-rev", futureExpiry());
    await pool.query("update api_tokens set revoked_at = now() where token_hash = $1", [hashToken("revoked-plain")]);
    expect(await tenantForToken("revoked-plain")).toBeNull();
  });

  it("expired token resolves to null and is not marked used", async () => {
    await pool.query(
      `insert into api_tokens
        (tenant_id,token_hash,label,created_at,expires_at)
       values ($1,$2,'__t_apitok-expired',now()-interval '2 days',now()-interval '1 day')`,
      [FOUNDING_TENANT_ID, hashToken("expired-plain")],
    );
    expect(await tenantForToken("expired-plain")).toBeNull();
    expect((await pool.query(
      "select last_used_at from api_tokens where token_hash=$1",
      [hashToken("expired-plain")],
    )).rows).toEqual([{ last_used_at: null }]);
  });

  it("rate-limits last_used_at writes to once per five minutes", async () => {
    const token = "throttled-plain";
    const tokenHash = hashToken(token);
    await ensureToken(FOUNDING_TENANT_ID, token, "__t_apitok-throttled", futureExpiry());

    expect(await tenantForToken(token)).toBe(FOUNDING_TENANT_ID);
    const first = (await pool.query(
      "select last_used_at from api_tokens where token_hash=$1",
      [tokenHash],
    )).rows[0].last_used_at as Date;
    expect(first).toBeInstanceOf(Date);

    expect(await tenantForToken(token)).toBe(FOUNDING_TENANT_ID);
    const second = (await pool.query(
      "select last_used_at from api_tokens where token_hash=$1",
      [tokenHash],
    )).rows[0].last_used_at as Date;
    expect(second.getTime()).toBe(first.getTime());

    const stale = (await pool.query(
      `update api_tokens set last_used_at=now()-interval '6 minutes'
        where token_hash=$1 returning last_used_at`,
      [tokenHash],
    )).rows[0].last_used_at as Date;
    expect(await tenantForToken(token)).toBe(FOUNDING_TENANT_ID);
    const refreshed = (await pool.query(
      "select last_used_at from api_tokens where token_hash=$1",
      [tokenHash],
    )).rows[0].last_used_at as Date;
    expect(refreshed.getTime()).toBeGreaterThan(stale.getTime());
  });
});
