import pg from "pg";

const { Pool } = pg;

// Under Vitest, prefer TEST_DATABASE_URL (which carries search_path=test,public)
// so tests operate in the `test` schema and never truncate live `public` data.
// Outside tests, use DATABASE_URL.
function resolveConnectionString(): string | undefined {
  return process.env.VITEST
    ? process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
    : process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
}

export function makePool(connectionString = resolveConnectionString()): pg.Pool {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new Pool({ connectionString });
}

// Lazily-initialized shared pool. Created on first use (not at import) so that
// importing modules — e.g. when a DB-backed test file is loaded but skipped
// because no DB URL is configured — never throws.
let _pool: pg.Pool | null = null;
function instance(): pg.Pool {
  if (!_pool) _pool = makePool();
  return _pool;
}

export const pool: pg.Pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    const real = instance() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});
