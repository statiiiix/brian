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

// The executor repos should use. Phase 1: the shared pool. Phase 2 will return
// the request's pinned client (SET LOCAL app.tenant_id) for RLS — repos need no
// change because they already go through db().
export function db(): Queryable {
  return als.getStore()?.client ?? pool;
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
