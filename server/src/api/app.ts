import { Hono } from "hono";
import type { Context } from "hono";
import { randomUUID } from "node:crypto";
import {
  createSkill, getSkill, listSkills, updateSkill, setStatus, listVersions, NotFoundError,
  findSkillsWithDistance,
} from "../skills/repo.js";
import { parseNewSkill, parseUpdateSkill, ValidationError } from "../skills/validation.js";
import { listExecutions } from "../feedback/executions.js";
import { draftFromText } from "../ingestion/draftFromText.js";
import type { SkillStatus } from "../skills/types.js";
import { createContext, getContext, listContext, updateContext, retireContext, listContextVersions, findContextWithDistance } from "../context/repo.js";
import { parseNewContext, parseUpdateContext } from "../context/validation.js";
import { capture } from "../ingestion/capture.js";
import { ingestBulk } from "../ingestion/bulk.js";
import type { ContextStatus } from "../context/types.js";
import { registerMcpHttp } from "../mcp/http.js";
import { findUserByEmail, verifyPassword } from "../auth/users.js";
import { signUserToken, verifyUserToken, type TokenUser } from "../auth/jwt.js";
import {
  getOAuthAuthorizationDetails, supabaseAuthFromEnv, type SupabaseAuthConfig,
} from "../auth/supabase.js";
import { runPrincipal, runTenant } from "../db/tenant.js";
import { secret } from "../config/secrets.js";
import {
  loadMcpOperationalFlags,
  type McpOperationalFlags,
} from "../config/operationalFlags.js";
import {
  createInterview, getInterview, listInterviews, appendMessage as appendInterviewMessage,
  completeInterview, abandonInterview, resumeInterview,
} from "../interviews/repo.js";
import { runTurn } from "../interviews/engine.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import { listConnectors, upsertConnector, evidenceForDraft, unpromotedEvidence } from "../connectors/repo.js";
import { syncConnector, type SyncSummary } from "../connectors/sync.js";
import { CONNECTOR_TYPES } from "../connectors/adapters/index.js";
import { AUTHORIZED_SOURCE_TYPES, type ConnectorType, type ConnectorRow, type SourceType } from "../connectors/types.js";
import {
  consumeOAuthState, createOAuthState, exchangeGoogleCode,
  googleAuthorizationUrl, googleOAuthConfig,
} from "../connectors/googleOAuth.js";
import { exchangeSlackCode, slackAuthorizationUrl, slackOAuthConfig } from "../connectors/slackOAuth.js";
import {
  buildOAuthAuthorizationUrl, callbackMatchesProvider, exchangeOAuthCode,
  getOAuthProviderSpec, isGenericOAuthProvider, oauthProviderAvailability as genericOAuthProviderAvailability,
  oauthProviderConfig,
} from "../connectors/oauthProviders.js";
import { createRouteAuth, type AuthEnv } from "../auth/middleware.js";
import { MCP_OAUTH_SCOPES, MCP_RESOURCE, oauthChallenge } from "../auth/constants.js";
import { mcpOAuthJwtFromEnv, type McpOAuthJwtConfig } from "../auth/oauthJwt.js";
import {
  databasePrincipalStore,
  consumeInvitationForUser,
  isUuid,
  type HumanPrincipal,
  type HumanRole,
  type PrincipalStore,
} from "../auth/principal.js";
import {
  DEFAULT_AGENT_PERMISSIONS,
  hasPermission,
  permissionsForOAuthScope,
  validateSelectedAgentPermissions,
} from "../auth/permissions.js";
import {
  AgentConnectionConflict,
  createInvitation,
  currentTenant,
  denyAgentConnection,
  getOnboardingState,
  listAgentConnections,
  listMembers,
  prepareAgentConnection,
  recordOAuthAuthorizationDenial,
  revokeAgentConnection,
  setMembershipStatus,
  updateAgentConnection,
  updateCurrentTenant,
  updateOnboardingState,
  validateInvitationForSignup,
} from "../identity/repo.js";
import {
  FixedWindowRateLimiter,
  consoleJsonLogSink,
  mcpAuthenticatedRateLimitKey,
  mcpPreAuthRateLimitKey,
  rateLimitMiddleware,
  requestLogMiddleware,
  type HttpLogSink,
} from "../operations/http.js";
import {
  emitDomainMetric,
  type DomainMetricInput,
} from "../operations/domainMetrics.js";
import {
  cancelDataDeletionForVerifiedUser,
  listDataDeletionRequestsForVerifiedUser,
  scheduleDataDeletion,
} from "../privacy/repo.js";
import type { DataDeletionScope } from "../privacy/types.js";

export interface McpRateLimitOptions {
  preAuthRequests?: number;
  authenticatedRequests?: number;
  windowMs?: number;
  maxKeys?: number;
}

export interface AppOptions {
  authToken?: string | null;
  jwtSecret?: string | null;
  supabaseAuth?: SupabaseAuthConfig | null;
  mcpOAuth?: McpOAuthJwtConfig | null;
  principalStore?: PrincipalStore;
  authRequired?: boolean;
  legacyAgentTokensEnabled?: boolean;
  mcpOAuthEnabled?: boolean;
  mcpOAuthApprovalsEnabled?: boolean;
  mcpDcrEnabled?: boolean;
  operationalFlags?: () => Promise<McpOperationalFlags>;
  cliOauthBridgeEnabled?: boolean;
  publicSignupEnabled?: boolean;
  legacyPasswordLoginEnabled?: boolean;
  mcpRateLimits?: McpRateLimitOptions | false;
  signupPreflightRateLimits?: McpRateLimitOptions | false;
  httpLogSink?: HttpLogSink | false;
  llm?: LlmClient;
  sync?: (type: ConnectorType, focus?: string) => Promise<SyncSummary>;
}

// Never expose stored connector credentials over the API.
function publicConnector(c: ConnectorRow): Omit<ConnectorRow, "credentials"> & { configured: boolean } {
  const { credentials, ...rest } = c;
  return { ...rest, configured: Object.keys(credentials ?? {}).length > 0 };
}

async function oauthProviderAvailability() {
  return {
    google: {
      label: "Google Workspace",
      supported: true,
      configured: Boolean(await googleOAuthConfig()),
      requires_workspace: false,
    },
    slack: {
      label: "Slack",
      supported: true,
      configured: Boolean(await slackOAuthConfig()),
      requires_workspace: false,
    },
    ...(await genericOAuthProviderAvailability()),
  };
}

