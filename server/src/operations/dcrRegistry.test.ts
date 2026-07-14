import { describe, expect, it, vi } from "vitest";
import {
  assertReadOnlyMaintenanceConnection,
  classifyRegistry,
  createSupabaseOAuthAdminAdapter,
  executeDcrMaintenance,
  loadLifecycleEvidence,
  type ClientLifecycleEvidence,
  type RegistryClient,
} from "./dcrRegistry.js";

const NOW = new Date("2026-07-14T12:00:00.000Z");
const HOUR = 60 * 60 * 1_000;

function client(
  clientId: string,
  ageHours: number,
  registrationType: RegistryClient["registrationType"] = "dynamic",
): RegistryClient {
  return { clientId, registrationType, createdAt: new Date(NOW.getTime() - ageHours * HOUR) };
}

function evidence(overrides: Partial<ClientLifecycleEvidence> = {}): ClientLifecycleEvidence {
  return {
    brianOpenConnections: new Set(),
    supabaseActiveAuthorizations: new Set(),
    evidenceComplete: true,
    ...overrides,
  };
}

describe("DCR registry classification", () => {
  it("requires every stale predicate independently", () => {
    const rows = [
      client("eligible", 25),
      client("manual", 25, "manual"),
      client("recent", 23),
      client("brian-open", 25),
      client("supabase-active", 25),
      client("protected", 25),
    ];
    const classified = classifyRegistry({
      clients: rows,
      evidence: evidence({
        brianOpenConnections: new Set(["brian-open"]),
        supabaseActiveAuthorizations: new Set(["supabase-active"]),
      }),
      protectedClientIds: new Set(["protected"]),
      now: NOW,
    });
    expect(Object.fromEntries(classified.map((row) => [row.client.clientId, row.outcome])))
      .toEqual({
        eligible: "stale_eligible",
        manual: "retained_manual",
        recent: "retained_recent",
        "brian-open": "retained_brian_connection",
        "supabase-active": "retained_supabase_authorization",
        protected: "retained_protected",
      });
  });

  it("retains every dynamic client when lifecycle evidence is incomplete", () => {
    const classified = classifyRegistry({
      clients: [client("ambiguous-stale", 720), client("ambiguous-recent", 1)],
      evidence: evidence({ evidenceComplete: false }),
      protectedClientIds: new Set(),
      now: NOW,
    });
    expect(classified.map((row) => row.outcome)).toEqual([
      "retained_evidence_incomplete",
      "retained_evidence_incomplete",
    ]);
  });
});

describe("DCR registry maintenance output", () => {
  it("emits count-only summaries and redacted deletion records", async () => {
    const deleteClient = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("provider token=secret client_name=Secret App https://client.example/cb"));
    const result = await executeDcrMaintenance({
      clients: [client("dynamic-secret-id-1", 25), client("dynamic-secret-id-2", 200), client("dynamic-secret-id-3", 900)],
      evidence: evidence(),
      protectedClientIds: new Set(),
      now: NOW,
      runId: "run-safe-001",
      mode: "cleanup",
      markerDrift: false,
      deleteClient,
    });

    expect(deleteClient.mock.calls.map(([clientId]) => clientId)).toEqual([
      "dynamic-secret-id-1",
      "dynamic-secret-id-2",
    ]);
    expect(result.summary).toEqual({
      runId: "run-safe-001",
      mode: "cleanup",
      dynamicTotal: 3,
      createdLast10Minutes: 0,
      createdLast24Hours: 0,
      withBrianConnection: 0,
      staleEligible: 3,
      deleted: 1,
      retained: 2,
      failed: 1,
      markerDrift: false,
    });
    expect(result.deletions).toHaveLength(2);
    for (const record of result.deletions) {
      expect(Object.keys(record).sort()).toEqual(["ageBucket", "clientIdHash", "outcome", "runId"]);
      expect(record.clientIdHash).toMatch(/^[a-f0-9]{64}$/);
    }
    const json = JSON.stringify(result);
    for (const forbidden of [
      "dynamic-secret-id-1",
      "dynamic-secret-id-2",
      "dynamic-secret-id-3",
      "provider token=secret",
      "Secret App",
      "https://client.example/cb",
    ]) expect(json).not.toContain(forbidden);
  });

  it("keeps audit mode read-only", async () => {
    const deleteClient = vi.fn();
    const result = await executeDcrMaintenance({
      clients: [client("old-dynamic", 48)],
      evidence: evidence(),
      protectedClientIds: new Set(),
      now: NOW,
      runId: "run-audit-001",
      mode: "audit",
      markerDrift: null,
      deleteClient,
    });
    expect(deleteClient).not.toHaveBeenCalled();
    expect(result.summary).toMatchObject({ mode: "audit", staleEligible: 1, deleted: 0, retained: 1 });
    expect(result.deletions).toEqual([]);
  });
});

