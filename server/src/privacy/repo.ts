import type pg from "pg";
import { isUuid } from "../auth/principal.js";
import { currentPrincipal, withTenantTransaction } from "../db/tenant.js";
import { pool as defaultPool } from "../db/pool.js";
import {
  DELETION_SCOPES,
  DELETION_STATUSES,
  type DataDeletionRequest,
  type DataDeletionScope,
  type DataDeletionStatus,
} from "./types.js";

export const DEFAULT_DELETION_GRACE_DAYS = 30;
export const DELETION_GRACE_DAYS_ENV = "BRIAN_DELETION_GRACE_DAYS";

function isScope(value: unknown): value is DataDeletionScope {
  return typeof value === "string" && (DELETION_SCOPES as readonly string[]).includes(value);
}
function isStatus(value: unknown): value is DataDeletionStatus {
  return typeof value === "string" && (DELETION_STATUSES as readonly string[]).includes(value);
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(value as string | number | Date);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function deletionRequestFromRow(row: Record<string, unknown>): DataDeletionRequest {
  const id = row.request_id ?? row.id;
  const scope = row.request_scope ?? row.scope;
  const status = row.request_status ?? row.status;
  const scheduledFor = iso(row.request_scheduled_for ?? row.scheduled_for);
  const createdAt = iso(row.request_created_at ?? row.created_at);
  if (!isUuid(id) || !isScope(scope) || !isStatus(status) || !scheduledFor || !createdAt) {
    throw new Error("invalid data deletion request returned by the database");
  }
  return {
    id,
    scope,
    status,
    scheduledFor,
    createdAt,
    cancelledAt: iso(row.request_cancelled_at ?? row.cancelled_at),
    completedAt: iso(row.request_completed_at ?? row.completed_at),
  };
}

export function deletionGracePeriodDays(
  value: unknown = process.env[DELETION_GRACE_DAYS_ENV],
): number {
  if (value === undefined || value === null || value === "") return DEFAULT_DELETION_GRACE_DAYS;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
    throw new Error(`${DELETION_GRACE_DAYS_ENV} must be an integer between 1 and 365`);
  }
  return parsed;
}

function currentHuman() {
  const principal = currentPrincipal();
  if (!principal || principal.kind !== "human") {
    throw new Error("a verified human principal is required for data deletion requests");
  }
  return principal;
}

/**
 * Schedule deletion and perform its immediate irreversible revocation steps.
 * The database function re-checks membership/ownership and binds userId to
 * transaction-local app.user_id; supplied scope/tenant values are never the
 * sole authorization decision.
 */
export async function scheduleDataDeletion(
  scope: DataDeletionScope,
  options: { gracePeriodDays?: number } = {},
  source: pg.Pool = defaultPool,
): Promise<DataDeletionRequest> {
  if (!isScope(scope)) throw new Error("deletion scope must be account or company");
  const principal = currentHuman();
  const gracePeriodDays = deletionGracePeriodDays(options.gracePeriodDays);
  return withTenantTransaction(async (client) => {
    const { rows } = await client.query(
      "select * from request_data_deletion($1::uuid,$2::uuid,$3::text,$4::integer)",
      [principal.userId, principal.tenantId, scope, gracePeriodDays],
    );
    if (!rows[0]) throw new Error("the deletion request was not created");
    return deletionRequestFromRow(rows[0]);
  }, source);
}

async function withVerifiedUserContext<T>(
  userId: string,
  source: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!isUuid(userId)) throw new Error("invalid verified user id");
  const client = await source.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id',$1,true)", [userId]);
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

/**
 * Narrow bootstrap lookup for a subject already verified from a Supabase JWT.
 * This remains usable after company scheduling has suspended normal principal
 * resolution. Callers must never pass an unverified request value as userId.
 */
export async function listDataDeletionRequestsForVerifiedUser(
  userId: string,
  source: pg.Pool = defaultPool,
): Promise<DataDeletionRequest[]> {
  return withVerifiedUserContext(userId, source, async (client) => {
    const { rows } = await client.query(
      "select * from list_my_data_deletion_requests($1::uuid)",
      [userId],
    );
    return rows.map(deletionRequestFromRow);
  });
}

export async function listMyDataDeletionRequests(
  source: pg.Pool = defaultPool,
): Promise<DataDeletionRequest[]> {
  return listDataDeletionRequestsForVerifiedUser(currentHuman().userId, source);
}

/**
 * Narrow bootstrap cancellation for a subject already verified from a
 * Supabase JWT. Revoked credentials/connectors are intentionally not restored.
 */
export async function cancelDataDeletionForVerifiedUser(
  userId: string,
  requestId: string,
  source: pg.Pool = defaultPool,
): Promise<DataDeletionRequest | null> {
  if (!isUuid(requestId)) return null;
  return withVerifiedUserContext(userId, source, async (client) => {
    const { rows } = await client.query(
      "select * from cancel_data_deletion_request($1::uuid,$2::uuid)",
      [userId, requestId],
    );
    return rows[0] ? deletionRequestFromRow(rows[0]) : null;
  });
}

export async function cancelDataDeletion(
  requestId: string,
  source: pg.Pool = defaultPool,
): Promise<DataDeletionRequest | null> {
  return cancelDataDeletionForVerifiedUser(currentHuman().userId, requestId, source);
}
