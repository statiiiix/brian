// Keeping the brain current without a human running a CLI.
//
// "Pulls knowledge out of fragmented sources, structures it, and KEEPS IT
// CURRENT" — the last clause was the manual one: syncs only ever happened when
// someone ran `npm run sync`. This module picks the connectors that are due and
// runs them, so a scheduled trigger (Supabase cron, GitHub Actions, any
// scheduler that can make one authenticated request) keeps every tenant fresh.
//
// The server runs stateless on Supabase Edge, so the schedule cannot live in a
// process timer; "due" is derived from last_synced_at at request time instead.

import { db, runTenant, type Queryable } from "../db/tenant.js";
import { syncConnector } from "./sync.js";
import type { SourceType } from "./types.js";

export const DEFAULT_SYNC_INTERVAL_MINUTES = Number(
  process.env.CONNECTOR_SYNC_INTERVAL_MINUTES ?? 360,
);

/** Most connectors a single trigger will process, so one run cannot run long. */
export const MAX_SYNCS_PER_RUN = Number(process.env.CONNECTOR_SYNC_BATCH ?? 10);

export interface DueConnector {
  tenant_id: string;
  type: SourceType;
  last_synced_at: string | null;
}

export interface SyncRunResult {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  results: {
    tenant_id: string;
    type: SourceType;
    ok: boolean;
    evidence?: number;
    drafts?: number;
    error?: string;
  }[];
}

/**
 * Active tenants. `tenants` carries the pre_tenant_lookup policy (migration
 * 007) precisely so this kind of lookup works before any tenant context is
 * bound; every other table below is read inside runTenant.
 */
export async function activeTenantIds(p: Queryable = db()): Promise<string[]> {
  const { rows } = await p.query(
    `select id from tenants where status = 'active' order by created_at asc`,
  );
  return rows.map((r: any) => String(r.id));
}

/**
 * Connectors in the CURRENT tenant that are connected and either never synced
 * or stale. Deliberately tenant-scoped: RLS binds app.tenant_id per query, so a
 * cross-tenant sweep would silently return nothing under the brian_app role.
 */
export async function dueConnectorsForTenant(
  intervalMinutes = DEFAULT_SYNC_INTERVAL_MINUTES,
  limit = MAX_SYNCS_PER_RUN,
  p: Queryable = db(),
): Promise<DueConnector[]> {
  const { rows } = await p.query(
    `select tenant_id, type, last_synced_at
       from connectors
      where status = 'connected'
        and (last_synced_at is null
             or last_synced_at < now() - ($1 || ' minutes')::interval)
      order by last_synced_at asc nulls first
      limit $2`,
    [intervalMinutes, limit],
  );
  return rows.map((r: any) => ({
    tenant_id: String(r.tenant_id),
    type: r.type as SourceType,
    last_synced_at: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : null,
  }));
}

/** Every due connector across tenants, capped so one run stays bounded. */
export async function dueConnectors(
  intervalMinutes = DEFAULT_SYNC_INTERVAL_MINUTES,
  limit = MAX_SYNCS_PER_RUN,
): Promise<DueConnector[]> {
  const due: DueConnector[] = [];
  for (const tenantId of await activeTenantIds()) {
    if (due.length >= limit) break;
    const forTenant = await runTenant(tenantId, () =>
      dueConnectorsForTenant(intervalMinutes, limit - due.length));
    // tenant_id comes from the row, but bind it defensively: these ids decide
    // which tenant's credentials a later sync will use.
    due.push(...forTenant.map((row) => ({ ...row, tenant_id: tenantId })));
  }
  return due;
}

/**
 * Sync every due connector, each inside its own tenant context. One failing
 * connector (an expired token, a provider outage) must not stop the rest, so
 * failures are collected rather than thrown — the caller reports them.
 */
export async function syncDueConnectors(
  opts: { intervalMinutes?: number; limit?: number } = {},
): Promise<SyncRunResult> {
  const due = await dueConnectors(
    opts.intervalMinutes ?? DEFAULT_SYNC_INTERVAL_MINUTES,
    opts.limit ?? MAX_SYNCS_PER_RUN,
  );

  const results: SyncRunResult["results"] = [];
  for (const connector of due) {
    try {
      const summary = await runTenant(connector.tenant_id, () => syncConnector(connector.type));
      results.push({
        tenant_id: connector.tenant_id,
        type: connector.type,
        ok: true,
        evidence: summary.evidence,
        drafts: summary.drafts,
      });
    } catch (error) {
      results.push({
        tenant_id: connector.tenant_id,
        type: connector.type,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    attempted: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    skipped: 0,
    results,
  };
}
