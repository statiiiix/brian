import type pg from "pg";

// Truncate all Company Brain tables in foreign-key-safe order. DB-backed test
// files share one database, so each must fully reset before a test to avoid
// FK violations from rows another file (or an earlier test) left behind.
export async function resetDb(pool: pg.Pool): Promise<void> {
  await pool.query("delete from executions");
  await pool.query("delete from skill_versions");
  await pool.query("delete from skill_links");
  await pool.query("delete from skills");
}
