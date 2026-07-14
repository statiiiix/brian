import { describe, expect, it } from "vitest";
import { parseDcrMaintenanceArgs, readDcrMaintenanceConfig } from "./dcrMaintenanceCli.js";

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
    expect(() => readDcrMaintenanceConfig({})).toThrow(
      "SUPABASE_URL, SUPABASE_SECRET_KEY, and DCR_MAINTENANCE_DATABASE_URL are required",
    );
    expect(readDcrMaintenanceConfig({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: "never-print-secret",
      DCR_MAINTENANCE_DATABASE_URL: "postgres://never-print-database",
      DCR_PROTECTED_CLIENT_IDS: " manual-one,manual-two,manual-one ",
    })).toEqual({
      supabaseUrl: "https://project.supabase.co",
      secretKey: "never-print-secret",
      databaseUrl: "postgres://never-print-database",
      protectedClientIds: new Set(["manual-one", "manual-two"]),
    });
  });
});
