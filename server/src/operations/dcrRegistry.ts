import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const { Pool } = pg;
const STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

export interface RegistryClient {
  clientId: string;
  registrationType: "dynamic" | "manual";
  createdAt: Date;
}

export interface ClientLifecycleEvidence {
  brianOpenConnections: Set<string>;
  supabaseActiveAuthorizations: Set<string>;
  evidenceComplete: boolean;
}

export type RegistryOutcome =
  | "stale_eligible"
  | "retained_manual"
  | "retained_recent"
  | "retained_brian_connection"
  | "retained_supabase_authorization"
  | "retained_protected"
  | "retained_evidence_incomplete";

export interface ClassifiedRegistryClient {
  client: RegistryClient;
  outcome: RegistryOutcome;
}

export interface DcrAuditSummary {
  runId: string;
  mode: "audit" | "cleanup";
  dynamicTotal: number;
  createdLast10Minutes: number;
  createdLast24Hours: number;
  withBrianConnection: number;
  staleEligible: number;
  deleted: number;
  retained: number;
  failed: number;
  markerDrift: boolean | null;
}

export interface DcrDeletionRecord {
  clientIdHash: string;
  ageBucket: "24h-7d" | "7d-30d" | "30d+";
  outcome: "deleted" | "failed";
  runId: string;
}

interface RegistryClassificationInput {
  clients: RegistryClient[];
  evidence: ClientLifecycleEvidence;
  protectedClientIds: Set<string>;
  now: Date;
}

export function classifyRegistry(input: RegistryClassificationInput): ClassifiedRegistryClient[] {
  return input.clients.map((client) => {
    let outcome: RegistryOutcome;
    if (client.registrationType === "manual") outcome = "retained_manual";
    else if (!input.evidence.evidenceComplete) outcome = "retained_evidence_incomplete";
    else if (input.protectedClientIds.has(client.clientId)) outcome = "retained_protected";
    else if (input.now.getTime() - client.createdAt.getTime() <= STALE_AFTER_MS) outcome = "retained_recent";
    else if (input.evidence.brianOpenConnections.has(client.clientId)) outcome = "retained_brian_connection";
    else if (input.evidence.supabaseActiveAuthorizations.has(client.clientId)) {
      outcome = "retained_supabase_authorization";
    } else outcome = "stale_eligible";
    return { client, outcome };
  });
}

function clientIdHash(clientId: string): string {
  return createHash("sha256").update(clientId).digest("hex");
}

function ageBucket(createdAt: Date, now: Date): DcrDeletionRecord["ageBucket"] {
  const ageDays = (now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1_000);
  if (ageDays < 7) return "24h-7d";
  if (ageDays < 30) return "7d-30d";
  return "30d+";
}

interface ExecuteDcrMaintenanceInput extends RegistryClassificationInput {
  runId: string;
  mode: "audit" | "cleanup";
  markerDrift: boolean | null;
  deleteClient(clientId: string): Promise<void>;
}

export async function executeDcrMaintenance(input: ExecuteDcrMaintenanceInput): Promise<{
  summary: DcrAuditSummary;
  deletions: DcrDeletionRecord[];
}> {
  const classified = classifyRegistry(input);
  const dynamic = classified.filter(({ client }) => client.registrationType === "dynamic");
  const eligible = dynamic.filter(({ outcome }) => outcome === "stale_eligible");
  const createdWithin = (milliseconds: number) => dynamic.filter(({ client }) => {
    const age = input.now.getTime() - client.createdAt.getTime();
    return age >= 0 && age <= milliseconds;
  }).length;
  const deletions: DcrDeletionRecord[] = [];
  let deleted = 0;
  let failed = 0;

  if (input.mode === "cleanup") {
    for (const { client } of eligible) {
      const record = {
        clientIdHash: clientIdHash(client.clientId),
        ageBucket: ageBucket(client.createdAt, input.now),
        runId: input.runId,
      } as const;
      try {
        await input.deleteClient(client.clientId);
        deleted += 1;
        deletions.push({ ...record, outcome: "deleted" });
      } catch {
        failed += 1;
        deletions.push({ ...record, outcome: "failed" });
        break;
      }
    }
  }

  return {
    summary: {
      runId: input.runId,
      mode: input.mode,
      dynamicTotal: dynamic.length,
      createdLast10Minutes: createdWithin(10 * 60 * 1_000),
      createdLast24Hours: createdWithin(STALE_AFTER_MS),
      withBrianConnection: dynamic.filter(({ client }) =>
        input.evidence.brianOpenConnections.has(client.clientId)).length,
      staleEligible: eligible.length,
      deleted,
      retained: dynamic.length - deleted,
      failed,
      markerDrift: input.markerDrift,
    },
    deletions,
  };
}

