import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler, Next } from "hono";
import { FOUNDING_TENANT_ID, runPrincipal } from "../db/tenant.js";
import { verifyUserToken, type TokenUser } from "./jwt.js";
import { oauthChallenge } from "./constants.js";
import {
  mcpOAuthJwtFromEnv,
  verifyMcpOAuthTokenDetailed,
  type McpOAuthJwtConfig,
  type McpTokenFailureCategory,
} from "./oauthJwt.js";
import {
  databasePrincipalStore,
  type AuthPrincipal,
  type PrincipalStore,
} from "./principal.js";
import { AGENT_PERMISSIONS, samePermissions } from "./permissions.js";
import {
  looksLikeSupabaseToken,
  supabaseAuthFromEnv,
  verifyDashboardToken,
  type SupabaseAuthConfig,
} from "./supabase.js";
import { emitDomainMetric, type DomainMetricSink } from "../operations/domainMetrics.js";

export type AuthVariables = {
  user?: TokenUser;
  principal?: AuthPrincipal;
  accessToken?: string;
  requestId?: string;
};

export type AuthEnv = { Variables: AuthVariables };

export interface RouteAuthOptions {
  authToken?: string | null;
  jwtSecret?: string | null;
  supabaseAuth?: SupabaseAuthConfig | null;
  mcpOAuth?: McpOAuthJwtConfig | null;
  principalStore?: PrincipalStore;
  legacyAgentTokensEnabled?: boolean;
  mcpOAuthEnabled?: boolean;
  authRequired?: boolean;
  domainMetricSink?: DomainMetricSink;
  authFailureSink?: (event: {
    timestamp: string;
    level: "warn";
    event: "auth_failure";
    request_id: string | null;
    route_class: "mcp";
    path: string;
    error_category: McpTokenFailureCategory | "principal_resolution";
  }) => void;
}

function exactBearer(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice("Bearer ".length));
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function tokenFromHeader(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length);
  return token && token.length <= 16_384 ? token : null;
}

function routeKind(path: string, method: string): "public" | "bootstrap" | "human" | "mcp" {
  if (
    path.endsWith("/.well-known/oauth-protected-resource")
    || path.endsWith("/.well-known/oauth-protected-resource/mcp")
    || path.endsWith("/api/auth/login")
    || path.endsWith("/api/public/config")
    || path.endsWith("/api/public/invitations/validate")
    || path.endsWith("/api/connectors/google/callback")
    || path.endsWith("/api/connectors/slack/callback")
    || /\/api\/connectors\/[a-z_]+\/callback$/.test(path)
  ) return "public";
  if (path.endsWith("/api/invitations/accept")) return "bootstrap";
  if (method === "GET" && path.endsWith("/api/privacy/deletion-requests")) return "bootstrap";
  if (method === "DELETE" && /\/api\/privacy\/deletion-requests\/[0-9a-f-]{36}$/.test(path)) {
    return "bootstrap";
  }
  if (path.endsWith("/mcp") || path.includes("/api/agent/")) return "mcp";
  return "human";
}

function unauthorized(c: Context<AuthEnv>, kind: "human" | "mcp", invalid = false) {
  if (kind === "mcp") {
    c.header("WWW-Authenticate", oauthChallenge(invalid ? "invalid_token" : undefined));
  }
  c.header("Cache-Control", "no-store");
  return c.json({ error: "unauthorized" }, 401);
}

function bindPrincipal(c: Context<AuthEnv>, principal: AuthPrincipal, next: Next) {
  c.set("principal", principal);
  if (principal.kind === "human") {
    c.set("user", { id: principal.userId, email: principal.email, role: principal.role });
  }
  return runPrincipal(principal, () => next());
}

