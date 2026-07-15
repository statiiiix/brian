import { describe, expect, it } from "vitest";
import {
  assertDcrMaintenanceSucceeded,
  parseDcrMaintenanceArgs,
  readDcrMaintenanceConfig,
} from "./dcrMaintenanceCli.js";

describe("DCR maintenance CLI", () => {
  it("defaults to audit and requires explicit confirmation for cleanup", () => {
    expect(parseDcrMaintenanceArgs([])).toEqual({ mode: "audit", help: false });
    expect(parseDcrMaintenanceArgs(["--delete-stale", "--yes"]))
      .toEqual({ mode: "cleanup", help: false });
    expect(() => parseDcrMaintenanceArgs(["--delete-stale"]))
      .toThrow("--delete-stale requires --yes");
    expect(() => parseDcrMaintenanceArgs(["--yes"]))
      .toThrow("--yes requires --delete-stale");
    expect(() => parseDcrMaintenanceArgs(["--unknown"]))
      .toThrow("unknown DCR maintenance option");
  });

  it("requires server-only inputs without exposing values", () => {
    expect(() => readDcrMaintenanceConfig({}, "cleanup")).toThrow(
      "SUPABASE_URL and DCR_MAINTENANCE_DATABASE_URL are required",
    );
    expect(readDcrMaintenanceConfig({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: "never-print-secret",
      DCR_MAINTENANCE_DATABASE_URL: "postgres://never-print-database",
      DCR_PROTECTED_CLIENT_IDS: " manual-one,manual-two,manual-one ",
    }, "cleanup")).toEqual({
      supabaseUrl: "https://project.supabase.co",
      secretKey: "never-print-secret",
      databaseUrl: "postgres://never-print-database",
      publicConfigUrl: "https://api.brianthebrain.app/api/public/config",
      protectedClientIds: new Set(["manual-one", "manual-two"]),
    });

    expect(readDcrMaintenanceConfig({
      SUPABASE_URL: "https://project.supabase.co",
      DCR_MAINTENANCE_DATABASE_URL: "postgres://never-print-database",
    }, "audit")).toMatchObject({ secretKey: null });
    expect(() => readDcrMaintenanceConfig({
      SUPABASE_URL: "https://project.supabase.co",
      DCR_MAINTENANCE_DATABASE_URL: "postgres://never-print-database",
    }, "cleanup")).toThrow("SUPABASE_SECRET_KEY is required for DCR cleanup");

    for (const unsafe of ["http://project.supabase.co", "https://evil.example/path", "https://user@evil.example"]) {
      expect(() => readDcrMaintenanceConfig({
        SUPABASE_URL: unsafe,
        SUPABASE_SECRET_KEY: "never-print-secret",
        DCR_MAINTENANCE_DATABASE_URL: "postgres://never-print-database",
      }, "cleanup")).toThrow(/^DCR maintenance configuration failed$/);
    }
    expect(() => readDcrMaintenanceConfig({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: "never-print-secret",
      DCR_MAINTENANCE_DATABASE_URL: "postgres://never-print-database",
      BRIAN_PUBLIC_CONFIG_URL: "https://attacker.example/api/public/config",
    }, "cleanup")).toThrow(/^DCR maintenance configuration failed$/);
  });

  it("turns any cleanup failure into a fixed nonzero-workflow error", () => {
    expect(() => assertDcrMaintenanceSucceeded({
      failed: 0, markerDrift: false, cleanupBlocked: false,
    })).not.toThrow();
    expect(() => assertDcrMaintenanceSucceeded({ failed: 1, markerDrift: false, cleanupBlocked: false }))
      .toThrow(/^DCR maintenance completed with failures$/);
    expect(() => assertDcrMaintenanceSucceeded({ failed: 0, markerDrift: true, cleanupBlocked: false }))
      .toThrow(/^DCR maintenance marker drift detected$/);
    expect(() => assertDcrMaintenanceSucceeded({
      failed: 0, markerDrift: false, cleanupBlocked: true,
    })).toThrow(/^DCR cleanup requires provider DCR and Brian approvals to be paused$/);
  });
});
