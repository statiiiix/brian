import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    hookTimeout: 30000,
    testTimeout: 30000,
    // DB-backed test files share one database and each cleans tables in
    // beforeEach. Run files serially so they don't wipe each other's rows.
    fileParallelism: false,
  },
});
