import type pg from "pg";
import { isUuid } from "../auth/principal.js";

export const DEFAULT_SECURITY_AUDIT_RETENTION_DAYS = 365;
export const DEFAULT_EXECUTION_RETENTION_DAYS = 180;
export const DEFAULT_MAINTENANCE_BATCH_LIMIT = 1_000;

export interface RetentionPolicy {
  securityAuditDays: number;
  executionDays: number;
}

export interface MaintenancePreview {
  dueAccountRequests: number;
  dueCompanyRequests: number;
  expiredAuditEvents: number;
  expiredExecutions: number;
}

export interface MaintenanceResult {
  processedAccounts: number;
  failedAccounts: number;
  processedCompanies: number;
  prunedAuditEvents: number;
  prunedExecutions: number;
}

export interface SupabaseAdminUserDeleter {
  deleteUser(userId: string): Promise<void>;
}

export class SupabaseAdminDeletionError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Supabase Admin user deletion failed with HTTP ${status}`);
    this.name = "SupabaseAdminDeletionError";
    this.status = status;
  }
}

function boundedInteger(value: unknown, fallback: number, name: string, max = 3_650): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return parsed;
}

export function retentionPolicy(env: NodeJS.ProcessEnv = process.env): RetentionPolicy {
  return {
    securityAuditDays: boundedInteger(
      env.SECURITY_AUDIT_RETENTION_DAYS,
      DEFAULT_SECURITY_AUDIT_RETENTION_DAYS,
      "SECURITY_AUDIT_RETENTION_DAYS",
    ),
    executionDays: boundedInteger(
      env.EXECUTION_LOG_RETENTION_DAYS,
      DEFAULT_EXECUTION_RETENTION_DAYS,
      "EXECUTION_LOG_RETENTION_DAYS",
    ),
  };
}

export function maintenanceBatchLimit(value: unknown): number {
  return boundedInteger(value, DEFAULT_MAINTENANCE_BATCH_LIMIT, "maintenance batch limit", 10_000);
}

function normalizedSupabaseUrl(value: string): string {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("SUPABASE_URL must use HTTPS (except local development)");
  }
  return url.toString().replace(/\/$/, "");
}

/** Uses the documented server-only Auth Admin endpoint; response bodies are
 * deliberately ignored so provider diagnostics cannot leak into logs. */
export function createSupabaseAdminUserDeleter(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}): SupabaseAdminUserDeleter {
  const baseUrl = normalizedSupabaseUrl(input.supabaseUrl);
  if (!input.serviceRoleKey) throw new Error("a Supabase server secret is required");
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    async deleteUser(userId: string): Promise<void> {
      if (!isUuid(userId)) throw new Error("invalid Supabase user id");
      const response = await fetchImpl(
        `${baseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
        {
          method: "DELETE",
          headers: {
            apikey: input.serviceRoleKey,
            authorization: `Bearer ${input.serviceRoleKey}`,
            "content-type": "application/json",
          },
          // Match the current Supabase Auth Admin client contract explicitly;
          // false requests irreversible hard deletion after the grace period.
          body: JSON.stringify({ should_soft_delete: false }),
        },
      );
      // A missing user is already in the desired terminal state and makes a
      // retry after a process crash idempotent.
      if (!response.ok && response.status !== 404) {
        throw new SupabaseAdminDeletionError(response.status);
      }
    },
  };
}

async function transaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
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

/** Refuse to run mutations from brian_app or another non-owner credential. */
export async function assertOwnerMaintenanceConnection(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query(
    `select coalesce(role.rolsuper or relation.relowner = role.oid, false) as allowed
       from pg_class relation
       join pg_roles owner_role on owner_role.oid = relation.relowner
       join pg_roles role on role.rolname = current_user
      where relation.oid = to_regclass('data_deletion_requests')`,
  );
  if (!rows[0]?.allowed) {
    throw new Error("privacy maintenance requires the database owner credential");
  }
}

export async function previewMaintenance(
  pool: pg.Pool,
  policy: RetentionPolicy = retentionPolicy(),
): Promise<MaintenancePreview> {
  await assertOwnerMaintenanceConnection(pool);
  const { rows } = await pool.query(
    `select
       (select count(*)::int from data_deletion_requests
         where scope='account' and status='pending' and scheduled_for <= statement_timestamp())
         as due_account_requests,
       (select count(*)::int from data_deletion_requests
         where scope='company' and status='pending' and scheduled_for <= statement_timestamp())
         as due_company_requests,
       (select count(*)::int from security_audit_events
         where created_at < statement_timestamp() - make_interval(days => $1::int))
         as expired_audit_events,
       (select count(*)::int from executions
         where created_at < statement_timestamp() - make_interval(days => $2::int))
         as expired_executions`,
    [policy.securityAuditDays, policy.executionDays],
  );
  const row = rows[0] ?? {};
  return {
    dueAccountRequests: Number(row.due_account_requests ?? 0),
    dueCompanyRequests: Number(row.due_company_requests ?? 0),
    expiredAuditEvents: Number(row.expired_audit_events ?? 0),
    expiredExecutions: Number(row.expired_executions ?? 0),
  };
}

