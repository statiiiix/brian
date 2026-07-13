import { createHash } from "node:crypto";
import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import { currentUserId } from "../db/tenant.js";

// sha256 hex of a bearer token — only the hash is ever stored (api_tokens).
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Resolve through the narrow security-definer function introduced in 012 and
// hardened with expiry/usage tracking in migration 013.
// brian_app therefore never needs broad pre-tenant SELECT access to token
// hashes or the tenants table.
export async function tenantForToken(
  token: string,
  p: pg.Pool = defaultPool,
): Promise<string | null> {
  const { rows } = await p.query(
    "select tenant_id from resolve_legacy_agent_token($1::text)",
    [hashToken(token)],
  );
  return rows[0]?.tenant_id ?? null;
}

function normalizeFutureExpiry(expiresAt: Date | string): string {
  const expiry = expiresAt instanceof Date ? new Date(expiresAt.getTime()) : new Date(expiresAt);
  if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) {
    throw new Error("legacy token expiry must be a valid future timestamp");
  }
  return expiry.toISOString();
}

async function insertToken(
  tenantId: string,
  token: string,
  label: string,
  expiresAt: string | null,
  p: pg.Pool,
): Promise<void> {
  await p.query(
    `insert into api_tokens (tenant_id, token_hash, label, expires_at, created_by_user_id)
     values ($1, $2, $3, $4, $5)
     on conflict (token_hash) do nothing`,
    // Bootstrap/import calls have no human principal and remain deliberately
    // unattributed. A verified runtime human is recorded so an account
    // deletion can revoke only that person's applicable legacy credentials.
    [tenantId, hashToken(token), label, expiresAt, currentUserId()],
  );
}

// Idempotently issue a legacy token with an explicit future expiry. OAuth is
// the normal agent path; requiring this date prevents new indefinite bearer
// credentials while existing NULL-expiry rows continue to resolve.
export async function ensureToken(
  tenantId: string,
  token: string,
  label: string,
  expiresAt: Date | string,
  p: pg.Pool = defaultPool,
): Promise<void> {
  await insertToken(tenantId, token, label, normalizeFutureExpiry(expiresAt), p);
}

// Compatibility-only bootstrap for the pre-existing BRIAN_API_TOKEN. Do not
// use this for new credentials; it intentionally preserves the old null-expiry
// behavior so the additive rollout cannot lock out founding installations.
export async function ensureLegacyToken(
  tenantId: string,
  token: string,
  label: string,
  p: pg.Pool = defaultPool,
): Promise<void> {
  await insertToken(tenantId, token, label, null, p);
}
