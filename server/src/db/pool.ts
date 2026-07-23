import pg from "pg";

const { Pool } = pg;

// Under Vitest, prefer TEST_DATABASE_URL (which carries search_path=test,public)
// so tests operate in the `test` schema and never truncate live `public` data.
// Outside tests, prefer an explicit DATABASE_URL (in production, the brian_app
// pooler URL) then TEST_DATABASE_URL, then the platform-injected SUPABASE_DB_URL
// as a last resort. That fallback works but is the direct, IPv6, `postgres`-owner
// connection: it bypasses RLS and can be briefly absent on a freshly cold-started
// isolate — which is exactly how a request ends up with no connection string and
// throws "DATABASE_URL is not set". Setting an explicit DATABASE_URL secret gives
// every isolate a stable source and removes that dependency.
const CONNECTION_ENV_VARS = ["DATABASE_URL", "TEST_DATABASE_URL", "SUPABASE_DB_URL"] as const;
type ConnectionEnvVar = (typeof CONNECTION_ENV_VARS)[number];

// Which env var supplies the connection string, or null if none is set. Exposed
// so callers can log the source (never the value) for observability.
export function connectionSource(): ConnectionEnvVar | null {
  if (process.env.VITEST) {
    if (process.env.TEST_DATABASE_URL) return "TEST_DATABASE_URL";
    if (process.env.DATABASE_URL) return "DATABASE_URL";
    return null;
  }
  for (const name of CONNECTION_ENV_VARS) {
    if (process.env[name]) return name;
  }
  return null;
}

export function resolveConnectionString(): string | undefined {
  const source = connectionSource();
  return source ? process.env[source] : undefined;
}

export function makePool(connectionString = resolveConnectionString()): pg.Pool {
  if (!connectionString) {
    // Loud, source-naming diagnostic (the connection string itself is never
    // logged). In production this is the difference between an invisible
    // HTTP-200 JSON-RPC error surfacing to a user and an operator seeing
    // exactly why this isolate cannot reach the database.
    console.error(
      "[db] no database connection string in this isolate's environment " +
        `(checked ${CONNECTION_ENV_VARS.join(", ")}; VITEST=${process.env.VITEST ? "1" : "0"}). ` +
        "Set an explicit DATABASE_URL secret (the brian_app pooler URL) so every isolate " +
        "has a stable source instead of depending on the platform-injected SUPABASE_DB_URL.",
    );
    throw new Error("DATABASE_URL is not set");
  }
  return new Pool({ connectionString });
}

// Lazily-initialized shared pool. Created on first use (not at import) so that
// importing modules — e.g. when a DB-backed test file is loaded but skipped
// because no DB URL is configured — never throws.
let _pool: pg.Pool | null = null;
function instance(): pg.Pool {
  if (!_pool) {
    const source = connectionSource();
    _pool = makePool();
    // One line per isolate. Surfaces in prod whether we are on the stable
    // explicit DATABASE_URL or the riskier SUPABASE_DB_URL fallback.
    console.info(`[db] pool initialized (source: ${source ?? "unknown"})`);
  }
  return _pool;
}

export const pool: pg.Pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    const real = instance() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
});
