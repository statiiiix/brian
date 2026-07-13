export type DomainMetricName =
  | "oauth_discovery"
  | "oauth_consent"
  | "mcp_initialize"
  | "agent_connection"
  | "principal_resolution"
  | "tenant_authorization"
  | "invitation";

export type DomainMetricOutcome =
  | "success"
  | "failure"
  | "prepared"
  | "denied"
  | "invalid_or_expired"
  | "created"
  | "revoked"
  | "valid"
  | "invalid"
  | "accepted"
  | "rejected";

export type DomainMetricCategory =
  | "protected_resource_metadata"
  | "authorization_request"
  | "agent_grant"
  | "mcp_request"
  | "dashboard_membership"
  | "mcp_grant_or_membership"
  | "requested_tenant_not_accessible"
  | "requested_resource_not_accessible"
  | "invitation_creation"
  | "invitation_preflight"
  | "invitation_consumption";

export type DomainMetricRouteClass = "public" | "bootstrap" | "human" | "mcp";

/**
 * Provider-neutral, deliberately closed operational metric shape.
 *
 * No arbitrary metadata bag is allowed: every label is either a finite enum,
 * a trusted server identifier, or a narrowly sanitized MCP client label.
 */
export interface DomainMetricLog {
  timestamp: string;
  level: "info" | "warn";
  event: "domain_metric";
  metric: DomainMetricName;
  outcome: DomainMetricOutcome;
  category: DomainMetricCategory;
  request_id: string | null;
  route_class: DomainMetricRouteClass;
  tenant_id: string | null;
  connection_id: string | null;
  client_name: string | null;
  client_version: string | null;
}

export type DomainMetricSink = (entry: DomainMetricLog) => void;

export interface DomainMetricInput {
  level?: DomainMetricLog["level"];
  metric: DomainMetricName;
  outcome: DomainMetricOutcome;
  category: DomainMetricCategory;
  requestId?: string | null;
  routeClass: DomainMetricRouteClass;
  tenantId?: string | null;
  connectionId?: string | null;
  clientName?: unknown;
  clientVersion?: unknown;
}

const SENSITIVE_LABEL = /(?:authorization|bearer|credential|password|secret|token|refresh|verifier|state|code|api[_ -]?key)/i;
const HIGH_ENTROPY_RUN = /[A-Za-z0-9_-]{32,}/;
const SAFE_CLIENT_LABEL = /^[A-Za-z0-9@][A-Za-z0-9 ._+/@():-]*$/;
const SAFE_INTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * MCP clientInfo is caller supplied. Retain only short, ordinary product and
 * version labels; suspicious or token-shaped values are dropped completely.
 */
export function sanitizeMetricClientLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 64) return null;
  if (!SAFE_CLIENT_LABEL.test(normalized)) return null;
  if (SENSITIVE_LABEL.test(normalized) || HIGH_ENTROPY_RUN.test(normalized)) return null;
  return normalized;
}

function safeInternalId(value: string | null | undefined): string | null {
  if (!value || !SAFE_INTERNAL_ID.test(value)) return null;
  return value;
}

/** Best-effort telemetry must never change an application response. */
export function emitDomainMetric(
  sink: DomainMetricSink | null | undefined,
  input: DomainMetricInput,
  now: () => number = Date.now,
): void {
  if (!sink) return;
  const entry: DomainMetricLog = {
    timestamp: new Date(now()).toISOString(),
    level: input.level ?? "info",
    event: "domain_metric",
    metric: input.metric,
    outcome: input.outcome,
    category: input.category,
    request_id: safeInternalId(input.requestId),
    route_class: input.routeClass,
    tenant_id: safeInternalId(input.tenantId),
    connection_id: safeInternalId(input.connectionId),
    client_name: sanitizeMetricClientLabel(input.clientName),
    client_version: sanitizeMetricClientLabel(input.clientVersion),
  };
  try {
    sink(entry);
  } catch {
    // A metrics backend outage must not take down signup, OAuth, or MCP.
  }
}
