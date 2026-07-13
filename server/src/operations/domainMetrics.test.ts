import { describe, expect, it, vi } from "vitest";
import { emitDomainMetric, sanitizeMetricClientLabel } from "./domainMetrics.js";

describe("domain metrics", () => {
  it("emits a closed, bounded provider-neutral event", () => {
    const sink = vi.fn();
    emitDomainMetric(sink, {
      metric: "mcp_initialize",
      outcome: "success",
      category: "agent_grant",
      requestId: "request-1",
      routeClass: "mcp",
      tenantId: "20000000-0000-0000-0000-000000000002",
      connectionId: "30000000-0000-0000-0000-000000000003",
      clientName: "Claude Desktop",
      clientVersion: "1.2.3",
    }, () => 1_700_000_000_000);

    expect(sink).toHaveBeenCalledWith({
      timestamp: "2023-11-14T22:13:20.000Z",
      level: "info",
      event: "domain_metric",
      metric: "mcp_initialize",
      outcome: "success",
      category: "agent_grant",
      request_id: "request-1",
      route_class: "mcp",
      tenant_id: "20000000-0000-0000-0000-000000000002",
      connection_id: "30000000-0000-0000-0000-000000000003",
      client_name: "Claude Desktop",
      client_version: "1.2.3",
    });
    expect(Object.keys(sink.mock.calls[0][0]).sort()).toEqual([
      "category", "client_name", "client_version", "connection_id", "event", "level",
      "metric", "outcome", "request_id", "route_class", "tenant_id", "timestamp",
    ]);
  });

  it("drops secret-like, high-entropy, control-character, and oversized client labels", () => {
    expect(sanitizeMetricClientLabel("Cursor 2.4.1")).toBe("Cursor 2.4.1");
    expect(sanitizeMetricClientLabel("  Claude   Desktop  ")).toBe("Claude Desktop");
    for (const value of [
      "Bearer eyJhbGciOiJIUzI1NiJ9.secret",
      "refresh_token=do-not-log",
      "abcdefghijklmnopqrstuvwxyzABCDEF1234567890",
      "client\npassword=hidden",
      "x".repeat(65),
    ]) {
      expect(sanitizeMetricClientLabel(value)).toBeNull();
    }
  });

  it("swallows sink failures so telemetry cannot break the request boundary", () => {
    expect(() => emitDomainMetric(() => { throw new Error("provider down"); }, {
      metric: "oauth_discovery",
      outcome: "success",
      category: "protected_resource_metadata",
      routeClass: "public",
    })).not.toThrow();
  });
});