function requestReturnOrigin(c: Context): string | undefined {
  const candidate = c.req.header("origin");
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    const configured = [
      process.env.BRIAN_APP_URL,
      ...(process.env.BRIAN_ALLOWED_RETURN_ORIGINS ?? "").split(","),
      "https://brianthebrain.app",
    ].filter(Boolean).map((value) => {
      try { return new URL(value!).origin; } catch { return null; }
    });
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return undefined;
    return configured.includes(url.origin) || loopback ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function safeOAuthRedirectUri(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return !url.username
      && !url.password
      && !url.hash
      && (url.protocol === "https:" || (url.protocol === "http:" && loopback));
  } catch {
    return false;
  }
}

async function connectorRedirect(
  c: Context,
  key: "connected" | "error",
  value: string,
  returnOrigin?: string,
) {
  const path = `/app/connectors?${new URLSearchParams({ [key]: value }).toString()}`;
  const appUrl = await secret("BRIAN_APP_URL");
  const baseUrl = appUrl ?? returnOrigin;
  return c.redirect(baseUrl ? new URL(path, `${baseUrl.replace(/\/$/, "")}/`).toString() : path);
}

async function rejectedOAuthRedirect(c: Context, state: string | undefined, error: string) {
  const consumed = state ? await consumeOAuthState(state).catch(() => null) : null;
  return connectorRedirect(c, "error", error, consumed?.metadata.return_origin);
}

export type AppEnv = AuthEnv;
export type App = Hono<AppEnv>;

// Vector-search hits farther than this cosine distance are treated as
// no-match so hooks don't inject unrelated skills into every prompt.
const BRIEFING_MAX_DISTANCE = 0.6;

// Fastify parsed missing/empty JSON bodies to undefined; keep that tolerance.
async function jsonBody(c: Context): Promise<any> {
  return c.req.json().catch(() => undefined);
}

function humanPrincipal(c: Context<AppEnv>): HumanPrincipal | null {
  const principal = c.get("principal");
  return principal?.kind === "human" ? principal : null;
}

function roleAllowed(role: HumanRole, allowed: readonly HumanRole[]): boolean {
  return allowed.includes(role);
}

