import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { pool as defaultPool } from "./pool.js";

const here = dirname(fileURLToPath(import.meta.url));

// Two positive int32 keys spelling "BRIANMIG" keep this lock stable across
// processes and releases without relying on PostgreSQL's hash functions.
export const MIGRATION_ADVISORY_LOCK_KEYS = [0x42524941, 0x4e4d4947] as const;

/**
 * Hold one session-level advisory lock on one checked-out client for the full
 * callback. Migrations intentionally remain idempotent, file-by-file
 * autocommit operations; a single transaction here would change their failure
 * and future DDL compatibility semantics. The migration URL must therefore be
 * a direct or session-mode connection, not a transaction-pooler endpoint.
 */
export async function withMigrationLock<T>(
  p: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await p.connect();
  let lockAcquired = false;
  let failed = false;
  let cleanupFailed = false;
  let cleanupError: unknown;

  try {
    await client.query(
      "select pg_advisory_lock($1::integer,$2::integer)",
      [...MIGRATION_ADVISORY_LOCK_KEYS],
    );
    lockAcquired = true;
    return await fn(client);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (lockAcquired) {
      try {
        const { rows } = await client.query<{ unlocked: boolean }>(
          "select pg_advisory_unlock($1::integer,$2::integer) as unlocked",
          [...MIGRATION_ADVISORY_LOCK_KEYS],
        );
        if (rows[0]?.unlocked !== true) {
          throw new Error("migration advisory lock was not held by the dedicated client");
        }
      } catch (error) {
        cleanupFailed = true;
        cleanupError = error;
      }
    }

    // Never return a possibly locked or transaction-aborted session to the
    // pool. Destroying it also makes PostgreSQL release any session lock if an
    // explicit unlock was impossible after a connection/query failure.
    if (failed || cleanupFailed) client.release(true);
    else client.release();

    // Preserve the migration's primary error when both work and cleanup fail.
    if (!failed && cleanupFailed) throw cleanupError;
  }
}

export async function runMigrations(p: pg.Pool = defaultPool): Promise<void> {
  const dir = join(here, "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  await withMigrationLock(p, async (client) => {
    for (const file of files) {
      const sql = readFileSync(join(dir, file), "utf8");
      await client.query(sql);
    }
  });
}

// Allow `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log("migrations applied");
      return defaultPool.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
