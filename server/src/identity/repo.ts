import { createHash, randomBytes } from "node:crypto";
import { db, tenantOrFounding, currentPrincipal, type Queryable } from "../db/tenant.js";
import { isHumanRole, isUuid, type HumanRole } from "../auth/principal.js";
import {
  DEFAULT_AGENT_PERMISSIONS,
  normalizePermissions,
  type AgentPermission,
} from "../auth/permissions.js";
import { sanitizeAuditMetadata } from "./audit.js";

export interface AgentConnection {
  id: string;
  tenantId: string;
  userId: string;
  oauthClientId: string;
  clientName: string;
  displayName: string | null;
  clientUri: string | null;
  redirectOrigins: string[];
  permissions: AgentPermission[];
  status: "pending" | "active" | "denied" | "revoked";
  approvedAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingState {
  currentStep: number;
  completedSteps: string[];
  completed: boolean;
  firstMcpCallAt: string | null;
  updatedAt: string;
}

export class AgentConnectionConflict extends Error {
  constructor() {
    super("this OAuth client is already connected to another company; revoke it before switching companies");
    this.name = "AgentConnectionConflict";
  }
}

const CONNECTION_COLS = `id, tenant_id, user_id, oauth_client_id, client_name, display_name,
  client_uri, redirect_origins, permissions, status, approved_at, last_used_at,
  expires_at, revoked_at, created_at, updated_at`;

function iso(value: unknown): string | null {
  return value ? new Date(value as string | number | Date).toISOString() : null;
}

function connection(row: any): AgentConnection {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    oauthClientId: row.oauth_client_id,
    clientName: row.client_name,
    displayName: row.display_name ?? null,
    clientUri: row.client_uri ?? null,
    redirectOrigins: Array.isArray(row.redirect_origins) ? row.redirect_origins.map(String) : [],
    permissions: normalizePermissions(row.permissions),
    status: row.status,
    approvedAt: iso(row.approved_at),
    lastUsedAt: iso(row.last_used_at),
    expiresAt: iso(row.expires_at),
    revokedAt: iso(row.revoked_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function safeClientText(value: unknown, fallback: string, max = 200): string {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return text ? text.slice(0, max) : fallback;
}

function safeUri(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const uri = new URL(value);
    return uri.protocol === "https:" ? uri.toString() : null;
  } catch {
    return null;
  }
}

function redirectOrigin(value: string): string {
  const uri = new URL(value);
  const loopback = uri.hostname === "127.0.0.1" || uri.hostname === "[::1]" || uri.hostname === "localhost";
  if (uri.protocol !== "https:" && !(uri.protocol === "http:" && loopback)) {
    throw new Error("OAuth redirect must use HTTPS or a loopback HTTP address");
  }
  return uri.origin;
}

export async function writeAuditEvent(
  eventType: string,
  input: {
    targetType?: string;
    targetId?: string;
    connectionId?: string | null;
    metadata?: unknown;
    requestId?: string | null;
  } = {},
  p: Queryable = db(),
): Promise<void> {
  const principal = currentPrincipal();
  const principalConnectionId = principal && "connectionId" in principal
    ? principal.connectionId
    : null;
  await p.query(
    `insert into security_audit_events
      (tenant_id, actor_user_id, connection_id, event_type, target_type, target_id, metadata, request_id)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      tenantOrFounding(),
      principal && "userId" in principal ? principal.userId : null,
      input.connectionId === undefined ? principalConnectionId : input.connectionId,
      eventType,
      input.targetType ?? null,
      input.targetId ?? null,
      JSON.stringify(sanitizeAuditMetadata(input.metadata ?? {})),
      input.requestId ?? null,
    ],
  );
}

export async function prepareAgentConnection(input: {
  userId: string;
  clientId: string;
  clientName: string;
  clientUri?: string | null;
  redirectUri: string;
  permissions?: unknown;
  requestId?: string | null;
}, p: Queryable = db()): Promise<AgentConnection> {
  if (!isUuid(input.userId) || !input.clientId || input.clientId.length > 512) {
    throw new Error("invalid OAuth client details");
  }
  const permissions = normalizePermissions(input.permissions);
  const granted = permissions.length ? permissions : [...DEFAULT_AGENT_PERMISSIONS];
  const origin = redirectOrigin(input.redirectUri);
  const clientName = safeClientText(input.clientName, "Unnamed MCP client");
  const clientUri = safeUri(input.clientUri);
  const tenantId = tenantOrFounding();

  const existing = await p.query(
    `select ${CONNECTION_COLS} from agent_connections
      where tenant_id=$1 and user_id=$2 and oauth_client_id=$3
        and status in ('pending','active')
      order by created_at desc limit 1`,
    [tenantId, input.userId, input.clientId],
  );
  let row = existing.rows[0];
  if (row) {
    // Every verified consent starts a fresh approval window, including
    // permission expansion. Reuse the one open row so the access-token hook
    // has an unambiguous grant, but move it back to pending immediately: old
    // access tokens must stop resolving while reauthorization is incomplete.
    const updated = await p.query(
      `update agent_connections set client_name=$2, client_uri=$3, redirect_origins=$4::jsonb,
          display_name=coalesce(display_name,$2), permissions=$5::text[], status='pending',
          approved_at=null, expires_at=now()+interval '10 minutes', revoked_at=null,
          updated_at=now()
        where id=$1 and tenant_id=$6 returning ${CONNECTION_COLS}`,
      [row.id, clientName, clientUri, JSON.stringify([origin]), granted, tenantId],
    );
    row = updated.rows[0];
  } else {
    try {
      const inserted = await p.query(
        `insert into agent_connections
          (tenant_id,user_id,oauth_client_id,client_name,display_name,client_uri,
           redirect_origins,permissions,status,expires_at)
         values ($1,$2,$3,$4,$4,$5,$6::jsonb,$7::text[],'pending',now()+interval '10 minutes')
         returning ${CONNECTION_COLS}`,
        [tenantId, input.userId, input.clientId, clientName, clientUri, JSON.stringify([origin]), granted],
      );
      row = inserted.rows[0];
    } catch (error: any) {
      if (error?.code === "23505") throw new AgentConnectionConflict();
      throw error;
    }
  }

  const result = connection(row);
  await writeAuditEvent("agent_connection.prepared", {
    targetType: "agent_connection",
    targetId: result.id,
    connectionId: result.id,
    metadata: { clientId: result.oauthClientId, permissions: result.permissions },
    requestId: input.requestId,
  }, p);
  return result;
}

/**
 * Record the user's denial of a server-verified Supabase authorization
 * request. This deliberately does not read or write agent_connections: a
 * denial must never create a pending grant or mutate an existing active one.
 */
export async function recordOAuthAuthorizationDenial(input: {
  userId: string;
  clientId: string;
  clientName: string;
  clientUri?: string | null;
  redirectUri: string;
  permissions?: unknown;
  requestId?: string | null;
}, p: Queryable = db()): Promise<void> {
  const principal = currentPrincipal();
  if (!principal || principal.kind !== "human" || principal.userId !== input.userId) {
    throw new Error("OAuth denial actor does not match the authenticated user");
  }
  if (!input.clientId || input.clientId.length > 512) {
    throw new Error("invalid OAuth client details");
  }
  const clientId = safeClientText(input.clientId, "unknown-oauth-client", 512);
  const clientName = safeClientText(input.clientName, "Unnamed MCP client");
  const clientUri = safeUri(input.clientUri);
  await writeAuditEvent("oauth.authorization.denied", {
    targetType: "oauth_client",
    targetId: clientId,
    metadata: {
      clientName,
      clientOrigin: clientUri ? new URL(clientUri).origin : null,
      redirectOrigin: redirectOrigin(input.redirectUri),
      permissions: normalizePermissions(input.permissions),
    },
    requestId: input.requestId,
  }, p);
}

export async function denyAgentConnection(id: string, actorUserId: string, p: Queryable = db()): Promise<boolean> {
  const { rows } = await p.query(
    `update agent_connections set status='denied', expires_at=null, updated_at=now()
      where id=$1 and tenant_id=$2 and user_id=$3 and status='pending' returning id`,
    [id, tenantOrFounding(), actorUserId],
  );
  if (!rows[0]) return false;
  await writeAuditEvent("agent_connection.denied", {
    targetType: "agent_connection",
    targetId: id,
    connectionId: id,
  }, p);
  return true;
}

export async function listAgentConnections(
  actorUserId: string,
  role: HumanRole,
  p: Queryable = db(),
): Promise<AgentConnection[]> {
  if (role === "viewer") return [];
  const tenantId = tenantOrFounding();
  const { rows } = role === "expert"
    ? await p.query(
        `select ${CONNECTION_COLS} from agent_connections
          where tenant_id=$1 and user_id=$2 order by created_at desc`,
        [tenantId, actorUserId],
      )
    : await p.query(
        `select ${CONNECTION_COLS} from agent_connections where tenant_id=$1 order by created_at desc`,
        [tenantId],
      );
  return rows.map(connection);
}

export async function updateAgentConnection(
  id: string,
  actorUserId: string,
  role: HumanRole,
  patch: { name?: unknown; permissions?: unknown },
  p: Queryable = db(),
): Promise<AgentConnection | null> {
  if (role === "viewer") return null;
  const tenantId = tenantOrFounding();
  const existing = await p.query(
    `select ${CONNECTION_COLS} from agent_connections
      where id=$1 and tenant_id=$2 and ($3::boolean or user_id=$4)`,
    [id, tenantId, role === "owner" || role === "admin", actorUserId],
  );
  if (!existing.rows[0]) return null;
  const row = connection(existing.rows[0]);
  const nextPermissions = patch.permissions === undefined ? row.permissions : normalizePermissions(patch.permissions);
  if (!nextPermissions.length || nextPermissions.some((permission) => !row.permissions.includes(permission))) {
    throw new Error("permissions may only be reduced; expansion requires new consent");
  }
  const displayName = patch.name === undefined
    ? row.displayName
    : safeClientText(patch.name, row.clientName, 120);
  const { rows } = await p.query(
    `update agent_connections set display_name=$2, permissions=$3::text[], updated_at=now()
      where id=$1 and tenant_id=$4 returning ${CONNECTION_COLS}`,
    [id, displayName, nextPermissions, tenantId],
  );
  await writeAuditEvent("agent_connection.updated", {
    targetType: "agent_connection",
    targetId: id,
    connectionId: id,
    metadata: { permissions: nextPermissions },
  }, p);
  return connection(rows[0]);
}

export async function revokeAgentConnection(
  id: string,
  actorUserId: string,
  role: HumanRole,
  p: Queryable = db(),
): Promise<AgentConnection | null> {
  if (role === "viewer") return null;
  const { rows } = await p.query(
    `update agent_connections set status='revoked', revoked_at=now(), expires_at=null, updated_at=now()
      where id=$1 and tenant_id=$2 and status in ('pending','active')
        and ($3::boolean or user_id=$4)
      returning ${CONNECTION_COLS}`,
    [id, tenantOrFounding(), role === "owner" || role === "admin", actorUserId],
  );
  if (!rows[0]) return null;
  await writeAuditEvent("agent_connection.revoked", {
    targetType: "agent_connection",
    targetId: id,
    connectionId: id,
    metadata: { oauthClientId: rows[0].oauth_client_id },
  }, p);
  return connection(rows[0]);
}

export async function currentTenant(p: Queryable = db()) {
  const { rows } = await p.query(
    "select id, name, slug, status, created_at, updated_at from tenants where id=$1",
    [tenantOrFounding()],
  );
  return rows[0] ?? null;
}

export async function updateCurrentTenant(name: string, p: Queryable = db()) {
  const clean = safeClientText(name, "", 120);
  if (clean.length < 2) throw new Error("company name must be at least 2 characters");
  const { rows } = await p.query(
    "update tenants set name=$2, updated_at=now() where id=$1 returning id,name,slug,status,created_at,updated_at",
    [tenantOrFounding(), clean],
  );
  await writeAuditEvent("tenant.updated", { targetType: "tenant", targetId: tenantOrFounding() }, p);
  return rows[0];
}

export async function listMembers(p: Queryable = db()) {
  const { rows } = await p.query(
    `select id, user_id, role, status, is_default, created_at, updated_at
       from tenant_memberships where tenant_id=$1 order by created_at`,
    [tenantOrFounding()],
  );
  return rows;
}

export async function setMembershipStatus(
  membershipId: string,
  status: "suspended" | "removed",
  actorRole: HumanRole,
  p: Queryable = db(),
) {
  const tenantId = tenantOrFounding();
  const { rows } = await p.query(
    "select id,user_id,role,status from tenant_memberships where id=$1 and tenant_id=$2",
    [membershipId, tenantId],
  );
  const member = rows[0];
  if (!member) return null;
  if (member.role === "owner") {
    if (actorRole !== "owner") throw new Error("only an owner can change another owner's membership");
    const count = await p.query(
      "select count(*)::int as count from tenant_memberships where tenant_id=$1 and role='owner' and status='active'",
      [tenantId],
    );
    if (Number(count.rows[0]?.count) <= 1) throw new Error("transfer ownership before removing the last owner");
  }
  const updated = await p.query(
    `update tenant_memberships set status=$3,is_default=false,updated_at=now()
      where id=$1 and tenant_id=$2 returning id,user_id,role,status,is_default,created_at,updated_at`,
    [membershipId, tenantId, status],
  );
  await writeAuditEvent(`tenant_membership.${status}`, {
    targetType: "tenant_membership",
    targetId: membershipId,
    metadata: { role: member.role },
  }, p);
  return updated.rows[0];
}

export async function createInvitation(
  email: string,
  role: HumanRole,
  invitedBy: string,
  p: Queryable = db(),
): Promise<{ id: string; token: string; expiresAt: string }> {
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320) throw new Error("valid email required");
  if (!isHumanRole(role) || role === "owner") throw new Error("invalid invitation role");
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const { rows } = await p.query(
    `insert into tenant_invitations (tenant_id,email,role,token_hash,invited_by,expires_at)
      values ($1,$2,$3,$4,$5,now()+interval '7 days') returning id,expires_at`,
    [tenantOrFounding(), email.trim().toLowerCase(), role, hash, invitedBy],
  );
  await writeAuditEvent("tenant_invitation.created", {
    targetType: "tenant_invitation",
    targetId: rows[0].id,
    metadata: { role },
  }, p);
  return { id: rows[0].id, token, expiresAt: iso(rows[0].expires_at)! };
}

/** Boolean-only, email-bound invitation preflight for the public signup page. */
export async function validateInvitationForSignup(
  email: string,
  rawToken: string,
  p: Queryable = db(),
): Promise<boolean> {
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail) || normalizedEmail.length > 320) return false;
  if (typeof rawToken !== "string" || !/^[A-Za-z0-9_-]{20,512}$/.test(rawToken)) return false;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const { rows } = await p.query(
    "select is_valid_tenant_invitation($1::text,$2::text) as valid",
    [normalizedEmail, tokenHash],
  );
  return rows[0]?.valid === true;
}

export async function getOnboardingState(p: Queryable = db()): Promise<OnboardingState> {
  const { rows } = await p.query(
    "select current_step,completed_steps,completed,first_mcp_call_at,updated_at from onboarding_state where tenant_id=$1",
    [tenantOrFounding()],
  );
  const row = rows[0];
  return row ? {
    currentStep: Number(row.current_step),
    completedSteps: Array.isArray(row.completed_steps) ? row.completed_steps.map(String) : [],
    completed: Boolean(row.completed),
    firstMcpCallAt: iso(row.first_mcp_call_at),
    updatedAt: iso(row.updated_at)!,
  } : {
    currentStep: 1,
    completedSteps: [],
    completed: false,
    firstMcpCallAt: null,
    updatedAt: new Date(0).toISOString(),
  };
}

export async function updateOnboardingState(
  input: { currentStep?: unknown; completedSteps?: unknown; completed?: unknown },
  p: Queryable = db(),
): Promise<OnboardingState> {
  const currentStep = Math.max(1, Math.min(5, Number(input.currentStep) || 1));
  const completedSteps = Array.isArray(input.completedSteps)
    ? [...new Set(input.completedSteps.filter((value): value is string => typeof value === "string"))].slice(0, 10)
    : [];
  const completed = input.completed === true;
  const { rows } = await p.query(
    `insert into onboarding_state (tenant_id,current_step,completed_steps,completed)
      values ($1,$2,$3::text[],$4)
      on conflict (tenant_id) do update set current_step=$2,completed_steps=$3::text[],completed=$4,updated_at=now()
      returning current_step,completed_steps,completed,first_mcp_call_at,updated_at`,
    [tenantOrFounding(), currentStep, completedSteps, completed],
  );
  const row = rows[0];
  return {
    currentStep: Number(row.current_step),
    completedSteps: row.completed_steps,
    completed: Boolean(row.completed),
    firstMcpCallAt: iso(row.first_mcp_call_at),
    updatedAt: iso(row.updated_at)!,
  };
}

export async function markFirstMcpCall(p: Queryable = db()): Promise<void> {
  await p.query(
    `insert into onboarding_state (tenant_id,current_step,completed_steps,completed,first_mcp_call_at)
      values ($1,5,array['agent_connected'],false,now())
      on conflict (tenant_id) do update
        set first_mcp_call_at=coalesce(onboarding_state.first_mcp_call_at,now()),updated_at=now()`,
    [tenantOrFounding()],
  );
}
