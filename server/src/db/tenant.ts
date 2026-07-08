import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";
import { pool } from "./pool.js";

// The founding tenant everything pre-multitenancy belongs to (see 005_tenants).
export const FOUNDING_TENANT_ID = "00000000-0000-0000-0000-000000000001";

// Minimal query surface satisfied by both pg.Pool and pg.PoolClient.
export interface Queryable {
  query: pg.Pool["query"];
}

interface TenantCtx {
  tenantId: string;
  // Phase 2 will pin a per-request client (with SET LOCAL app.tenant_id) here
  // so RLS policies see the tenant. Phase 1 leaves it undefined and uses the
  // shared pool with explicit tenant_id filters.
  client?: pg.PoolClient;
}

const als = new AsyncLocalStorage<TenantCtx>();

// The tenant id for the current async context, or null outside a tenant scope.
export function currentTenantId(): string | null {
  return als.getStore()?.tenantId ?? null;
}

// Like currentTenantId but throws when unset — catches "forgot to scope" bugs
// in repos before they can read or write across tenants.
export function requireTenantId(): string {
  const t = als.getStore()?.tenantId;
  if (!t) throw new Error("no tenant in async context (wrap the call in runTenant/enterTenant)");
  return t;
}

// The tenant repos should read/write against: the async-context tenant, or the
// founding tenant when unscoped (dev scripts, seeds, and existing tests). Real
// request entry points (HTTP guard, MCP) always set a tenant, so unscoped only
// happens outside a request. Phase 2 RLS is the hard backstop.
export function tenantOrFounding(): string {
  return als.getStore()?.tenantId ?? FOUNDING_TENANT_ID;
}

// Phase 2 (RLS backstop): every one-shot repo query runs inside its own
// transaction with app.tenant_id bound via transaction-scoped set_config, so
// the tenant_isolation policies (007) see the tenant when the app connects as
// the non-owner brian_app role. The setting dies with the transaction —
// nothing leaks to the next pool checkout. Repos that own multi-statement
// transactions (updateSkill/updateContext) set it themselves after `begin`.
const scopedPool: Queryable = {
  query: (async (text: unknown, params?: unknown) => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantOrFounding()]);
      const result = await (client.query as (t: unknown, p?: unknown) => Promise<unknown>)(text, params);
      await client.query("commit");
      return result;
    } catch (e) {
      try { await client.query("rollback"); } catch { /* connection-level failure */ }
      throw e;
    } finally {
      client.release();
    }
  }) as pg.Pool["query"],
};

// The executor repos should use: a pinned client when one exists (reserved for
// future request-pinned transactions), else the RLS-scoped pool wrapper.
export function db(): Queryable {
  return als.getStore()?.client ?? scopedPool;
}

// Callback form — binds the tenant to the async context for `fn`. Used by MCP
// stdio tool calls, scripts, and tests.
export function runTenant<T>(tenantId: string, fn: () => T): T {
  return als.run({ tenantId }, fn);
}

// No-callback form for framework hooks (e.g. Fastify onRequest) where wrapping
// the downstream handler in a callback is awkward. Binds the tenant to the
// current request's async context for the rest of the chain.
export function enterTenant(tenantId: string): void {
  als.enterWith({ tenantId });
}
