import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadServerEnv } from "./env.js";
import { connectionSource, resolveConnectionString, makePool } from "./db/pool.js";

describe("loadServerEnv", () => {
  it("loads vars from an env file without overriding existing ones", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brian-env-"));
    const file = path.join(dir, ".env");
    fs.writeFileSync(file, "BRIAN_TEST_FRESH=hello\nBRIAN_TEST_EXISTING=from_file\n");
    process.env.BRIAN_TEST_EXISTING = "already_set";
    delete process.env.BRIAN_TEST_FRESH;

    loadServerEnv(file);

    expect(process.env.BRIAN_TEST_FRESH).toBe("hello");
    expect(process.env.BRIAN_TEST_EXISTING).toBe("already_set");
  });

  it("is a no-op when the file does not exist", () => {
    expect(() => loadServerEnv("/nonexistent/path/.env")).not.toThrow();
  });
});

describe("resolveConnectionString", () => {
  const VARS = ["VITEST", "DATABASE_URL", "TEST_DATABASE_URL", "SUPABASE_DB_URL"] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  });
  afterEach(() => {
    for (const k of VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("prefers TEST_DATABASE_URL under Vitest so tests never touch live public", () => {
    process.env.VITEST = "true";
    process.env.TEST_DATABASE_URL = "postgres://test";
    process.env.DATABASE_URL = "postgres://prod";
    expect(connectionSource()).toBe("TEST_DATABASE_URL");
    expect(resolveConnectionString()).toBe("postgres://test");
  });

  it("prefers an explicit DATABASE_URL over the platform SUPABASE_DB_URL in production", () => {
    delete process.env.VITEST;
    delete process.env.TEST_DATABASE_URL;
    process.env.DATABASE_URL = "postgres://brian_app@pooler";
    process.env.SUPABASE_DB_URL = "postgres://postgres@direct";
    expect(connectionSource()).toBe("DATABASE_URL");
    expect(resolveConnectionString()).toBe("postgres://brian_app@pooler");
  });

  it("falls back to SUPABASE_DB_URL only when no explicit DATABASE_URL is set", () => {
    delete process.env.VITEST;
    delete process.env.DATABASE_URL;
    delete process.env.TEST_DATABASE_URL;
    process.env.SUPABASE_DB_URL = "postgres://postgres@direct";
    expect(connectionSource()).toBe("SUPABASE_DB_URL");
    expect(resolveConnectionString()).toBe("postgres://postgres@direct");
  });

  it("resolves nothing and makePool throws a clear error when every source is empty", () => {
    delete process.env.VITEST;
    for (const k of ["DATABASE_URL", "TEST_DATABASE_URL", "SUPABASE_DB_URL"]) delete process.env[k];
    expect(connectionSource()).toBeNull();
    expect(resolveConnectionString()).toBeUndefined();
    expect(() => makePool()).toThrow(/DATABASE_URL is not set/);
  });
});
