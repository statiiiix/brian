import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("../../scripts/set-connector-oauth.sh", import.meta.url), "utf8");
const guide = readFileSync(new URL("../../../docs/connector-oauth-setup.md", import.meta.url), "utf8");
const app = readFileSync(new URL("../api/app.ts", import.meta.url), "utf8");

describe("connector setup artifacts", () => {
  it("reads the OAuth client secret without accepting it as an argv value", () => {
    expect(script).toContain('if [ "$#" -ne 2 ]');
    expect(script).not.toMatch(/\$3\b/);
    expect(script).toContain("read -r -s CLIENT_SECRET");
    expect(script).toContain("--env-file /dev/stdin");
  });

  it("distinguishes OAuth configuration from dated production verification", () => {
    expect(guide).toContain("Configuration is not production verification");
    expect(guide).toMatch(/Authorization and a focused sync are the\s+verification flow/);
    expect(guide).not.toContain("must remain unavailable for authorization and sync");
    expect(guide).not.toContain("hit\n   **Sync focused source**; confirm evidence appears");
  });

  it("awaits generic OAuth persistence so callback failures stay inside its safe redirect", () => {
    expect(app).toContain("return await runTenant(consumed.tenantId");
    expect(app).toContain('`oauth_failed_${oauthPhase}`');
  });

  it("documents Asana as read-only without endorsing legacy full access", () => {
    expect(guide).toContain("`projects:read`, `tasks:read`");
    expect(guide).not.toMatch(/full-access Asana|full-access app/i);
  });
});
