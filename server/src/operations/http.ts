import type { Context, MiddlewareHandler } from "hono";
import type { AuthEnv } from "../auth/middleware.js";
import type { DomainMetricLog } from "./domainMetrics.js";

export interface RateLimitConfig {
  requests: number;
  windowMs: number;
  maxKeys?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
}

interface RateWindow {
  count: number;
  resetAt: number;
}

/**
 * A deliberately small, isolate-local limiter. It protects each running Edge
 * isolate from bursts; the deployment gateway remains responsible for a
 * globally coordinated abuse limit.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, RateWindow>();

  constructor(
    private readonly config: RateLimitConfig,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(config.requests) || config.requests < 1) {
      throw new Error("rate-limit requests must be a positive integer");
    }
    if (!Number.isSafeInteger(config.windowMs) || config.windowMs < 1_000) {
      throw new Error("rate-limit windowMs must be at least 1000");
    }
  }

  take(key: string): RateLimitResult {
    const now = this.now();
    let current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      current = { count: 0, resetAt: now + this.config.windowMs };
      this.windows.set(key, current);
    }
    current.count += 1;
    this.prune(now);
    const remaining = Math.max(0, this.config.requests - current.count);
    return {
      allowed: current.count <= this.config.requests,
      limit: this.config.requests,
      remaining,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
      resetAt: current.resetAt,
    };
  }

  private prune(now: number): void {
    const maxKeys = this.config.maxKeys ?? 10_000;
    if (this.windows.size <= maxKeys) return;
    for (const [key, value] of this.windows) {
      if (value.resetAt <= now || this.windows.size > maxKeys) this.windows.delete(key);
      if (this.windows.size <= maxKeys) break;
    }
  }
}

function safeAddress(value: string | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 128 || !/^[0-9a-f:.]+$/i.test(candidate)) return null;
  return candidate.toLowerCase();
}

/**
 * These headers must be overwritten by the trusted production gateway. The
 * fallback "unknown" bucket is intentionally shared instead of letting an
 * arbitrary caller choose an unbounded key.
 */
export function trustedClientAddress(c: Context): string {
  const cloudflare = safeAddress(c.req.header("cf-connecting-ip"));
  if (cloudflare) return cloudflare;
  const realIp = safeAddress(c.req.header("x-real-ip"));
  if (realIp) return realIp;
  const forwarded = safeAddress(c.req.header("x-forwarded-for")?.split(",", 1)[0]);
  return forwarded ?? "unknown";
}

function applyRateHeaders(c: Context, result: RateLimitResult): void {
  c.header("X-RateLimit-Limit", String(result.limit));
  c.header("X-RateLimit-Remaining", String(result.remaining));
  c.header("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1_000)));
}

export function rateLimitMiddleware(
  limiter: FixedWindowRateLimiter,
  keyFor: (c: Context<AuthEnv>) => string | null,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const key = keyFor(c);
    if (!key) return next();
    const result = limiter.take(key);
    applyRateHeaders(c, result);
    if (!result.allowed) {
      c.header("Retry-After", String(result.retryAfterSeconds));
      c.header("Cache-Control", "no-store");
      return c.json({ error: "rate_limited" }, 429);
    }
    return next();
  };
}

export function mcpPreAuthRateLimitKey(c: Context<AuthEnv>): string {
  return `ip:${trustedClientAddress(c)}`;
}

export function mcpAuthenticatedRateLimitKey(c: Context<AuthEnv>): string | null {
  const principal = c.get("principal");
  if (!principal) return null;
  if ("connectionId" in principal && principal.connectionId) {
    return `connection:${principal.connectionId}`;
  }
  return `tenant:${principal.tenantId}`;
}

export interface HttpRequestLog {
  timestamp: string;
  level: "info" | "warn" | "error";
  event: "http_request";
  request_id: string | null;
  route_class: "public" | "bootstrap" | "human" | "mcp";
  method: string;
  path: string;
  status: number;
  tenant_id: string | null;
  connection_id: string | null;
  error_category: string | null;
  latency_ms: number;
}

export interface AuthFailureLog {
  timestamp: string;
  level: "warn";
  event: "auth_failure";
  request_id: string | null;
  route_class: "mcp";
  path: string;
  error_category: string;
}

export type OperationalLog = HttpRequestLog | AuthFailureLog | DomainMetricLog;
export type HttpLogSink = (entry: OperationalLog) => void;

function routeClass(path: string, method: string): HttpRequestLog["route_class"] {
  if (path.endsWith("/.well-known/oauth-protected-resource")
    || path.endsWith("/.well-known/oauth-protected-resource/mcp")
    || path.endsWith("/api/auth/login")
    || path.endsWith("/api/public/config")
    || path.endsWith("/api/public/invitations/validate")
    || /\/api\/connectors\/[a-z_]+\/callback$/.test(path)) return "public";
  if (path.endsWith("/api/invitations/accept")) return "bootstrap";
  if (method === "GET" && path.endsWith("/api/privacy/deletion-requests")) return "bootstrap";
  if (method === "DELETE" && /\/api\/privacy\/deletion-requests\/[0-9a-f-]{36}$/.test(path)) {
    return "bootstrap";
  }
  if (path.endsWith("/mcp") || path.includes("/api/agent/")) return "mcp";
  return "human";
}

function errorCategory(status: number, threw: boolean): string | null {
  if (threw || status >= 500) return "server_error";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status >= 400) return "client_error";
  return null;
}

export function consoleJsonLogSink(entry: OperationalLog): void {
  console.log(JSON.stringify(entry));
}

/**
 * Logs only a normalized path (never a query string), categorical outcome,
 * and server-resolved principal identifiers. It never reads request headers
 * or bodies, so bearer tokens, OAuth codes/state, and connector secrets cannot
 * enter this event shape.
 */
export function requestLogMiddleware(
  sink: HttpLogSink = consoleJsonLogSink,
  now: () => number = Date.now,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const startedAt = now();
    let threw = false;
    try {
      await next();
    } catch (error) {
      threw = true;
      throw error;
    } finally {
      const principal = c.get("principal");
      const status = threw ? 500 : c.res.status;
      const entry: HttpRequestLog = {
        timestamp: new Date(startedAt).toISOString(),
        level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
        event: "http_request",
        request_id: c.get("requestId") ?? null,
        route_class: routeClass(c.req.path, c.req.method),
        method: c.req.method,
        path: c.req.path,
        status,
        tenant_id: principal?.tenantId ?? null,
        connection_id: principal && "connectionId" in principal ? principal.connectionId : null,
        error_category: errorCategory(status, threw),
        latency_ms: Math.max(0, now() - startedAt),
      };
      sink(entry);
    }
  };
}
