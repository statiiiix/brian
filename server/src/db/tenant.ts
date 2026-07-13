import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";
import { pool } from "./pool.js";
import type { AuthPrincipal } from "../auth/principal.js";

// The founding tenant everything pre-multitenancy belongs to (see 005_tenants).
export const FOUNDING_TENANT_ID = "00000000-0000-0000-0000-000000000001";

// Minimal query surface satisfied by both pg.Pool and pg.PoolClient.
export interface Queryable {
  query: pg.Pool["query"];
}

export type TenantTransactionSource = pg.Pool | pg.PoolClient;

interface TenantCtx {
  tenantId: string;
  principal?: AuthPrincipal;
  // Multi-statement repository transactions may pin a client here. Ordinary
  // one-shot queries use scopedPool below, which binds SET LOCAL itself.
  client?: pg.PoolClient;
}

const als = new AsyncLocalStorage<TenantCtx>();

// The tenant id for the current async context, or null outside a tenant scope.
export function currentTenantId(): string | null {
  return als.getStore()?.tenantId ?? null;
}

export function currentPrincipal(): AuthPrincipal | null {
  return als.getStore()?.principal ?? null;
}

export function currentUserId(): string | null {
  const principal = currentPrincipal();
  return principal && "userId" in principal ? principal.userId : null;
}

export function currentConnectionId(): string | null {
  const principal = currentPrincipal();
  return principal && "connectionId" in principal ? principal.connectionId : null;
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

// RLS backstop: every one-shot repo query runs inside its own
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

// Run a group of tenant-owned queries atomically with the RLS settings bound
// to the transaction. A caller may pass a Pool (tests/alternate runtime) or an
// already-pinned PoolClient (composition inside a larger transaction). Keeping
// this primitive here prevents higher-level services from falling back to the
// raw shared pool, which would make brian_app see no rows under RLS.
export async function withTenantTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  source: TenantTransactionSource = pool,
): Promise<T> {
  // pg.PoolClient also exposes connect(), so connect's presence cannot
  // distinguish it from pg.Pool. A checked-out client uniquely exposes
  // release(); callers that pass one have already opened/bound its enclosing
  // transaction, and nested repository work must reuse it without reconnecting.
  if (typeof (source as pg.PoolClient).release === "function") {
    return fn(source as pg.PoolClient);
  }

  const client = await (source as pg.Pool).connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantOrFounding()]);
    const userId = currentUserId();
    if (userId) await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try { await client.query("rollback"); } catch { /* connection-level failure */ }
    throw error;
  } finally {
    client.release();
  }
}

// Callback form — binds the tenant to the async context for `fn`. Used by MCP
// stdio tool calls, scripts, and tests.
export function runTenant<T>(tenantId: string, fn: () => T): T {
  return als.run({ tenantId }, fn);
}

export function runPrincipal<T>(principal: AuthPrincipal, fn: () => T): T {
  return als.run({ tenantId: principal.tenantId, principal }, fn);
}

// No-callback form for framework hooks (e.g. Fastify onRequest) where wrapping
// the downstream handler in a callback is awkward. Binds the tenant to the
// current request's async context for the rest of the chain.
export function enterTenant(tenantId: string): void {
  als.enterWith({ tenantId });
}