interface SupabaseOAuthClientRow {
  client_id?: unknown;
  registration_type?: unknown;
  created_at?: unknown;
}

interface SupabaseOAuthAdminLike {
  auth: {
    admin: {
      oauth: {
        listClients(params: { page: number; perPage: number }): Promise<{
          data: { clients: SupabaseOAuthClientRow[]; nextPage?: number | null };
          error: unknown;
        }>;
        deleteClient(clientId: string): Promise<{ data: null; error: unknown }>;
      };
    };
  };
}

interface SupabaseOAuthAdminAdapterOptions {
  supabaseUrl: string;
  secretKey: string;
  clientFactory?: (
    url: string,
    key: string,
    options: { auth: { autoRefreshToken: false; persistSession: false } },
  ) => SupabaseOAuthAdminLike;
}

type SupabaseOAuthClientFactory = NonNullable<SupabaseOAuthAdminAdapterOptions["clientFactory"]>;

export function createSupabaseOAuthAdminAdapter(options: SupabaseOAuthAdminAdapterOptions): {
  listClients(): Promise<RegistryClient[]>;
  deleteClient(clientId: string): Promise<void>;
} {
  const factory: SupabaseOAuthClientFactory = options.clientFactory
    ?? (createClient as unknown as SupabaseOAuthClientFactory);
  const supabase = factory(options.supabaseUrl, options.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    async listClients() {
      const clients: RegistryClient[] = [];
      let page = 1;
      for (;;) {
        const response = await supabase.auth.admin.oauth.listClients({ page, perPage: 100 })
          .catch(() => { throw new Error("Supabase OAuth client listing failed"); });
        if (response.error) throw new Error("Supabase OAuth client listing failed");
        for (const row of response.data.clients) {
          if (typeof row.client_id !== "string"
            || (row.registration_type !== "dynamic" && row.registration_type !== "manual")
            || typeof row.created_at !== "string") {
            throw new Error("Supabase OAuth client listing returned invalid data");
          }
          const createdAt = new Date(row.created_at);
          if (Number.isNaN(createdAt.getTime())) {
            throw new Error("Supabase OAuth client listing returned invalid data");
          }
          clients.push({
            clientId: row.client_id,
            registrationType: row.registration_type,
            createdAt,
          });
        }
        const nextPage = response.data.nextPage ?? null;
        if (nextPage === null) break;
        if (!Number.isInteger(nextPage) || nextPage <= page) {
          throw new Error("Supabase OAuth client listing returned invalid pagination");
        }
        page = nextPage;
      }
      return clients;
    },
    async deleteClient(clientId: string) {
      const response = await supabase.auth.admin.oauth.deleteClient(clientId)
        .catch(() => { throw new Error("Supabase OAuth client deletion failed"); });
      if (response.error) throw new Error("Supabase OAuth client deletion failed");
    },
  };
}

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface MaintenancePool {
  connect(): Promise<Queryable & { release(): void }>;
  end(): Promise<void>;
}