interface ClaimedAccountRequest {
  id: string;
  tenantId: string | null;
  targetUserId: string | null;
}

async function claimAccountRequest(pool: pg.Pool): Promise<ClaimedAccountRequest | null> {
  return transaction(pool, async (client) => {
    const { rows } = await client.query(
      `select id, tenant_id, target_user_id
         from data_deletion_requests
        where scope='account'
          and (
            (status='pending' and scheduled_for <= statement_timestamp())
            or (status='processing' and updated_at < statement_timestamp() - interval '15 minutes')
          )
        order by scheduled_for, id
        for update skip locked
        limit 1`,
    );
    const row = rows[0];
    if (!row) return null;
    await client.query(
      `update data_deletion_requests
          set status='processing', attempt_count=attempt_count+1,
              last_failure_code=null, updated_at=statement_timestamp()
        where id=$1`,
      [row.id],
    );
    return {
      id: row.id,
      tenantId: row.tenant_id ?? null,
      targetUserId: row.target_user_id ?? null,
    };
  });
}

async function accountWouldLoseLastOwner(pool: pg.Pool, userId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `select exists (
       select 1
         from tenant_memberships mine
        where mine.user_id=$1
          and mine.role='owner' and mine.status='active'
          and not exists (
            select 1 from tenant_memberships another
             where another.tenant_id=mine.tenant_id
               and another.user_id<>mine.user_id
               and another.role='owner' and another.status='active'
          )
     ) as blocked`,
    [userId],
  );
  return Boolean(rows[0]?.blocked);
}

async function markAccountFailure(
  pool: pg.Pool,
  request: ClaimedAccountRequest,
  failureCode: "last_owner" | "supabase_admin_delete_failed",
): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query(
      `update data_deletion_requests
          set status='failed', last_failure_code=$2, updated_at=statement_timestamp()
        where id=$1 and status='processing'`,
      [request.id, failureCode],
    );
    if (request.tenantId) {
      await client.query(
        `insert into security_audit_events
          (tenant_id,event_type,target_type,target_id,metadata)
         values ($1,'privacy.account_deletion.failed','data_deletion_request',$2,
                 jsonb_build_object('failure_code',$3::text))`,
        [request.tenantId, request.id, failureCode],
      );
    }
  });
}

async function markAccountCompleted(pool: pg.Pool, request: ClaimedAccountRequest): Promise<void> {
  await transaction(pool, async (client) => {
    await client.query(
      `update data_deletion_requests
          set status='completed', completed_at=statement_timestamp(),
              last_failure_code=null, updated_at=statement_timestamp()
        where id=$1 and status='processing'`,
      [request.id],
    );
    if (request.tenantId) {
      await client.query(
        `insert into security_audit_events
          (tenant_id,event_type,target_type,target_id,metadata)
         values ($1,'privacy.account_deletion.completed','data_deletion_request',$2,
                 jsonb_build_object('auth_identity_deleted',true))`,
        [request.tenantId, request.id],
      );
    }
  });
}

export async function processDueAccountDeletions(input: {
  pool: pg.Pool;
  admin: SupabaseAdminUserDeleter;
  limit?: number;
}): Promise<{ processed: number; failed: number }> {
  await assertOwnerMaintenanceConnection(input.pool);
  const limit = maintenanceBatchLimit(input.limit);
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < limit; index += 1) {
    const request = await claimAccountRequest(input.pool);
    if (!request) break;
    if (!request.targetUserId) {
      await markAccountCompleted(input.pool, request);
      processed += 1;
      continue;
    }
    if (await accountWouldLoseLastOwner(input.pool, request.targetUserId)) {
      await markAccountFailure(input.pool, request, "last_owner");
      failed += 1;
      continue;
    }
    try {
      await input.admin.deleteUser(request.targetUserId);
    } catch {
      // Never persist or log an upstream response body. The fixed category is
      // enough for alerting while credentials/provider details remain secret.
      await markAccountFailure(input.pool, request, "supabase_admin_delete_failed");
      failed += 1;
      continue;
    }
    // Even though a deleted Supabase JWT remains cryptographically valid
    // until exp, auth-user FK cascades remove every active membership and
    // Brian's principal resolver therefore rejects it immediately. Keep this
    // outside the provider catch: if the completion write fails, the request
    // remains processing and the stale-claim path retries idempotently (404).
    await markAccountCompleted(input.pool, request);
    processed += 1;
  }
  return { processed, failed };
}

