import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import {
  MIGRATION_ADVISORY_LOCK_KEYS,
  runMigrations,
  withMigrationLock,
} from "./migrate.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

describe("runMigrations connection discipline", () => {
  it("uses one dedicated client with the advisory lock around every file", async () => {
    const calls: string[] = [];
    const release = vi.fn();
    const client = {
      query: vi.fn(async (text: string) => {
        calls.push(text);
        return text.includes("pg_advisory_unlock")
          ? { rows: [{ unlocked: true }] }
          : { rows: [{}] };
      }),
      release,
    } as unknown as pg.PoolClient;
    const directQuery = vi.fn();
    const connect = vi.fn(async () => client);
    const fakePool = { connect, query: directQuery } as unknown as pg.Pool;

    await runMigrations(fakePool);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(directQuery).not.toHaveBeenCalled();
    expect(calls[0]).toContain("pg_advisory_lock");
    expect(calls.at(-1)).toContain("pg_advisory_unlock");
    expect(calls.length).toBeGreaterThan(2);
    expect(release).toHaveBeenCalledWith();
  });

  it("preserves a migration failure, unlocks, and destroys the client", async () => {
    const marker = new Error("synthetic migration failure");
    const calls: string[] = [];
    const release = vi.fn();
    const client = {
      query: vi.fn(async (text: string) => {
        calls.push(text);
        if (text.includes("pg_advisory_lock")) return { rows: [{}] };
        if (text.includes("pg_advisory_unlock")) return { rows: [{ unlocked: true }] };
        throw marker;
      }),
      release,
    } as unknown as pg.PoolClient;
    const fakePool = { connect: vi.fn(async () => client) } as unknown as pg.Pool;

    await expect(runMigrations(fakePool)).rejects.toBe(marker);
    expect(calls[0]).toContain("pg_advisory_lock");
    expect(calls.at(-1)).toContain("pg_advisory_unlock");
    expect(release).toHaveBeenCalledWith(true);
  });

  it("fails closed and destroys the client if explicit unlock is lost", async () => {
    const release = vi.fn();
    const client = {
      query: vi.fn(async (text: string) => text.includes("pg_advisory_unlock")
        ? { rows: [{ unlocked: false }] }
        : { rows: [{}] }),
      release,
    } as unknown as pg.PoolClient;
    const fakePool = { connect: vi.fn(async () => client) } as unknown as pg.Pool;

    await expect(runMigrations(fakePool)).rejects.toThrow(/advisory lock was not held/i);
    expect(release).toHaveBeenCalledWith(true);
  });
});

d("runMigrations", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await runMigrations(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("creates the core tables", async () => {
    const { rows } = await pool.query(
      `select table_name from information_schema.tables
       where table_schema = current_schema()
         and table_name in ('skills','skill_versions','skill_links','executions')`
    );
    const names = rows.map((r) => r.table_name).sort();
    expect(names).toEqual(["executions", "skill_links", "skill_versions", "skills"]);
  });

  it("enables the vector extension", async () => {
    const { rows } = await pool.query(
      `select 1 from pg_extension where extname = 'vector'`
    );
    expect(rows.length).toBe(1);
  });

  it("serializes a concurrent full replay behind the advisory lock", async () => {
    const blocker = await pool.connect();
    let blockerLockHeld = false;
    let contenderFinished = false;
    let contenderError: unknown;
    let contender: Promise<void> | null = null;
    try {
      await blocker.query(
        "select pg_advisory_lock($1::integer,$2::integer)",
        [...MIGRATION_ADVISORY_LOCK_KEYS],
      );
      blockerLockHeld = true;
      contender = runMigrations(pool).then(
        () => { contenderFinished = true; },
        (error) => { contenderFinished = true; contenderError = error; },
      );

      let waiting = false;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const { rows } = await pool.query(
          `select exists (
             select 1 from pg_locks
              where locktype='advisory'
                and classid=$1::integer::oid
                and objid=$2::integer::oid
                and not granted
           ) as waiting`,
          [...MIGRATION_ADVISORY_LOCK_KEYS],
        );
        if (rows[0].waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(waiting).toBe(true);
      expect(contenderFinished).toBe(false);
      await blocker.query(
        "select pg_advisory_unlock($1::integer,$2::integer)",
        [...MIGRATION_ADVISORY_LOCK_KEYS],
      );
      blockerLockHeld = false;
      await contender;
      if (contenderError) throw contenderError;
    } finally {
      if (blockerLockHeld) {
        try {
          await blocker.query(
            "select pg_advisory_unlock($1::integer,$2::integer)",
            [...MIGRATION_ADVISORY_LOCK_KEYS],
          );
          blockerLockHeld = false;
        } catch {
          // release(true) below closes the session and releases its lock.
        }
      }
      if (blockerLockHeld) blocker.release(true);
      else blocker.release();
      // If an assertion failed while the contender was blocked, releasing the
      // blocker above lets it finish before this test tears down the pool.
      if (contender) await contender;
    }
  }, 30_000);

  it("releases the real advisory lock when migration work fails", async () => {
    const marker = new Error("synthetic migration failure");
    await expect(withMigrationLock(pool, async () => {
      throw marker;
    })).rejects.toBe(marker);

    const checker = await pool.connect();
    try {
      const { rows } = await checker.query<{ acquired: boolean }>(
        "select pg_try_advisory_lock($1::integer,$2::integer) as acquired",
        [...MIGRATION_ADVISORY_LOCK_KEYS],
      );
      expect(rows[0].acquired).toBe(true);
      await checker.query(
        "select pg_advisory_unlock($1::integer,$2::integer)",
        [...MIGRATION_ADVISORY_LOCK_KEYS],
      );
    } finally {
      checker.release();
    }
  });
});