function featureFlag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function positiveIntegerEnv(name: string, fallback: number, maximum: number): number {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

async function supabasePasswordLogin(
  cfg: SupabaseAuthConfig,
  email: string,
  password: string,
): Promise<{ token: string; user: { id: string; email: string; role: string } } | { error: string; status: number }> {
  const f = cfg.fetchFn ?? fetch;
  const res = await f(`${cfg.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: cfg.anonKey },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({})) as {
    access_token?: string;
    user?: { id?: string; email?: string; app_metadata?: { role?: string } };
    error?: string;
    error_description?: string;
    msg?: string;
  };
  if (!res.ok) {
    const message = data.error_description || data.msg || data.error || "login failed";
    if (/confirm|verified/i.test(message)) {
      return { error: "Please confirm your email before logging in.", status: 403 };
    }
    return { error: "invalid credentials", status: 401 };
  }
  if (!data.access_token || !data.user?.id || !data.user.email) {
    return { error: "login failed", status: 502 };
  }
  return {
    token: data.access_token,
    user: {
      id: data.user.id,
      email: data.user.email,
      role: data.user.app_metadata?.role ?? "viewer",
    },
  };
}

export function buildApp(opts: AppOptions = {}): App {
  const app = new Hono<AppEnv>();
  const authToken = opts.authToken ?? null;
  const jwtSecret = opts.jwtSecret ?? null;
  const supabaseAuth = opts.supabaseAuth === undefined ? supabaseAuthFromEnv() : opts.supabaseAuth;
  const mcpOAuth = opts.mcpOAuth === undefined ? mcpOAuthJwtFromEnv() : opts.mcpOAuth;
  const principalStore = opts.principalStore ?? databasePrincipalStore;
  const legacyPasswordLoginEnabled = opts.legacyPasswordLoginEnabled
    ?? featureFlag("LEGACY_PASSWORD_LOGIN_ENABLED", false);
  const mcpOAuthEnabled = opts.mcpOAuthEnabled
    ?? featureFlag("MCP_OAUTH_ENABLED", true);
  // New grants are release-gated independently from validation of existing
  // short-lived MCP credentials. Missing configuration fails closed.
  const mcpOAuthApprovalsEnabled = opts.mcpOAuthApprovalsEnabled
    ?? false;
  // Supabase owns DCR and the public CLI intentionally ships no credential
  // bridge in v1. Keep both controls visible and fail closed until their
  // respective compatibility/release gates have passed.
  const mcpDcrEnabled = opts.mcpDcrEnabled
    ?? false;
  const staticOperationalFlags: McpOperationalFlags = {
    mcpDcrEnabled,
    mcpOAuthApprovalsEnabled,
  };
  const operationalFlags = opts.operationalFlags
    ?? (opts.mcpDcrEnabled !== undefined || opts.mcpOAuthApprovalsEnabled !== undefined
      ? async () => staticOperationalFlags
      : loadMcpOperationalFlags);
  const cliOauthBridgeEnabled = opts.cliOauthBridgeEnabled
    ?? featureFlag("CLI_OAUTH_BRIDGE_ENABLED", false);
  const publicSignupEnabled = opts.publicSignupEnabled
    ?? featureFlag("PUBLIC_SIGNUP_ENABLED", false);
  const rateLimitOptions = opts.mcpRateLimits === false
    || !featureFlag("MCP_RATE_LIMIT_ENABLED", true)
    ? null
    : opts.mcpRateLimits ?? {};
  const rateLimitWindowMs = rateLimitOptions?.windowMs
    ?? positiveIntegerEnv("MCP_RATE_LIMIT_WINDOW_MS", 60_000, 86_400_000);
  const rateLimitMaxKeys = rateLimitOptions?.maxKeys
    ?? positiveIntegerEnv("MCP_RATE_LIMIT_MAX_KEYS", 10_000, 1_000_000);
  const preAuthLimiter = rateLimitOptions ? new FixedWindowRateLimiter({
    requests: rateLimitOptions.preAuthRequests
      ?? positiveIntegerEnv("MCP_PREAUTH_RATE_LIMIT_REQUESTS", 120, 1_000_000),
    windowMs: rateLimitWindowMs,
    maxKeys: rateLimitMaxKeys,
  }) : null;
  const authenticatedLimiter = rateLimitOptions ? new FixedWindowRateLimiter({
    requests: rateLimitOptions.authenticatedRequests
      ?? positiveIntegerEnv("MCP_AUTH_RATE_LIMIT_REQUESTS", 600, 1_000_000),
    windowMs: rateLimitWindowMs,
    maxKeys: rateLimitMaxKeys,
  }) : null;
  const signupRateLimitOptions = opts.signupPreflightRateLimits === false
    || !featureFlag("SIGNUP_PREFLIGHT_RATE_LIMIT_ENABLED", true)
    ? null
    : opts.signupPreflightRateLimits ?? {};
  const signupPreflightLimiter = signupRateLimitOptions ? new FixedWindowRateLimiter({
    requests: signupRateLimitOptions.preAuthRequests
      ?? positiveIntegerEnv("SIGNUP_PREFLIGHT_RATE_LIMIT_REQUESTS", 20, 100_000),
    windowMs: signupRateLimitOptions.windowMs
      ?? positiveIntegerEnv("SIGNUP_PREFLIGHT_RATE_LIMIT_WINDOW_MS", 60_000, 86_400_000),
    maxKeys: signupRateLimitOptions.maxKeys
      ?? positiveIntegerEnv("SIGNUP_PREFLIGHT_RATE_LIMIT_MAX_KEYS", 10_000, 1_000_000),
  }) : null;

  app.use("*", async (c, next) => {
    // Never copy a caller-controlled correlation header into operational or
    // audit logs: a client could put a bearer, OAuth code, or other secret in
    // it. Brian's generated ID is echoed to the caller for safe correlation.
    const requestId = randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-ID", requestId);
    await next();
  });

  const httpLogSink = opts.httpLogSink === undefined
    ? (process.env.VITEST ? null : consoleJsonLogSink)
    : opts.httpLogSink || null;
  if (httpLogSink) app.use("*", requestLogMiddleware(httpLogSink));
  const domainMetric = (
    c: Context<AppEnv>,
    input: Omit<DomainMetricInput, "requestId">,
  ) => emitDomainMetric(httpLogSink, { ...input, requestId: c.get("requestId") });

  const authorizationServer = mcpOAuth?.issuer
    ?? (supabaseAuth ? `${supabaseAuth.url.replace(/\/$/, "")}/auth/v1` : null)
    ?? process.env.SUPABASE_OAUTH_ISSUER
    ?? "https://foydcrwyakpkisxtvzgr.supabase.co/auth/v1";
  const protectedResourceMetadata = {
    resource: MCP_RESOURCE,
    authorization_servers: [authorizationServer],
    scopes_supported: [...MCP_OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://github.com/statiiiix/brian/blob/main/docs/mcp-oauth.md",
  };
  const serveProtectedResourceMetadata = (c: Context<AppEnv>) => {
    try {
      c.header("Cache-Control", "public, max-age=3600");
      const response = c.json(protectedResourceMetadata);
      domainMetric(c, {
        metric: "oauth_discovery",
        outcome: "success",
        category: "protected_resource_metadata",
        routeClass: "public",
      });
      return response;
    } catch (error) {
      domainMetric(c, {
        level: "warn",
        metric: "oauth_discovery",
        outcome: "failure",
        category: "protected_resource_metadata",
        routeClass: "public",
      });
      throw error;
    }
  };
  app.get("/.well-known/oauth-protected-resource", serveProtectedResourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", serveProtectedResourceMetadata);

  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use("/mcp", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  if (preAuthLimiter) {
    const middleware = rateLimitMiddleware(preAuthLimiter, mcpPreAuthRateLimitKey);
    app.use("/mcp", middleware);
    app.use("/api/agent/*", middleware);
  }
  if (signupPreflightLimiter) {
    app.use(
      "/api/public/invitations/*",
      rateLimitMiddleware(signupPreflightLimiter, mcpPreAuthRateLimitKey),
    );
  }

  app.use("*", createRouteAuth({
    authToken,
    jwtSecret,
    supabaseAuth,
    mcpOAuth,
    principalStore,
    authRequired: opts.authRequired,
    legacyAgentTokensEnabled: opts.legacyAgentTokensEnabled,
    mcpOAuthEnabled,
    domainMetricSink: httpLogSink || undefined,
    authFailureSink: httpLogSink || undefined,
  }));
  if (authenticatedLimiter) {
    const middleware = rateLimitMiddleware(authenticatedLimiter, mcpAuthenticatedRateLimitKey);
    app.use("/mcp", middleware);
    app.use("/api/agent/*", middleware);
  }

  // Viewers are read-only across the dashboard API. More sensitive endpoints
  // add narrower owner/admin checks in their handlers.
  app.use("/api/*", async (c, next) => {
    const principal = c.get("principal");
    const isConsentDenial = c.req.method === "POST"
      && c.req.path.endsWith("/api/oauth/authorizations/deny");
    const isPrivacySchedule = c.req.method === "POST"
      && c.req.path.endsWith("/api/privacy/deletion-requests");
    if (principal?.kind === "human" && principal.role === "viewer"
      && !["GET", "HEAD", "OPTIONS"].includes(c.req.method)
      && !isConsentDenial
      && !isPrivacySchedule) {
      return c.json({ error: "forbidden" }, 403);
    }
    return next();
  });

  app.onError((err, c) => {
    if (err instanceof ValidationError) return c.json({ error: err.issues.join("; ") }, 400);
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof AgentConnectionConflict) return c.json({ error: err.message }, 409);
    if (typeof err === "object" && err && "constraint" in err
      && err.constraint === "account_deletion_pending") {
      return c.json({
        error: "Cancel the pending account-deletion request before connecting another agent.",
        code: "account_deletion_pending",
      }, 409);
    }
    return c.json({ error: "internal error" }, 500);
  });

  app.post("/api/auth/login", async (c) => {
    if (!legacyPasswordLoginEnabled) {
      return c.json({
        error: "password login moved to the Supabase browser client",
        code: "legacy_password_login_disabled",
      }, 410);
    }
    const { email, password } = (await jsonBody(c)) ?? {};
    if (!email || !password) return c.json({ error: "email and password required" }, 400);
    if (supabaseAuth) {
      const result = await supabasePasswordLogin(supabaseAuth, email, password);
      if ("error" in result) return c.json({ error: result.error }, result.status as 400 | 401 | 403 | 502);
      return c.json(result);
    }
    if (!jwtSecret) {
      return c.json({
        error: "legacy password login is not configured; use Supabase Auth",
      }, 503);
    }
    const u = await findUserByEmail(email);
    if (!u || !(await verifyPassword(u.password_hash, password))) {
      return c.json({ error: "invalid credentials" }, 401);
    }
    const token = signUserToken({ id: u.id, email: u.email, role: u.role }, jwtSecret);
    return c.json({ token, user: { id: u.id, email: u.email, name: u.name, role: u.role } });
  });

  // Deliberately tiny unauthenticated configuration surface. Self-service
  // signup must fail closed in the browser as well as in the provisioning
  // trigger; invitation signup remains a separate, token-bound path.
  app.get("/api/public/config", async (c) => {
    const flags = await operationalFlags();
    return c.json({
      publicSignup: publicSignupEnabled,
      mcpOAuth: mcpOAuthEnabled,
      mcpOAuthApprovals: flags.mcpOAuthApprovalsEnabled,
      mcpDcr: flags.mcpDcrEnabled,
    });
  });

  app.post("/api/public/invitations/validate", async (c) => {
    const { email, token } = (await jsonBody(c)) ?? {};
    if (typeof email !== "string" || typeof token !== "string") {
      domainMetric(c, {
        metric: "invitation",
        outcome: "invalid",
        category: "invitation_preflight",
        routeClass: "public",
      });
      return c.json({ valid: false });
    }
    try {
      const valid = await validateInvitationForSignup(email, token);
      domainMetric(c, {
        metric: "invitation",
        outcome: valid ? "valid" : "invalid",
        category: "invitation_preflight",
        routeClass: "public",
      });
      return c.json({ valid });
    } catch (error) {
      domainMetric(c, {
        level: "warn",
        metric: "invitation",
        outcome: "failure",
        category: "invitation_preflight",
        routeClass: "public",
      });
      throw error;
    }
  });

  app.get("/api/auth/me", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);
    return c.json(user);
  });

  app.get("/api/me", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal) return c.json({ error: "unauthorized" }, 401);
    const [memberships, tenant, flags] = await Promise.all([
      principalStore.listMemberships(principal.userId),
      currentTenant(),
      operationalFlags(),
    ]);
    return c.json({
      user: { id: principal.userId, email: principal.email, role: principal.role },
      memberships,
      currentTenant: tenant,
      featureFlags: {
        publicSignup: publicSignupEnabled,
        mcpOAuth: mcpOAuthEnabled,
        mcpOAuthApprovals: flags.mcpOAuthApprovalsEnabled,
        mcpDcr: flags.mcpDcrEnabled,
        cliOauthBridge: cliOauthBridgeEnabled,
        agentConnectionsUi: featureFlag("AGENT_CONNECTIONS_UI_ENABLED", true),
        legacyAgentTokens: featureFlag("LEGACY_AGENT_TOKENS_ENABLED", true),
      },
    });
  });

  app.get("/api/tenants/current", async (c) => c.json(await currentTenant()));

  app.post("/api/tenants/switch", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal) return c.json({ error: "unauthorized" }, 401);
    const tenantId = (await jsonBody(c))?.tenantId;
    const selected = await principalStore.resolveDashboard(principal.userId, tenantId);
    if (!selected) {
      domainMetric(c, {
        level: "warn",
        metric: "tenant_authorization",
        outcome: "denied",
        category: "requested_tenant_not_accessible",
        routeClass: "human",
        tenantId: principal.tenantId,
      });
      return c.json({ error: "active membership required" }, 403);
    }
    // Browser tenant selection is intentionally not accepted through a header
    // or mutable user metadata. This validates the choice for callers that
    // need a one-request operation such as OAuth consent.
    return c.json({ tenantId: selected.tenantId, role: selected.role });
  });

  app.patch("/api/tenants/current", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal || !roleAllowed(principal.role, ["owner", "admin"])) {
      return c.json({ error: "forbidden" }, 403);
    }
    const name = (await jsonBody(c))?.name;
    if (typeof name !== "string") return c.json({ error: "company name required" }, 400);
    return c.json(await updateCurrentTenant(name));
  });

  app.get("/api/members", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal) return c.json({ error: "unauthorized" }, 401);
    return c.json(await listMembers());
  });

  app.post("/api/invitations", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal || !roleAllowed(principal.role, ["owner", "admin"])) {
      return c.json({ error: "forbidden" }, 403);
    }
    const { email, role } = (await jsonBody(c)) ?? {};
    if (typeof email !== "string" || typeof role !== "string") {
      return c.json({ error: "email and role required" }, 400);
    }
    try {
      const invite = await createInvitation(email, role as HumanRole, principal.userId);
      domainMetric(c, {
        metric: "invitation",
        outcome: "created",
        category: "invitation_creation",
        routeClass: "human",
        tenantId: principal.tenantId,
      });
      const appUrl = (await secret("BRIAN_APP_URL")) ?? "https://brianthebrain.app";
      return c.json({
        id: invite.id,
        expiresAt: invite.expiresAt,
        inviteUrl: `${appUrl.replace(/\/$/, "")}/invite/${encodeURIComponent(invite.token)}`,
      }, 201);
    } catch (error) {
      domainMetric(c, {
        level: "warn",
        metric: "invitation",
        outcome: "failure",
        category: "invitation_creation",
        routeClass: "human",
        tenantId: principal.tenantId,
      });
      return c.json({ error: error instanceof Error ? error.message : "invalid invitation" }, 400);
    }
  });

  app.post("/api/invitations/accept", async (c) => {
    const user = c.get("user");
    const token = (await jsonBody(c))?.token;
    if (!user) return c.json({ error: "unauthorized" }, 401);
    if (typeof token !== "string") return c.json({ error: "invitation token required" }, 400);
    const membership = await consumeInvitationForUser(user.id, token);
    if (membership) {
      domainMetric(c, {
        metric: "invitation",
        outcome: "accepted",
        category: "invitation_consumption",
        routeClass: "bootstrap",
        tenantId: membership.tenantId,
      });
      return c.json({ membership });
    }
    domainMetric(c, {
      level: "warn",
      metric: "invitation",
      outcome: "rejected",
      category: "invitation_consumption",
      routeClass: "bootstrap",
    });
    return c.json({ error: "invalid, expired, or already-used invitation" }, 400);
  });

  // Listing and cancellation use the verified Supabase identity directly so
  // they remain available after a company-deletion request has intentionally
  // suspended the tenant. The repository exposes only the caller's requests.
  app.get("/api/privacy/deletion-requests", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);
    return c.json({
      requests: await listDataDeletionRequestsForVerifiedUser(user.id),
    });
  });

  app.post("/api/privacy/deletion-requests", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal) return c.json({ error: "unauthorized" }, 401);
    const scope = (await jsonBody(c))?.scope;
    if (scope !== "account" && scope !== "company") {
      return c.json({ error: "scope must be account or company" }, 400);
    }
    try {
      const request = await scheduleDataDeletion(scope as DataDeletionScope);
      return c.json({ request }, 201);
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error
        ? String(error.code)
        : "";
      if (code === "42501") return c.json({ error: "forbidden" }, 403);
      if (code === "23514") {
        return c.json({
          error: "Transfer ownership of every company you solely own before deleting your account.",
          code: "ownership_transfer_required",
        }, 409);
      }
      if (code === "22023") return c.json({ error: "invalid deletion request" }, 400);
      throw error;
    }
  });

  app.delete("/api/privacy/deletion-requests/:id", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const requestId = c.req.param("id");
    if (!isUuid(requestId)) return c.json({ error: "deletion request not found" }, 404);
    const request = await cancelDataDeletionForVerifiedUser(user.id, requestId);
    return request
      ? c.json({ request })
      : c.json({ error: "deletion request not found" }, 404);
  });

  app.post("/api/members/:id/suspend", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal || !roleAllowed(principal.role, ["owner", "admin"])) {
      return c.json({ error: "forbidden" }, 403);
    }
    try {
      const member = await setMembershipStatus(c.req.param("id"), "suspended", principal.role);
      return member ? c.json(member) : c.json({ error: "member not found" }, 404);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid member update" }, 409);
    }
  });

  app.delete("/api/members/:id", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal || !roleAllowed(principal.role, ["owner", "admin"])) {
      return c.json({ error: "forbidden" }, 403);
    }
    try {
      const member = await setMembershipStatus(c.req.param("id"), "removed", principal.role);
      return member ? c.json(member) : c.json({ error: "member not found" }, 404);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid member update" }, 409);
    }
  });

  app.post("/api/oauth/grants/prepare", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal) return c.json({ error: "unauthorized" }, 401);
    if (principal.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const flags = await operationalFlags();
    if (!mcpOAuthEnabled || !flags.mcpOAuthApprovalsEnabled) {
      return c.json({ error: "new agent connections are temporarily paused" }, 503);
    }
    if (!supabaseAuth || !c.get("accessToken")) {
      return c.json({ error: "Supabase OAuth consent is not configured" }, 503);
    }
    const body = (await jsonBody(c)) ?? {};
    if (typeof body.authorizationId !== "string" || typeof body.tenantId !== "string") {
      return c.json({ error: "authorizationId and tenantId required" }, 400);
    }
    const selected = await principalStore.resolveDashboard(principal.userId, body.tenantId);
    if (!selected || selected.role === "viewer") {
      domainMetric(c, {
        level: "warn",
        metric: "tenant_authorization",
        outcome: "denied",
        category: "requested_tenant_not_accessible",
        routeClass: "human",
        tenantId: principal.tenantId,
      });
      return c.json({ error: "forbidden" }, 403);
    }
    const details = await getOAuthAuthorizationDetails(
      body.authorizationId,
      c.get("accessToken")!,
      principal.userId,
      supabaseAuth,
    );
    if (!details) {
      domainMetric(c, {
        level: "warn",
        metric: "oauth_consent",
        outcome: "invalid_or_expired",
        category: "authorization_request",
        routeClass: "human",
        tenantId: selected.tenantId,
      });
      return c.json({ error: "invalid or expired authorization request" }, 400);
    }
    if (!safeOAuthRedirectUri(details.redirect_uri)) {
      return c.json({ error: "unsafe OAuth redirect" }, 400);
    }
    // Supabase remains authoritative for the client and authorization request.
    // Brian's closed permission policy is authoritative for the explicit
    // tenant grant selected on the consent page.
    // Consent pages deployed before optional permissions were introduced did
    // not send this field. Keep those pages compatible, but grant only the
    // closed required defaults; null, malformed, unknown, and duplicate
    // values still fail closed.
    const requestedPermissions = body.permissions === undefined
      ? DEFAULT_AGENT_PERMISSIONS
      : body.permissions;
    const validatedPermissions = validateSelectedAgentPermissions(requestedPermissions, selected.role);
    if (!validatedPermissions.ok) {
      const status = validatedPermissions.reason === "actions:execute requires an owner or admin"
        ? 403
        : 400;
      return c.json({ error: validatedPermissions.reason }, status);
    }
    const selectedPrincipal: HumanPrincipal = {
      kind: "human",
      ...selected,
      email: principal.email,
      permissions: [],
    };
    let grant;
    try {
      grant = await runPrincipal(selectedPrincipal, () => prepareAgentConnection({
        userId: principal.userId,
        clientId: details.client.id,
        clientName: details.client.name,
        clientUri: details.client.uri,
        redirectUri: details.redirect_uri,
        permissions: validatedPermissions.permissions,
        requestId: c.get("requestId"),
      }));
    } catch (error) {
      domainMetric(c, {
        level: "warn",
        metric: "agent_connection",
        outcome: "failure",
        category: "agent_grant",
        routeClass: "human",
        tenantId: selected.tenantId,
      });
      domainMetric(c, {
        level: "warn",
        metric: "oauth_consent",
        outcome: "failure",
        category: "authorization_request",
        routeClass: "human",
        tenantId: selected.tenantId,
      });
      throw error;
    }
    domainMetric(c, {
      metric: "oauth_consent",
      outcome: "prepared",
      category: "authorization_request",
      routeClass: "human",
      tenantId: selected.tenantId,
      connectionId: grant.id,
    });
    domainMetric(c, {
      metric: "agent_connection",
      outcome: "prepared",
      category: "agent_grant",
      routeClass: "human",
      tenantId: selected.tenantId,
      connectionId: grant.id,
    });
    return c.json({ grant }, 201);
  });

  app.post("/api/oauth/authorizations/deny", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal) return c.json({ error: "unauthorized" }, 401);
    if (!supabaseAuth || !c.get("accessToken")) {
      return c.json({ error: "Supabase OAuth consent is not configured" }, 503);
    }
    const body = (await jsonBody(c)) ?? {};
    if (typeof body.authorizationId !== "string"
      || (body.tenantId !== undefined && typeof body.tenantId !== "string")) {
      return c.json({ error: "authorizationId required" }, 400);
    }
    const selected = typeof body.tenantId === "string"
      ? await principalStore.resolveDashboard(principal.userId, body.tenantId)
      : principal;
    if (!selected) {
      domainMetric(c, {
        level: "warn",
        metric: "tenant_authorization",
        outcome: "denied",
        category: "requested_tenant_not_accessible",
        routeClass: "human",
        tenantId: principal.tenantId,
      });
      return c.json({ error: "forbidden" }, 403);
    }
    const details = await getOAuthAuthorizationDetails(
      body.authorizationId,
      c.get("accessToken")!,
      principal.userId,
      supabaseAuth,
    );
    if (!details) {
      domainMetric(c, {
        level: "warn",
        metric: "oauth_consent",
        outcome: "invalid_or_expired",
        category: "authorization_request",
        routeClass: "human",
        tenantId: selected.tenantId,
      });
      return c.json({ error: "invalid or expired authorization request" }, 400);
    }
    const selectedPrincipal: HumanPrincipal = selected === principal ? principal : {
      kind: "human",
      ...selected,
      email: principal.email,
      permissions: [],
    };
    try {
      await runPrincipal(selectedPrincipal, () => recordOAuthAuthorizationDenial({
        userId: principal.userId,
        clientId: details.client.id,
        clientName: details.client.name,
        clientUri: details.client.uri,
        redirectUri: details.redirect_uri,
        permissions: permissionsForOAuthScope(details.scope),
        requestId: c.get("requestId"),
      }));
    } catch (error) {
      domainMetric(c, {
        level: "warn",
        metric: "oauth_consent",
        outcome: "failure",
        category: "authorization_request",
        routeClass: "human",
        tenantId: selected.tenantId,
      });
      throw error;
    }
    domainMetric(c, {
      metric: "oauth_consent",
      outcome: "denied",
      category: "authorization_request",
      routeClass: "human",
      tenantId: selected.tenantId,
    });
    return c.json({ recorded: true });
  });

  app.post("/api/oauth/grants/:id/deny", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal) return c.json({ error: "unauthorized" }, 401);
    const body = (await jsonBody(c)) ?? {};
    const selected = typeof body.tenantId === "string"
      ? await principalStore.resolveDashboard(principal.userId, body.tenantId)
      : principal;
    if (!selected) {
      domainMetric(c, {
        level: "warn",
        metric: "tenant_authorization",
        outcome: "denied",
        category: "requested_tenant_not_accessible",
        routeClass: "human",
        tenantId: principal.tenantId,
      });
      return c.json({ error: "forbidden" }, 403);
    }
    const selectedPrincipal: HumanPrincipal = selected === principal ? principal : {
      kind: "human",
      ...selected,
      email: principal.email,
      permissions: [],
    };
    const denied = await runPrincipal(selectedPrincipal, () =>
      denyAgentConnection(c.req.param("id"), principal.userId));
    if (denied) {
      domainMetric(c, {
        metric: "agent_connection",
        outcome: "denied",
        category: "agent_grant",
        routeClass: "human",
        tenantId: selected.tenantId,
        connectionId: c.req.param("id"),
      });
    }
    return denied ? c.json({ denied: true }) : c.json({ error: "connection not found" }, 404);
  });

  app.get("/api/agent-connections", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal) return c.json({ error: "unauthorized" }, 401);
    if (principal.role === "viewer") return c.json({ error: "forbidden" }, 403);
    return c.json({ connections: await listAgentConnections(principal.userId, principal.role) });
  });

  app.get("/api/agent-connections/:id", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal || principal.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const rows = await listAgentConnections(principal.userId, principal.role);
    const item = rows.find((row) => row.id === c.req.param("id"));
    if (!item) {
      domainMetric(c, {
        level: "warn",
        metric: "tenant_authorization",
        outcome: "denied",
        category: "requested_resource_not_accessible",
        routeClass: "human",
        tenantId: principal.tenantId,
      });
    }
    return item ? c.json(item) : c.json({ error: "connection not found" }, 404);
  });

  app.patch("/api/agent-connections/:id", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal) return c.json({ error: "unauthorized" }, 401);
    if (principal.role === "viewer") return c.json({ error: "forbidden" }, 403);
    try {
      const item = await updateAgentConnection(
        c.req.param("id"), principal.userId, principal.role, (await jsonBody(c)) ?? {},
      );
      if (!item) {
        domainMetric(c, {
          level: "warn",
          metric: "tenant_authorization",
          outcome: "denied",
          category: "requested_resource_not_accessible",
          routeClass: "human",
          tenantId: principal.tenantId,
        });
      }
      return item ? c.json(item) : c.json({ error: "connection not found" }, 404);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid update" }, 400);
    }
  });

  app.post("/api/agent-connections/:id/revoke", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal) return c.json({ error: "unauthorized" }, 401);
    if (principal.role === "viewer") return c.json({ error: "forbidden" }, 403);
    let item;
    try {
      item = await revokeAgentConnection(c.req.param("id"), principal.userId, principal.role);
    } catch (error) {
      domainMetric(c, {
        level: "warn",
        metric: "agent_connection",
        outcome: "failure",
        category: "agent_grant",
        routeClass: "human",
        tenantId: principal.tenantId,
      });
      throw error;
    }
    if (item) {
      domainMetric(c, {
        metric: "agent_connection",
        outcome: "revoked",
        category: "agent_grant",
        routeClass: "human",
        tenantId: principal.tenantId,
        connectionId: item.id,
      });
    } else {
      domainMetric(c, {
        level: "warn",
        metric: "tenant_authorization",
        outcome: "denied",
        category: "requested_resource_not_accessible",
        routeClass: "human",
        tenantId: principal.tenantId,
      });
    }
    return item ? c.json(item) : c.json({ error: "connection not found" }, 404);
  });

  app.get("/api/onboarding", async (c) => c.json({ onboarding: await getOnboardingState() }));
  app.patch("/api/onboarding", async (c) =>
    c.json({ onboarding: await updateOnboardingState((await jsonBody(c)) ?? {}) }));

  app.get("/api/skills", async (c) => {
    const status = c.req.query("status") as SkillStatus | undefined;
    return c.json(await listSkills(status));
  });

  app.get("/api/skills/:id", async (c) => {
    const s = await getSkill(c.req.param("id"));
    if (!s) return c.json({ error: "skill not found" }, 404);
    return c.json(s);
  });

  app.post("/api/skills", async (c) => {
    const input = parseNewSkill(await jsonBody(c));
    return c.json(await createSkill(input), 201);
  });

  app.put("/api/skills/:id", async (c) => {
    const patch = parseUpdateSkill(await jsonBody(c));
    return c.json(await updateSkill(c.req.param("id"), patch, "api", undefined));
  });

  app.post("/api/skills/:id/activate", async (c) =>
    c.json(await setStatus(c.req.param("id"), "active")));

  app.post("/api/skills/:id/retire", async (c) =>
    c.json(await setStatus(c.req.param("id"), "retired")));

  app.get("/api/skills/:id/versions", async (c) =>
    c.json(await listVersions(c.req.param("id"))));

  app.get("/api/skills/:id/executions", async (c) =>
    c.json(await listExecutions(c.req.param("id"))));

  // Provenance: connector evidence that produced this skill draft.
  app.get("/api/skills/:id/evidence", async (c) =>
    c.json(await evidenceForDraft("skill", c.req.param("id"))));

  app.get("/api/executions", async (c) => c.json(await listExecutions()));

  app.get("/api/evidence", async (c) => {
    if (c.req.query("status") !== "unpromoted") return c.json([]);
    return c.json(await unpromotedEvidence("skill_evidence"));
  });

  // One-shot skill+context lookup for agent harness hooks (see
  // docs/agent-contract.md "Guaranteed invocation").
  app.post("/api/agent/briefing", async (c) => {
    const principal = c.get("principal");
    if (principal && (!hasPermission(principal.permissions, "skills:read")
      || !hasPermission(principal.permissions, "context:read"))) {
      c.header("WWW-Authenticate", oauthChallenge("insufficient_scope"));
      return c.json({ error: "insufficient_scope" }, 403);
    }
    const query = (await jsonBody(c))?.query;
    if (typeof query !== "string" || query.trim().length === 0) {
      return c.json({ error: "query is required" }, 400);
    }
    const [skills, ctx] = await Promise.all([
      findSkillsWithDistance(query, 1),
      findContextWithDistance(query),
    ]);
    const skillHit = skills[0];
    return c.json({
      skill: skillHit && skillHit.distance <= BRIEFING_MAX_DISTANCE ? skillHit.skill : null,
      context: ctx && ctx.distance <= BRIEFING_MAX_DISTANCE ? ctx.entry : null,
    });
  });

  app.post("/api/skills/:id/draft-from-text", async (c) => {
    const text = (await jsonBody(c))?.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return c.json({ error: "text is required" }, 400);
    }
    return c.json(await draftFromText(text), 201);
  });

  app.post("/api/capture", async (c) => {
    const text = (await jsonBody(c))?.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return c.json({ error: "text is required" }, 400);
    }
    return c.json(await capture(text));
  });

  app.post("/api/ingest/bulk", async (c) => {
    const docs = (await jsonBody(c))?.docs;
    if (!Array.isArray(docs)) return c.json({ error: "docs array is required" }, 400);
    return c.json({ results: await ingestBulk(docs) });
  });

  app.get("/api/context", async (c) => {
    const status = c.req.query("status") as ContextStatus | undefined;
    return c.json(await listContext(status));
  });

  app.get("/api/context/:id", async (c) => {
    const entry = await getContext(c.req.param("id"));
    if (!entry) return c.json({ error: "context not found" }, 404);
    return c.json(entry);
  });

  app.post("/api/context", async (c) => {
    const input = parseNewContext(await jsonBody(c));
    return c.json(await createContext(input), 201);
  });

  app.put("/api/context/:id", async (c) =>
    c.json(await updateContext(c.req.param("id"), parseUpdateContext(await jsonBody(c)), "api")));

  app.post("/api/context/:id/retire", async (c) =>
    c.json(await retireContext(c.req.param("id"))));

  app.get("/api/context/:id/versions", async (c) =>
    c.json(await listContextVersions(c.req.param("id"))));

  const llm = () => opts.llm ?? defaultLlm();
  const sync = opts.sync ?? ((type: ConnectorType, focus?: string) => syncConnector(type, { focus }));

  app.post("/api/interviews", async (c) => {
    const { topic, owner } = ((await jsonBody(c)) ?? {}) as { topic?: string; owner?: string };
    if (!topic?.trim()) return c.json({ error: "topic is required" }, 400);
    const iv = await createInterview({
      topic: topic.trim(), owner: owner ?? null, created_by: c.get("user")?.id ?? null,
    });
    return c.json(await runTurn(iv, llm()), 201);
  });

  app.get("/api/interviews", async (c) => c.json(await listInterviews()));

  app.get("/api/interviews/:id", async (c) => {
    const iv = await getInterview(c.req.param("id"));
    if (!iv) return c.json({ error: "interview not found" }, 404);
    return c.json(iv);
  });

  app.post("/api/interviews/:id/messages", async (c) => {
    const content = (await jsonBody(c))?.content;
    if (typeof content !== "string" || !content.trim()) {
      return c.json({ error: "content is required" }, 400);
    }
    const iv = await getInterview(c.req.param("id"));
    if (!iv) return c.json({ error: "interview not found" }, 404);
    if (iv.status !== "active") return c.json({ error: `interview is ${iv.status}` }, 400);
    const withMsg = await appendInterviewMessage(iv.id, { role: "expert", content: content.trim() });
    return c.json(await runTurn(withMsg, llm()));
  });

  app.post("/api/interviews/:id/approve", async (c) => {
    const iv = await getInterview(c.req.param("id"));
    if (!iv) return c.json({ error: "interview not found" }, 404);
    if (iv.status !== "ready" || !iv.draft) {
      return c.json({ error: "interview has no draft to approve" }, 400);
    }
    const activate = (await jsonBody(c))?.activate !== false;
    let skill = await createSkill(parseNewSkill(iv.draft));
    if (activate) skill = await setStatus(skill.id, "active");
    const interview = await completeInterview(iv.id, skill.id);
    return c.json({ interview, skill });
  });

  app.post("/api/interviews/:id/abandon", async (c) => {
    const iv = await getInterview(c.req.param("id"));
    if (!iv) return c.json({ error: "interview not found" }, 404);
    return c.json(await abandonInterview(iv.id));
  });

  app.post("/api/interviews/:id/resume", async (c) => {
    const iv = await getInterview(c.req.param("id"));
    if (!iv) return c.json({ error: "interview not found" }, 404);
    if (iv.status !== "abandoned") return c.json({ error: `interview is ${iv.status}` }, 400);
    return c.json(await resumeInterview(iv.id));
  });

  app.get("/api/connectors", async (c) =>
    c.json((await listConnectors()).map(publicConnector)));

  // The dashboard needs to distinguish an implementation that is ready for a
  // customer to authorize from one that still needs its deployment secrets.
  // This exposes no credential material.
  app.get("/api/connectors/providers", async (c) => c.json(await oauthProviderAvailability()));

  // One Google consent grants the narrow read-only Gmail + Drive scopes used
  // by Brian. The callback stores the same refresh token in two connector
  // rows so each source can be synced independently later.
  app.get("/api/connectors/google/start", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal || principal.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const config = await googleOAuthConfig();
    if (!config) {
      return c.json({ error: "Google OAuth is not configured on this Brian deployment" }, 503);
    }
    const returnOrigin = requestReturnOrigin(c);
    const state = await createOAuthState("google", ["gmail", "google_drive"],
      returnOrigin ? { return_origin: returnOrigin } : {});
    return c.json({ url: googleAuthorizationUrl(config, state) });
  });

  app.get("/api/connectors/google/callback", async (c) => {
    const error = c.req.query("error");
    const state = c.req.query("state");
    const code = c.req.query("code");
    if (error) return rejectedOAuthRedirect(c, state, error);
    if (!state || !code) return rejectedOAuthRedirect(c, state, "missing_google_oauth_response");

    let returnOrigin: string | undefined;
    try {
      const consumed = await consumeOAuthState(state);
      if (!consumed || consumed.provider !== "google") {
        return connectorRedirect(c, "error", "invalid_or_expired_google_oauth_state");
      }
      returnOrigin = consumed.metadata.return_origin;
      const config = await googleOAuthConfig();
      if (!config) return connectorRedirect(c, "error", "google_oauth_not_configured", returnOrigin);
      const tokens = await exchangeGoogleCode(code, config);
      if (!tokens.refresh_token) {
        return connectorRedirect(c, "error", "google_refresh_token_missing_reconnect", returnOrigin);
      }
      const credentials = {
        provider: "google",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: tokens.refresh_token,
      };
      return runTenant(consumed.tenantId, async () => {
        for (const type of consumed.connectorTypes as ConnectorType[]) {
          await upsertConnector(type, { status: "connected", credentials });
        }
        return connectorRedirect(c, "connected", "google", returnOrigin);
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "google_oauth_failed";
      return connectorRedirect(c, "error", message, returnOrigin);
    }
  });

  app.get("/api/connectors/slack/start", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal || principal.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const config = await slackOAuthConfig();
    if (!config) return c.json({ error: "Slack OAuth is not configured on this Brian deployment" }, 503);
    const returnOrigin = requestReturnOrigin(c);
    const state = await createOAuthState("slack", ["slack"],
      returnOrigin ? { return_origin: returnOrigin } : {});
    return c.json({ url: slackAuthorizationUrl(config, state) });
  });

  app.get("/api/connectors/slack/callback", async (c) => {
    const error = c.req.query("error");
    const state = c.req.query("state");
    const code = c.req.query("code");
    if (error) return rejectedOAuthRedirect(c, state, error);
    if (!state || !code) return rejectedOAuthRedirect(c, state, "missing_slack_oauth_response");
    let returnOrigin: string | undefined;
    try {
      const consumed = await consumeOAuthState(state);
      if (!consumed || consumed.provider !== "slack") {
        return connectorRedirect(c, "error", "invalid_or_expired_slack_oauth_state");
      }
      returnOrigin = consumed.metadata.return_origin;
      const config = await slackOAuthConfig();
      if (!config) return connectorRedirect(c, "error", "slack_oauth_not_configured", returnOrigin);
      const token = await exchangeSlackCode(code, config);
      return runTenant(consumed.tenantId, async () => {
        await upsertConnector("slack", {
          status: "connected",
          credentials: { provider: "slack", bot_token: token.access_token, team_id: token.team?.id, team_name: token.team?.name },
        });
        return connectorRedirect(c, "connected", "slack", returnOrigin);
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "slack_oauth_failed";
      return connectorRedirect(c, "error", message, returnOrigin);
    }
  });

  // Every catalog source has an authorization flow even before Brian has an
  // ingestion adapter for it. OAuth establishes the tenant-owned connection;
  // ingestion is a separate capability added later.
  app.get("/api/connectors/:provider/start", async (c) => {
    const principal = humanPrincipal(c);
    if (!principal || principal.role === "viewer") return c.json({ error: "forbidden" }, 403);
    const provider = c.req.param("provider");
    if (!isGenericOAuthProvider(provider)) return c.json({ error: "unknown connector" }, 404);
    const config = await oauthProviderConfig(provider);
    if (!config) {
      return c.json({
        error: `${getOAuthProviderSpec(provider).label} OAuth is not configured on this Brian deployment`,
        code: "connector_oauth_not_configured",
        provider,
      }, 503);
    }
    const workspace = c.req.query("workspace")?.trim();
    const returnOrigin = requestReturnOrigin(c);
    const metadata: Record<string, string> = {
      ...(workspace ? { workspace } : {}),
      ...(returnOrigin ? { return_origin: returnOrigin } : {}),
    };
    try {
      const state = await createOAuthState(provider, [provider], metadata);
      return c.json({ url: buildOAuthAuthorizationUrl(config, state, metadata) });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "invalid authorization request" }, 400);
    }
  });

  app.get("/api/connectors/:callback/callback", async (c) => {
    const callback = c.req.param("callback");
    const error = c.req.query("error") ?? c.req.query("error_description");
    const state = c.req.query("state");
    const code = c.req.query("code");
    if (error) return rejectedOAuthRedirect(c, state, error);
    if (!state || !code) return rejectedOAuthRedirect(c, state, "missing_oauth_response");

    let returnOrigin: string | undefined;
    try {
      const consumed = await consumeOAuthState(state);
      if (!consumed || !isGenericOAuthProvider(consumed.provider)
        || !callbackMatchesProvider(callback, consumed.provider)) {
        return connectorRedirect(c, "error", "invalid_or_expired_oauth_state");
      }
      const provider = consumed.provider;
      returnOrigin = consumed.metadata.return_origin;
      const config = await oauthProviderConfig(provider);
      if (!config) return connectorRedirect(c, "error", `${provider}_oauth_not_configured`, returnOrigin);
      const credentials = await exchangeOAuthCode(config, code, state, consumed.metadata);
      return runTenant(consumed.tenantId, async () => {
        await upsertConnector(provider, { status: "connected", credentials });
        return connectorRedirect(c, "connected", provider, returnOrigin);
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "oauth_failed";
      return connectorRedirect(c, "error", message, returnOrigin);
    }
  });

  app.post("/api/connectors/:type/connect", async (c) => {
    const type = c.req.param("type") as ConnectorType;
    if (!CONNECTOR_TYPES.includes(type)) return c.json({ error: "unknown connector" }, 400);
    const credentials = (await jsonBody(c))?.credentials;
    if (!credentials || typeof credentials !== "object") {
      return c.json({ error: "credentials object is required" }, 400);
    }
    return c.json(publicConnector(await upsertConnector(type, { status: "connected", credentials })));
  });

  app.post("/api/connectors/:type/disable", async (c) => {
    const type = c.req.param("type") as SourceType;
    const supported = CONNECTOR_TYPES.includes(type as ConnectorType)
      || (AUTHORIZED_SOURCE_TYPES as readonly string[]).includes(type);
    if (!supported) return c.json({ error: "unknown connector" }, 400);
    return c.json(publicConnector(await upsertConnector(type, { status: "disabled" })));
  });

  app.post("/api/connectors/:type/sync", async (c) => {
    const type = c.req.param("type") as ConnectorType;
    if (!CONNECTOR_TYPES.includes(type)) return c.json({ error: "unknown connector" }, 400);
    const body = await jsonBody(c);
    try {
      return c.json(await sync(type, typeof body?.focus === "string" ? body.focus.trim() : undefined));
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "sync failed" }, 400);
    }
  });

  registerMcpHttp(app, httpLogSink || undefined);

  return app;
}