export function createDcrMaintenancePool(databaseUrl: string): MaintenancePool {
  return new Pool({
    connectionString: databaseUrl,
    application_name: "brian_dcr_audit",
    statement_timeout: 10_000,
    options: "-c default_transaction_read_only=on",
  }) as unknown as MaintenancePool;
}

export async function assertReadOnlyMaintenanceConnection(client: Queryable): Promise<void> {
  let rows: Record<string, unknown>[];
  try {
    ({ rows } = await client.query(`
      select current_setting('transaction_read_only') as transaction_read_only,
             r.rolsuper as is_superuser,
             (select pg_get_userbyid(d.datdba) = current_user
                from pg_database d where d.datname = current_database()) as is_database_owner
        from pg_roles r where r.rolname = current_user
    `));
  } catch {
    throw new Error("DCR maintenance database safety check failed");
  }
  const row = rows[0];
  if (!row
    || row.transaction_read_only !== "on"
    || row.is_superuser !== false
    || row.is_database_owner !== false) {
    throw new Error("DCR maintenance database connection is not a read-only non-owner role");
  }
}

const REQUIRED_LIFECYCLE_COLUMNS = new Set([
  "public.agent_connections.oauth_client_id",
  "public.agent_connections.status",
  "auth.sessions.oauth_client_id",
  "auth.sessions.not_after",
  "auth.oauth_authorizations.client_id",
  "auth.oauth_authorizations.status",
  "auth.oauth_authorizations.expires_at",
]);

export async function loadLifecycleEvidence(pool: MaintenancePool): Promise<ClientLifecycleEvidence> {
  const client = await pool.connect().catch(() => {
    throw new Error("DCR lifecycle evidence connection failed");
  });
  try {
    await assertReadOnlyMaintenanceConnection(client);
    const attestation = await client.query(`
      select table_schema, table_name, column_name
        from information_schema.columns
       where (table_schema = 'public' and table_name = 'agent_connections'
              and column_name in ('oauth_client_id', 'status'))
          or (table_schema = 'auth' and table_name = 'sessions'
              and column_name in ('oauth_client_id', 'not_after'))
          or (table_schema = 'auth' and table_name = 'oauth_authorizations'
              and column_name in ('client_id', 'status', 'expires_at'))
    `).catch(() => { throw new Error("DCR lifecycle schema attestation failed"); });
    const actual = new Set(attestation.rows.map((row) =>
      `${String(row.table_schema)}.${String(row.table_name)}.${String(row.column_name)}`));
    if (actual.size !== REQUIRED_LIFECYCLE_COLUMNS.size
      || [...REQUIRED_LIFECYCLE_COLUMNS].some((column) => !actual.has(column))) {
      throw new Error("DCR lifecycle schema attestation failed");
    }

    const brian = await client.query(`
      select distinct oauth_client_id
        from public.agent_connections
       where status in ('pending', 'active')
         and oauth_client_id is not null
    `).catch(() => { throw new Error("DCR Brian lifecycle evidence query failed"); });
    const supabase = await client.query(`
      select distinct client_id
        from (
          select oauth_client_id as client_id
            from auth.sessions
           where oauth_client_id is not null
             and (not_after is null or not_after > now())
          union
          select client_id
            from auth.oauth_authorizations
           where client_id is not null
             and status in ('pending', 'approved')
             and (expires_at is null or expires_at > now())
        ) lifecycle
    `).catch(() => { throw new Error("DCR Supabase lifecycle evidence query failed"); });

    return {
      brianOpenConnections: new Set(brian.rows.flatMap((row) =>
        typeof row.oauth_client_id === "string" ? [row.oauth_client_id] : [])),
      supabaseActiveAuthorizations: new Set(supabase.rows.flatMap((row) =>
        typeof row.client_id === "string" ? [row.client_id] : [])),
      evidenceComplete: true,
    };
  } finally {
    client.release();
  }
}
