import { describe, it, expect, afterAll, vi } from "vitest";
import type pg from "pg";
import { pool } from "./pool.js";
import {
  runTenant, enterTenant, currentTenantId, requireTenantId, db,
  FOUNDING_TENANT_ID, withTenantTransaction,
} from "./tenant.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

describe("tenant transaction composition", () => {
  it("reuses a pinned PoolClient without trying to connect it again", async () => {
    // PoolClient has both connect() and release(). The latter is the reliable
    // discriminator from Pool and reproduces pg's real checked-out shape.
    const connect = vi.fn(() => {
      throw new Error("a pinned client must not be reconnected");
    });
    const pinned = {
      connect,
      release: vi.fn(),
      query: vi.fn(),
    } as unknown as pg.PoolClient;

    await expect(withTenantTransaction(async (client) => {
      expect(client).toBe(pinned);
      return "reused";
    }, pinned)).resolves.toBe("reused");
    expect(connect).not.toHaveBeenCalled();
    expect(pinned.query).not.toHaveBeenCalled();
  });
});

d("tenant context", () => {
  afterAll(async () => { await pool.end(); });

  it("currentTenantId is null and requireTenantId throws outside a scope", () => {
    expect(currentTenantId()).toBeNull();
    expect(() => requireTenantId()).toThrow();
  });

  it("runTenant binds the tenant for the async callback, then clears it", async () => {
    const inside = await runTenant(FOUNDING_TENANT_ID, async () => {
      expect(currentTenantId()).toBe(FOUNDING_TENANT_ID);
      expect(requireTenantId()).toBe(FOUNDING_TENANT_ID);
      return currentTenantId();
    });
    expect(inside).toBe(FOUNDING_TENANT_ID);
    expect(currentTenantId()).toBeNull();
  });

  it("enterTenant binds the tenant without a callback (framework-hook form)", async () => {
    await runTenant("ignored", async () => {
      // enterWith within an existing als.run scope overrides the store here
      enterTenant(FOUNDING_TENANT_ID);
      expect(currentTenantId()).toBe(FOUNDING_TENANT_ID);
    });
  });

  it("db() returns a usable query executor", async () => {
    const { rows } = await runTenant(FOUNDING_TENANT_ID, () => db().query("select 1 as ok"));
    expect(rows[0].ok).toBe(1);
  });

  it("db() binds app.tenant_id for the query so RLS policies see the tenant", async () => {
    const OTHER = "00000000-0000-0000-0000-00000000beef";
    const { rows } = await runTenant(OTHER, () =>
      db().query("select current_setting('app.tenant_id', true) as t"),
    );
    expect(rows[0].t).toBe(OTHER);
  });

  it("db() falls back to the founding tenant outside a scope", async () => {
    const { rows } = await db().query("select current_setting('app.tenant_id', true) as t");
    expect(rows[0].t).toBe(FOUNDING_TENANT_ID);
  });

  it("the setting is transaction-local: a fresh pool query sees no tenant", async () => {
    await runTenant(FOUNDING_TENANT_ID, () => db().query("select 1"));
    const { rows } = await pool.query("select current_setting('app.tenant_id', true) as t");
    expect(rows[0].t ?? "").toBe("");
  });
});
