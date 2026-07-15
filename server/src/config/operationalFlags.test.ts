import { beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../db/pool.js";
import { loadMcpOperationalFlags } from "./operationalFlags.js";

vi.mock("../db/pool.js", () => ({
  pool: { query: vi.fn() },
}));

describe("loadMcpOperationalFlags", () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it("resolves the flags function through the connection search path", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        mcp_dcr_enabled: true,
        mcp_oauth_approvals_enabled: true,
      }],
    } as never);

    await expect(loadMcpOperationalFlags()).resolves.toEqual({
      mcpDcrEnabled: true,
      mcpOAuthApprovalsEnabled: true,
    });
    expect(pool.query).toHaveBeenCalledWith(
      "select * from brian_mcp_operational_flags()",
    );
  });
});
