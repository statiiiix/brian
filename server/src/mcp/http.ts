import type { Context } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { buildMcpServer } from "./server.js";
import type { App } from "../api/app.js";
import type { AuthPrincipal } from "../auth/principal.js";
import type { AuthEnv } from "../auth/middleware.js";
import { emitDomainMetric, type DomainMetricSink } from "../operations/domainMetrics.js";

interface InitializeObservation {
  clientName: unknown;
  clientVersion: unknown;
}

async function observeInitialize(c: Context<AuthEnv>): Promise<InitializeObservation | null> {
  const contentLength = Number(c.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 64 * 1024) return null;
  try {
    const body = await c.req.raw.clone().json() as {
      method?: unknown;
      params?: { clientInfo?: { name?: unknown; version?: unknown } };
    };
    if (body?.method !== "initialize") return null;
    return {
      clientName: body.params?.clientInfo?.name,
      clientVersion: body.params?.clientInfo?.version,
    };
  } catch {
    return null;
  }
}

// Stateless mode: a fresh server + transport per request. Simple, no session
// bookkeeping, and safe for concurrent clients; fine at this scale. The
// fetch-native transport returns a Response, so the same code runs on Node
// and on the Supabase Edge runtime.
async function handlePost(
  c: Context<AuthEnv>,
  metricSink?: DomainMetricSink,
): Promise<Response> {
  const principal = c.get("principal") as AuthPrincipal | undefined;
  const initialize = await observeInitialize(c);
  try {
    const server = buildMcpServer(principal);
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    const res = await transport.handleRequest(c);
    const response = res ?? c.body(null, 202);
    if (initialize) {
      emitDomainMetric(metricSink, {
        level: response.status >= 400 ? "warn" : "info",
        metric: "mcp_initialize",
        outcome: response.status >= 400 ? "failure" : "success",
        category: "mcp_request",
        requestId: c.get("requestId"),
        routeClass: "mcp",
        tenantId: principal?.tenantId,
        connectionId: principal && "connectionId" in principal ? principal.connectionId : null,
        clientName: initialize.clientName,
        clientVersion: initialize.clientVersion,
      });
    }
    return response;
  } catch (error) {
    if (initialize) {
      emitDomainMetric(metricSink, {
        level: "warn",
        metric: "mcp_initialize",
        outcome: "failure",
        category: "mcp_request",
        requestId: c.get("requestId"),
        routeClass: "mcp",
        tenantId: principal?.tenantId,
        connectionId: principal && "connectionId" in principal ? principal.connectionId : null,
        clientName: initialize.clientName,
        clientVersion: initialize.clientVersion,
      });
    }
    throw error;
  }
}

export function registerMcpHttp(app: App, metricSink?: DomainMetricSink): void {
  app.post("/mcp", (c) => handlePost(c, metricSink));
  const notAllowed = (c: Context) =>
    c.json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST (stateless mode)." },
      id: null,
    }, 405);
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