async function processOneCompanyDeletion(pool: pg.Pool): Promise<boolean> {
  return transaction(pool, async (client) => {
    const { rows } = await client.query(
      `select id, tenant_id
         from data_deletion_requests
        where scope='company' and status='pending'
          and scheduled_for <= statement_timestamp()
          and tenant_id is not null
        order by scheduled_for, id
        for update skip locked
        limit 1`,
    );
    const request = rows[0];
    if (!request) return false;
    await client.query(
      `update data_deletion_requests
          set status='processing', attempt_count=attempt_count+1,
              last_failure_code=null, updated_at=statement_timestamp()
        where id=$1`,
      [request.id],
    );

    const tenantId = request.tenant_id as string;
    // FK-safe order. Security audit and deletion-request evidence are retained;
    // their tenant FKs become NULL when the tenant row is removed.
    await client.query("delete from evidence where tenant_id=$1", [tenantId]);
    await client.query("delete from connectors where tenant_id=$1", [tenantId]);
    await client.query("delete from interviews where tenant_id=$1", [tenantId]);
    await client.query("delete from executions where tenant_id=$1", [tenantId]);
    await client.query("delete from skill_links where tenant_id=$1", [tenantId]);
    await client.query("delete from skill_versions where tenant_id=$1", [tenantId]);
    await client.query("delete from skills where tenant_id=$1", [tenantId]);
    await client.query("delete from context_versions where tenant_id=$1", [tenantId]);
    await client.query("delete from context_entries where tenant_id=$1", [tenantId]);
    await client.query("delete from users where tenant_id=$1", [tenantId]);
    await client.query("delete from oauth_states where tenant_id=$1", [tenantId]);
    await client.query("delete from api_tokens where tenant_id=$1", [tenantId]);

    await client.query(
      `insert into security_audit_events
        (tenant_id,event_type,target_type,target_id,metadata)
       values ($1,'privacy.company_deletion.completed','data_deletion_request',$2,
               jsonb_build_object('tenant_data_deleted',true))`,
      [tenantId, request.id],
    );
    await client.query(
      `update data_deletion_requests
          set status='completed', completed_at=statement_timestamp(),
              updated_at=statement_timestamp()
        where id=$1`,
      [request.id],
    );
    await client.query("delete from tenants where id=$1", [tenantId]);
    return true;
  });
}

export async function processDueCompanyDeletions(
  pool: pg.Pool,
  limitValue?: number,
): Promise<number> {
  await assertOwnerMaintenanceConnection(pool);
  const limit = maintenanceBatchLimit(limitValue);
  let processed = 0;
  while (processed < limit && await processOneCompanyDeletion(pool)) processed += 1;
  return processed;
}

export async function pruneRetention(input: {
  pool: pg.Pool;
  policy?: RetentionPolicy;
  limit?: number;
}): Promise<{ auditEvents: number; executions: number }> {
  await assertOwnerMaintenanceConnection(input.pool);
  const policy = input.policy ?? retentionPolicy();
  const limit = maintenanceBatchLimit(input.limit);
  return transaction(input.pool, async (client) => {
    const executions = await client.query(
      `with doomed as materialized (
         select id from executions
          where created_at < statement_timestamp() - make_interval(days => $1::int)
          order by created_at, id limit $2
       )
       delete from executions e using doomed d where e.id=d.id
       returning e.id`,
      [policy.executionDays, limit],
    );
    const auditEvents = await client.query(
      `with doomed as materialized (
         select id from security_audit_events
          where created_at < statement_timestamp() - make_interval(days => $1::int)
          order by created_at, id limit $2
       )
       delete from security_audit_events e using doomed d where e.id=d.id
       returning e.id`,
      [policy.securityAuditDays, limit],
    );
    await client.query(
      `insert into security_audit_events
        (event_type,target_type,metadata)
       values ('privacy.retention.pruned','retention_policy',
         jsonb_build_object(
           'security_audit_days',$1::int,
           'execution_days',$2::int,
           'audit_events_deleted',$3::int,
           'executions_deleted',$4::int
         ))`,
      [policy.securityAuditDays, policy.executionDays, auditEvents.rowCount ?? 0, executions.rowCount ?? 0],
    );
    return {
      auditEvents: auditEvents.rowCount ?? 0,
      executions: executions.rowCount ?? 0,
    };
  });
}
