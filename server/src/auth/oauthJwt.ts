import {
  createLocalJWKSet,
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose";
import { MCP_RESOURCE } from "./constants.js";
import { isHumanRole, isUuid } from "./principal.js";
import { isAgentPermission, normalizePermissions, type AgentPermission } from "./permissions.js";

export interface McpOAuthJwtConfig {
  issuer: string;
  audience?: string;
  jwksUrl?: string;
  jwks?: JSONWebKeySet;
  fetchFn?: typeof fetch;
  clockToleranceSeconds?: number;
  maxTokenLifetimeSeconds?: number;
  algorithms?: string[];
}

export interface VerifiedMcpClaims {
  userId: string;
  tenantId: string;
  clientId: string;
  connectionId: string;
  role: string;
  permissions: AgentPermission[];
}

export type McpTokenFailureCategory =
  | "wrong_issuer"
  | "wrong_audience"
  | "expired"
  | "not_yet_valid"
  | "signature_or_key"
  | "invalid_resource_or_type"
  | "invalid_lifetime"
  | "malformed_claims";

export type McpTokenVerification =
  | { claims: VerifiedMcpClaims; failure: null }
  | { claims: null; failure: McpTokenFailureCategory };

const remoteSets = new Map<string, JWTVerifyGetKey>();

function keySet(cfg: McpOAuthJwtConfig): JWTVerifyGetKey {
  if (cfg.jwks) return createLocalJWKSet(cfg.jwks);
  const url = cfg.jwksUrl ?? `${cfg.issuer.replace(/\/$/, "")}/.well-known/jwks.json`;
  const cacheKey = `${url}:${cfg.fetchFn ? "custom" : "global"}`;
  let set = remoteSets.get(cacheKey);
  if (!set) {
    set = createRemoteJWKSet(new URL(url), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
      ...(cfg.fetchFn ? { [customFetch]: cfg.fetchFn as never } : {}),
    });
    remoteSets.set(cacheKey, set);
  }
  return set;
}

export function mcpOAuthJwtFromEnv(): McpOAuthJwtConfig | null {
  if (process.env.VITEST) return null;
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  // Metadata and the database hook are deliberately compiled against one
  // stable resource. A mismatched deployment value disables OAuth validation
  // instead of creating split-audience behavior.
  if (!base || (process.env.MCP_RESOURCE && process.env.MCP_RESOURCE !== MCP_RESOURCE)) return null;
  return {
    issuer: `${base}/auth/v1`,
    audience: MCP_RESOURCE,
  };
}

export async function verifyMcpOAuthToken(
  token: string,
  cfg: McpOAuthJwtConfig,
): Promise<VerifiedMcpClaims | null> {
  return (await verifyMcpOAuthTokenDetailed(token, cfg)).claims;
}

function joseFailure(error: unknown): McpTokenFailureCategory {
  const candidate = error as { code?: unknown; claim?: unknown };
  if (candidate.code === "ERR_JWT_EXPIRED") return "expired";
  if (candidate.code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
    if (candidate.claim === "iss") return "wrong_issuer";
    if (candidate.claim === "aud") return "wrong_audience";
    if (candidate.claim === "nbf") return "not_yet_valid";
    return "malformed_claims";
  }
  return "signature_or_key";
}

export async function verifyMcpOAuthTokenDetailed(
  token: string,
  cfg: McpOAuthJwtConfig,
): Promise<McpTokenVerification> {
  const audience = cfg.audience ?? MCP_RESOURCE;
  try {
    const { payload } = await jwtVerify(token, keySet(cfg), {
      issuer: cfg.issuer.replace(/\/$/, ""),
      audience,
      clockTolerance: cfg.clockToleranceSeconds ?? 5,
      algorithms: cfg.algorithms ?? ["ES256", "RS256"],
      requiredClaims: ["exp", "iat", "sub", "aud", "client_id"],
    });

    // RFC 8707 audience binding is exact for Brian: an array containing the
    // resource is not accepted because it would make the token multi-audience.
    if (payload.aud !== audience) return { claims: null, failure: "wrong_audience" };
    if (payload.brian_resource !== audience || payload.brian_token_type !== "mcp") {
      return { claims: null, failure: "invalid_resource_or_type" };
    }
    if (!isUuid(payload.sub) || !isUuid(payload.tenant_id) || !isUuid(payload.brian_connection_id)) {
      return { claims: null, failure: "malformed_claims" };
    }
    const now = Math.floor(Date.now() / 1000);
    const tolerance = cfg.clockToleranceSeconds ?? 5;
    if (typeof payload.iat !== "number" || typeof payload.exp !== "number") {
      return { claims: null, failure: "malformed_claims" };
    }
    if (payload.iat > now + tolerance) return { claims: null, failure: "not_yet_valid" };
    if (payload.exp <= payload.iat) return { claims: null, failure: "invalid_lifetime" };
    // Do not rely solely on the provider's current dashboard setting. A token
    // minted with an unexpectedly long lifetime is not the short-lived MCP
    // credential Brian agreed to accept.
    if (payload.exp - payload.iat > (cfg.maxTokenLifetimeSeconds ?? 3_600)) {
      return { claims: null, failure: "invalid_lifetime" };
    }
    if (typeof payload.client_id !== "string" || payload.client_id.length === 0 || payload.client_id.length > 512) {
      return { claims: null, failure: "malformed_claims" };
    }
    if (!isHumanRole(payload.brian_role)) return { claims: null, failure: "malformed_claims" };
    if (!Array.isArray(payload.brian_permissions)
      || payload.brian_permissions.length === 0
      || !payload.brian_permissions.every(isAgentPermission)) {
      return { claims: null, failure: "malformed_claims" };
    }
    const permissions = normalizePermissions(payload.brian_permissions);
    if (permissions.length !== payload.brian_permissions.length) {
      return { claims: null, failure: "malformed_claims" };
    }

    return {
      claims: {
        userId: payload.sub,
        tenantId: payload.tenant_id,
        clientId: payload.client_id,
        connectionId: payload.brian_connection_id,
        role: payload.brian_role,
        permissions,
      },
      failure: null,
    };
  } catch (error) {
    return { claims: null, failure: joseFailure(error) };
  }
}