describe("Supabase OAuth Admin adapter", () => {
  it("paginates and immediately discards client metadata", async () => {
    const listClients = vi.fn()
      .mockResolvedValueOnce({
        data: {
          clients: [{
            client_id: "client-1",
            registration_type: "dynamic",
            created_at: "2026-07-14T10:00:00.000Z",
            client_name: "must disappear",
            client_secret: "must disappear",
            client_uri: "https://must-disappear.example",
            redirect_uris: ["https://must-disappear.example/cb"],
          }],
          nextPage: 2,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          clients: [{
            client_id: "client-2",
            registration_type: "manual",
            created_at: "2026-07-13T10:00:00.000Z",
            client_name: "must disappear too",
          }],
          nextPage: null,
        },
        error: null,
      });
    const deleteClient = vi.fn().mockResolvedValue({ data: null, error: null });
    const adapter = createSupabaseOAuthAdminAdapter({
      supabaseUrl: "https://project.supabase.co",
      secretKey: "server-secret",
      clientFactory: () => ({ auth: { admin: { oauth: { listClients, deleteClient } } } }),
    });
    expect(await adapter.listClients()).toEqual([
      { clientId: "client-1", registrationType: "dynamic", createdAt: new Date("2026-07-14T10:00:00.000Z") },
      { clientId: "client-2", registrationType: "manual", createdAt: new Date("2026-07-13T10:00:00.000Z") },
    ]);
    expect(listClients.mock.calls).toEqual([[{ page: 1, perPage: 100 }], [{ page: 2, perPage: 100 }]]);
    await adapter.deleteClient("client-1");
    expect(deleteClient).toHaveBeenCalledWith("client-1");
  });

  it("converts provider failures to fixed categories", async () => {
    const adapter = createSupabaseOAuthAdminAdapter({
      supabaseUrl: "https://project.supabase.co",
      secretKey: "server-secret",
      clientFactory: () => ({
        auth: { admin: { oauth: {
          listClients: vi.fn().mockResolvedValue({ data: { clients: [] }, error: new Error("provider list secret") }),
          deleteClient: vi.fn().mockResolvedValue({ data: null, error: new Error("provider delete secret") }),
        } } },
      }),
    });
    await expect(adapter.listClients()).rejects.toThrow(/^Supabase OAuth client listing failed$/);
    await expect(adapter.deleteClient("client-id")).rejects.toThrow(/^Supabase OAuth client deletion failed$/);
  });
});

describe("read-only lifecycle evidence", () => {
  it("rejects writable, owner, and superuser database roles", async () => {
    for (const row of [
      { transaction_read_only: "off", is_superuser: false, is_database_owner: false },
      { transaction_read_only: "on", is_superuser: true, is_database_owner: false },
      { transaction_read_only: "on", is_superuser: false, is_database_owner: true },
    ]) {
      await expect(assertReadOnlyMaintenanceConnection({
        query: vi.fn().mockResolvedValue({ rows: [row] }),
      })).rejects.toThrow("DCR maintenance database connection is not a read-only non-owner role");
    }
  });

  it("attests the exact lifecycle schema and performs SELECT-only evidence queries", async () => {
    const requiredColumns = [
      ["public", "agent_connections", "oauth_client_id"],
      ["public", "agent_connections", "status"],
      ["auth", "sessions", "oauth_client_id"],
      ["auth", "sessions", "not_after"],
      ["auth", "oauth_authorizations", "client_id"],
      ["auth", "oauth_authorizations", "status"],
      ["auth", "oauth_authorizations", "expires_at"],
    ].map(([table_schema, table_name, column_name]) => ({ table_schema, table_name, column_name }));
    const statements: string[] = [];
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      statements.push(sql);
      if (sql.includes("transaction_read_only")) {
        return { rows: [{ transaction_read_only: "on", is_superuser: false, is_database_owner: false }] };
      }
      if (sql.includes("information_schema.columns")) return { rows: requiredColumns };
      if (sql.includes("public.agent_connections")) return { rows: [{ oauth_client_id: "brian-open" }] };
      if (sql.includes("auth.sessions")) return { rows: [{ client_id: "supabase-active" }] };
      throw new Error("unexpected query");
    });
    const result = await loadLifecycleEvidence({
      connect: async () => ({ query, release }),
      end: async () => undefined,
    });
    expect(result).toEqual({
      brianOpenConnections: new Set(["brian-open"]),
      supabaseActiveAuthorizations: new Set(["supabase-active"]),
      evidenceComplete: true,
    });
    expect(statements.every((sql) => sql.trimStart().toLowerCase().startsWith("select"))).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it("fails closed when the attested schema is incomplete", async () => {
    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("transaction_read_only")) {
        return { rows: [{ transaction_read_only: "on", is_superuser: false, is_database_owner: false }] };
      }
      return { rows: [] };
    });
    await expect(loadLifecycleEvidence({
      connect: async () => ({ query, release }),
      end: async () => undefined,
    })).rejects.toThrow("DCR lifecycle schema attestation failed");
    expect(release).toHaveBeenCalledOnce();
  });
});
