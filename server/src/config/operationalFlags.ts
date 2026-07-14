import { pool } from "../db/pool.js";

export interface McpOperationalFlags {
  mcpDcrEnabled: boolean;
  mcpOAuthApprovalsEnabled: boolean;
}

export async function loadMcpOperationalFlags(): Promise<McpOperationalFlags> {
  try {
    const { rows } = await pool.query<{
      mcp_dcr_enabled: unknown;
      mcp_oauth_approvals_enabled: unknown;
    }>("select * from public.brian_mcp_operational_flags()");
    const row = rows[0];
    if (typeof row?.mcp_dcr_enabled !== "boolean"
      || typeof row.mcp_oauth_approvals_enabled !== "boolean") {
      throw new Error("invalid operational flags");
    }
    return {
      mcpDcrEnabled: row.mcp_dcr_enabled,
      mcpOAuthApprovalsEnabled: row.mcp_oauth_approvals_enabled,
    };
  } catch {
    return { mcpDcrEnabled: false, mcpOAuthApprovalsEnabled: false };
  }
}
