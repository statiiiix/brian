import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL("./migrations/016_mcp_operational_flags.sql", import.meta.url),
  "utf8",
);

describe("migration 016 MCP operational flags", () => {
  it("exposes only fail-closed booleans through a narrow definer", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("where c.key = 'MCP_DCR_ENABLED'");
    expect(sql).toContain("where c.key = 'MCP_OAUTH_APPROVALS_ENABLED'");
    expect(sql).toContain("revoke all on function public.brian_mcp_operational_flags() from public");
    expect(sql).toContain("revoke all on function public.brian_mcp_operational_flags() from anon");
    expect(sql).toContain("revoke all on function public.brian_mcp_operational_flags() from authenticated");
    expect(sql).toContain("grant execute on function public.brian_mcp_operational_flags() to brian_app");
  });
});
