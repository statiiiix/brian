import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../../../.github/workflows/dcr-maintenance.yml", import.meta.url),
  "utf8",
);

describe("DCR maintenance workflow privilege boundaries", () => {
  it("protects every secret-bearing job with the production environment", () => {
    expect(workflow.match(/environment: production/g)).toHaveLength(2);
  });

  it("scopes privileged secrets only to maintenance command steps", () => {
    const jobLevelSecretBlocks = workflow.match(/^    env:\n(?:      .*\n)+/gm) ?? [];
    expect(jobLevelSecretBlocks).toEqual([]);
    expect(workflow.match(/SUPABASE_SECRET_KEY: \$\{\{ secrets\.SUPABASE_SECRET_KEY \}\}/g))
      .toHaveLength(2);
    expect(workflow.match(/DCR_MAINTENANCE_DATABASE_URL: \$\{\{ secrets\.DCR_MAINTENANCE_DATABASE_URL \}\}/g))
      .toHaveLength(2);
  });
});
