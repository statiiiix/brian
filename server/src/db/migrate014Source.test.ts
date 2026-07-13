import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("./migrations/014_privacy_deletion_and_retention.sql", import.meta.url),
  "utf8",
);

describe("migration 014 lifecycle serialization source contract", () => {
  it("uses one account-deletion advisory key in both credential guards and scheduling", () => {
    expect(migration.match(/pg_advisory_xact_lock/g)).toHaveLength(3);
    expect(migration.match(/'brian:account-deletion:' \|\|/g)).toHaveLength(3);
    expect(migration).toContain("constraint = 'account_deletion_pending'");
  });

  it("invalidates outstanding OAuth states before erasing company connectors", () => {
    const revokeState = migration.indexOf("update %I.oauth_states\n             set used_at");
    const eraseConnector = migration.indexOf("update %I.connectors\n             set status = 'disabled'");
    expect(revokeState).toBeGreaterThan(0);
    expect(eraseConnector).toBeGreaterThan(revokeState);
    expect(migration).toContain("'revoked_oauth_states', v_revoked_oauth_states");
  });

  it("guards both callback state consumption and secret-bearing connector writes", () => {
    expect(migration).toContain("create or replace function %I.consume_oauth_state");
    expect(migration).toContain("create or replace function %I.brian_guard_connector_during_company_deletion");
    expect(migration).toContain("create trigger brian_guard_deleting_company_connector");
    expect(migration).toContain("constraint = 'company_deletion_pending'");
    expect(migration.match(/tenant\.status = 'active'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration.match(/for share;/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
