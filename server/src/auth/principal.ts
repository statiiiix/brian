import { createHash } from "node:crypto";
import type pg from "pg";
import { pool } from "../db/pool.js";
import { db, runTenant } from "../db/tenant.js";
import { AGENT_PERMISSIONS, normalizePermissions, type AgentPermission } from "./permissions.js";

export const HUMAN_ROLES = ["owner", "admin", "expert", "viewer"] as const;
export type HumanRole = (typeof HUMAN_ROLES)[number];

export interface MembershipSummary {
  membershipId: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: HumanRole;
  isDefault: boolean;
}

interface PrincipalBase {
  tenantId: string;
  role: HumanRole;
  permissions: AgentPermission[];
}

export interface HumanPrincipal extends PrincipalBase {
  kind: "human";
  userId: string;
  email: string;
  membershipId: string;
  permissions: [];
}

export interface McpPrincipal extends PrincipalBase {
  kind: "mcp";
  userId: string;
  clientId: string;
  connectionId: string;
}

export interface LegacyAgentPrincipal extends PrincipalBase {
  kind: "legacy-agent";
  userId: null;
  clientId: null;
  connectionId: string | null;
}

export interface SystemPrincipal extends PrincipalBase {
  kind: "system";
  userId: null;
  clientId: null;
  connectionId: null;
}

export type AuthPrincipal = HumanPrincipal | McpPrincipal | LegacyAgentPrincipal | SystemPrincipal;

export interface McpPrincipalInput {
  userId: string;
  tenantId: string;
  clientId: string;
}

export interface PrincipalStore {
  resolveDashboard(userId: string, tenantId?: string | null): Promise<Omit<HumanPrincipal, "kind" | "email" | "permissions"> | null>;
  listMemberships(userId: string): Promise<MembershipSummary[]>;
  resolveMcp(input: McpPrincipalInput): Promise<McpPrincipal | null>;
  resolveLegacy(token: string): Promise<LegacyAgentPrincipal | null>;
  touchConnection(connectionId: string, tenantId: string): Promise<void>;
}

// PostgreSQL's uuid type accepts the full 128-bit textual space. The fixed
// founding tenant intentionally is not an RFC versioned UUID.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isHumanRole(value: unknown): value is HumanRole {
  return typeof value === "string" && (HUMAN_ROLES as readonly string[]).includes(value);
}

async function withUserContext<T>(
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try { await client.query("rollback"); } catch { /* connection-level failure */ }
    throw error;
  } finally {
    client.release();
  }
}

function hashLegacyToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const databasePrincipalStore: PrincipalStore = {
  async resolveDashboard(userId, tenantId = null) {
    if (!isUuid(userId) || (tenantId !== null && !isUuid(tenantId))) return null;
    try {
      return await withUserContext(userId, async (client) => {
        const { rows } = await client.query(
          "select * from resolve_dashboard_principal($1::uuid, $2::uuid)",
          [userId, tenantId],
        );
        const row = rows[0];
        if (!row || !isUuid(row.tenant_id) || !isUuid(row.membership_id) || !isHumanRole(row.role)) {
          return null;
        }
        return {
          tenantId: row.tenant_id,
          userId,
          role: row.role,
          membershipId: row.membership_id,
        };
      });
    } catch {
      return null;
    }
  },

  async listMemberships(userId) {
    if (!isUuid(userId)) return [];
    try {
      return await withUserContext(userId, async (client) => {
        const { rows } = await client.query(
          "select * from list_user_memberships($1::uuid)",
          [userId],
        );
        return rows.flatMap((row): MembershipSummary[] => {
          if (!isUuid(row.membership_id) || !isUuid(row.tenant_id) || !isHumanRole(row.role)) return [];
          return [{
            membershipId: row.membership_id,
            tenantId: row.tenant_id,
            tenantName: String(row.tenant_name ?? ""),
            tenantSlug: String(row.tenant_slug ?? ""),
            role: row.role,
            isDefault: Boolean(row.is_default),
          }];
        });
      });
    } catch {
      return [];
    }
  },

  async resolveMcp(input) {
    const { userId, tenantId, clientId } = input;
    if (!isUuid(userId) || !isUuid(tenantId) || !clientId || clientId.length > 512) return null;
    try {
      return await withUserContext(userId, async (client) => {
        const { rows } = await client.query(
          "select * from resolve_mcp_principal($1::uuid, $2::uuid, $3::text)",
          [userId, tenantId, clientId],
        );
        const row = rows[0];
        if (!row || !isUuid(row.connection_id) || !isHumanRole(row.role)) return null;
        return {
          kind: "mcp" as const,
          tenantId: row.tenant_id,
          userId: row.user_id,
          clientId,
          connectionId: row.connection_id,
          role: row.role,
          permissions: normalizePermissions(row.permissions),
        };
      });
    } catch {
      return null;
    }
  },

  async resolveLegacy(token) {
    if (!token || token.length > 4096) return null;
    try {
      const { rows } = await pool.query(
        "select * from resolve_legacy_agent_token($1::text)",
        [hashLegacyToken(token)],
      );
      const row = rows[0];
      if (!row || !isUuid(row.tenant_id)) return null;
      return {
        kind: "legacy-agent",
        tenantId: row.tenant_id,
        userId: null,
        clientId: null,
        connectionId: isUuid(row.connection_id) ? row.connection_id : null,
        role: "admin",
        permissions: [...AGENT_PERMISSIONS],
      };
    } catch {
      return null;
    }
  },

  async touchConnection(connectionId, tenantId) {
    if (!isUuid(connectionId) || !isUuid(tenantId)) return;
    await runTenant(tenantId, () => db().query(
      `update agent_connections
          set last_used_at = now(), updated_at = now()
        where id = $1 and tenant_id = $2 and status = 'active'
          and (last_used_at is null or last_used_at < now() - interval '5 minutes')`,
      [connectionId, tenantId],
    ));
  },
};

export async function consumeInvitationForUser(
  userId: string,
  rawToken: string,
): Promise<{ tenantId: string; role: HumanRole } | null> {
  if (!isUuid(userId) || !/^[A-Za-z0-9_-]{20,512}$/.test(rawToken)) return null;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  try {
    return await withUserContext(userId, async (client) => {
      const { rows } = await client.query(
        "select * from consume_tenant_invitation($1::uuid,$2::text)",
        [userId, tokenHash],
      );
      const row = rows[0];
      return row && isUuid(row.tenant_id) && isHumanRole(row.role)
        ? { tenantId: row.tenant_id, role: row.role }
        : null;
    });
  } catch {
    return null;
  }
}
