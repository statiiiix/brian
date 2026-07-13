import type pg from "pg";

// Truncate all Company Brain tables in foreign-key-safe order. DB-backed test
// files share one database, so each must fully reset before a test to avoid
// FK violations from rows another file (or an earlier test) left behind.
export async function resetDb(pool: pg.Pool): Promise<void> {
  await pool.query("delete from data_deletion_requests");
  await pool.query("delete from security_audit_events");
  await pool.query("delete from onboarding_state");
  await pool.query("delete from agent_connections");
  await pool.query("delete from tenant_invitations");
  // Migration 010 makes the final active owner a deferred database invariant.
  // Keep exactly one deterministic active owner for every tenant that already
  // has one; all non-owner and surplus-owner fixtures are still reset.
  await pool.query(
    `with retained_owner as materialized (
       select distinct on (tenant_id) id
         from tenant_memberships
        where role='owner' and status='active'
        order by tenant_id, created_at, id
     )
     delete from tenant_memberships membership
      where not exists (
        select 1 from retained_owner where retained_owner.id=membership.id
      )`,
  );
  await pool.query("delete from oauth_states");
  await pool.query("delete from evidence");
  await pool.query("delete from connectors");
  await pool.query("delete from interviews");
  await pool.query("delete from executions");
  await pool.query("delete from skill_versions");
  await pool.query("delete from skill_links");
  await pool.query("delete from skills");
  await pool.query("delete from context_versions");
  await pool.query("delete from context_entries");
}
