import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadServerEnv } from "./env.js";

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