export function createRouteAuth(options: RouteAuthOptions = {}): MiddlewareHandler<AuthEnv> {
  const authToken = options.authToken ?? null;
  const jwtSecret = options.jwtSecret ?? null;
  const supabaseAuth = options.supabaseAuth === undefined ? supabaseAuthFromEnv() : options.supabaseAuth;
  const mcpOAuth = options.mcpOAuth === undefined ? mcpOAuthJwtFromEnv() : options.mcpOAuth;
  const store = options.principalStore ?? databasePrincipalStore;
  const authRequired = options.authRequired ?? !process.env.VITEST;
  const legacyEnabled = options.legacyAgentTokensEnabled
    ?? process.env.LEGACY_AGENT_TOKENS_ENABLED !== "false";
  const oauthEnabled = options.mcpOAuthEnabled
    ?? process.env.MCP_OAUTH_ENABLED !== "false";

  return async (c, next) => {
    const kind = routeKind(c.req.path, c.req.method);
    if (kind === "public") return next();

    const header = c.req.header("authorization");
    const token = tokenFromHeader(header);
    if (!authRequired && !authToken && !jwtSecret && !supabaseAuth && !mcpOAuth) return next();
    if (!token) return unauthorized(c, kind === "mcp" ? "mcp" : "human");

    if (kind === "bootstrap") {
      if (supabaseAuth && looksLikeSupabaseToken(token)) {
        const identity = await verifyDashboardToken(token, supabaseAuth);
        if (identity) {
          c.set("accessToken", token);
          c.set("user", { id: identity.id, email: identity.email, role: "viewer" });
          return next();
        }
      }
      return unauthorized(c, "human", true);
    }

    if (kind === "human") {
      // Legacy locally-issued JWTs remain dashboard-only during migration,
      // but their signed role and the historical founding tenant are never
      // authorization inputs. Resolve the current membership exactly as for a
      // Supabase identity so removed/suspended users fail closed immediately.
      if (jwtSecret) {
        const legacyUser = verifyUserToken(token, jwtSecret);
        if (legacyUser) {
          const resolved = await store.resolveDashboard(legacyUser.id);
          if (!resolved) {
            emitDomainMetric(options.domainMetricSink, {
              level: "warn",
              metric: "principal_resolution",
              outcome: "denied",
              category: "dashboard_membership",
              requestId: c.get("requestId"),
              routeClass: "human",
            });
            c.header("Cache-Control", "no-store");
            return c.json({ error: "active membership required", code: "membership_required" }, 403);
          }
          return bindPrincipal(c, {
            kind: "human",
            ...resolved,
            email: legacyUser.email,
            permissions: [],
          }, next);
        }
      }

      if (supabaseAuth && looksLikeSupabaseToken(token)) {
        const identity = await verifyDashboardToken(token, supabaseAuth);
        if (identity) {
          const resolved = await store.resolveDashboard(identity.id);
          if (!resolved) {
            emitDomainMetric(options.domainMetricSink, {
              level: "warn",
              metric: "principal_resolution",
              outcome: "denied",
              category: "dashboard_membership",
              requestId: c.get("requestId"),
              routeClass: "human",
            });
            c.header("Cache-Control", "no-store");
            return c.json({ error: "active membership required", code: "membership_required" }, 403);
          }
          c.set("accessToken", token);
          return bindPrincipal(c, {
            kind: "human",
            ...resolved,
            email: identity.email,
            permissions: [],
          }, next);
        }
      }
      return unauthorized(c, kind, true);
    }

    // Static and hashed Brian tokens are accepted only on the MCP/agent route
    // class, and only while the explicit migration flag remains enabled.
    if (legacyEnabled) {
      if (authToken && exactBearer(header, authToken)) {
        return bindPrincipal(c, {
          kind: "legacy-agent",
          tenantId: FOUNDING_TENANT_ID,
          userId: null,
          clientId: null,
          connectionId: null,
          role: "admin",
          permissions: [...AGENT_PERMISSIONS],
        }, next);
      }
      const legacy = await store.resolveLegacy(token);
      if (legacy) return bindPrincipal(c, legacy, next);
    }

    if (oauthEnabled && mcpOAuth) {
      const verification = await verifyMcpOAuthTokenDetailed(token, mcpOAuth);
      if (verification.claims) {
        const principal = await store.resolveMcp(verification.claims);
        if (
          principal
          && principal.userId === verification.claims.userId
          && principal.tenantId === verification.claims.tenantId
          && principal.clientId === verification.claims.clientId
          && principal.connectionId === verification.claims.connectionId
          && principal.role === verification.claims.role
          && samePermissions(principal.permissions, verification.claims.permissions)
        ) {
          void store.touchConnection(principal.connectionId, principal.tenantId).catch(() => undefined);
          return bindPrincipal(c, principal, next);
        }
        options.authFailureSink?.({
          timestamp: new Date().toISOString(),
          level: "warn",
          event: "auth_failure",
          request_id: c.get("requestId") ?? null,
          route_class: "mcp",
          path: c.req.path,
          error_category: "principal_resolution",
        });
        emitDomainMetric(options.domainMetricSink, {
          level: "warn",
          metric: "principal_resolution",
          outcome: "denied",
          category: "mcp_grant_or_membership",
          requestId: c.get("requestId"),
          routeClass: "mcp",
        });
      } else {
        options.authFailureSink?.({
          timestamp: new Date().toISOString(),
          level: "warn",
          event: "auth_failure",
          request_id: c.get("requestId") ?? null,
          route_class: "mcp",
          path: c.req.path,
          error_category: verification.failure,
        });
      }
    }

    return unauthorized(c, kind, true);
  };
}
