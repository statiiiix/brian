import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXECUTION_RETENTION_DAYS,
  DEFAULT_SECURITY_AUDIT_RETENTION_DAYS,
  SupabaseAdminDeletionError,
  createSupabaseAdminUserDeleter,
  maintenanceBatchLimit,
  retentionPolicy,
} from "./maintenance.js";
import { parseMaintenanceCli } from "./maintenanceCli.js";

describe("privacy maintenance policy", () => {
  it("defaults audit evidence to 365 days and executions to 180 days", () => {
    expect(retentionPolicy({})).toEqual({
      securityAuditDays: DEFAULT_SECURITY_AUDIT_RETENTION_DAYS,
      executionDays: DEFAULT_EXECUTION_RETENTION_DAYS,
    });
    expect(retentionPolicy({
      SECURITY_AUDIT_RETENTION_DAYS: "730",
      EXECUTION_LOG_RETENTION_DAYS: "90",
    })).toEqual({ securityAuditDays: 730, executionDays: 90 });
  });

  it("is dry-run by default and requires explicit --confirm", () => {
    expect(parseMaintenanceCli([])).toEqual({
      processDue: true,
      prune: true,
      confirm: false,
      limit: 1_000,
      help: false,
    });
    expect(parseMaintenanceCli(["--prune-retention", "--limit", "25", "--confirm"]))
      .toEqual({ processDue: false, prune: true, confirm: true, limit: 25, help: false });
    expect(() => maintenanceBatchLimit(0)).toThrow(/between 1 and 10000/);
  });
});

describe("Supabase Admin user deleter", () => {
  it("hard-deletes through the server-only endpoint and treats 404 as idempotent success", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const deleter = createSupabaseAdminUserDeleter({
      supabaseUrl: "https://project.supabase.co/",
      serviceRoleKey: "test-server-secret-never-logged",
      fetchImpl,
    });
    const userId = "10000000-0000-4000-8000-000000000014";
    await deleter.deleteUser(userId);
    await deleter.deleteUser(userId);
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://project.supabase.co/auth/v1/admin/users/${userId}`,
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ should_soft_delete: false }),
      }),
    );
  });

  it("returns only a fixed status category on provider failure", async () => {
    const deleter = createSupabaseAdminUserDeleter({
      supabaseUrl: "https://project.supabase.co",
      serviceRoleKey: "test-server-secret-never-logged",
      fetchImpl: vi.fn().mockResolvedValue(new Response("sensitive provider diagnostic", { status: 503 })),
    });
    const error = await deleter.deleteUser("10000000-0000-4000-8000-000000000014")
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(SupabaseAdminDeletionError);
    expect(String(error)).toContain("503");
    expect(String(error)).not.toContain("sensitive provider diagnostic");
    expect(String(error)).not.toContain("test-server-secret-never-logged");
  });
});
