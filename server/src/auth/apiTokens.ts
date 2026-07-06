import { createHash } from "node:crypto";
import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";

// sha256 hex of a bearer token — only the hash is ever stored (api_tokens).
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Resolve a plaintext bearer to its tenant id, or null if the token is unknown,
// revoked, or its tenant is not active. Runs on the pool: this is what decides
// the tenant, so it must not itself be tenant-scoped.
export async function tenantForToken(
  token: string,
  p: pg.Pool = defaultPool,
): Promise<string | null> {
  const { rows } = await p.query(
    `select t.id
       from api_tokens a
       join tenants t on t.id = a.tenant_id
      where a.token_hash = $1 and a.revoked_at is null and t.status = 'active'`,
    [hashToken(token)],
  );
  return rows[0]?.id ?? null;
}

// Idempotently ensure an api_tokens row for (tenant, plaintext token). Used to
// migrate the single global BRIAN_API_TOKEN into the founding tenant's first
// token, and to mint tokens later.
export async function ensureToken(
  tenantId: string,
  token: string,
  label: string,
  p: pg.Pool = defaultPool,
): Promise<void> {
  await p.query(
    `insert into api_tokens (tenant_id, token_hash, label)
     values ($1, $2, $3)
     on conflict (token_hash) do nothing`,
    [tenantId, hashToken(token), label],
  );
}
