import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadServerEnv } from "../env.js";
import {
  createDcrMaintenancePool,
  createSupabaseOAuthAdminAdapter,
  executeDcrMaintenance,
  isClientLifecycleInactive,
  loadDcrMarkerState,
  loadLifecycleEvidence,
  loadRegistryClients,
  type MaintenancePool,
} from "./dcrRegistry.js";

export interface DcrMaintenanceOptions {
  mode: "audit" | "cleanup";
  help: boolean;
}

export function parseDcrMaintenanceArgs(argv: string[]): DcrMaintenanceOptions {
  let deleteStale = false;
  let yes = false;
  let help = false;
  for (const argument of argv) {
    if (argument === "--delete-stale") deleteStale = true;
    else if (argument === "--yes") yes = true;
    else if (argument === "--help" || argument === "-h") help = true;
    else throw new Error("unknown DCR maintenance option");
  }
  if (deleteStale && !yes) throw new Error("--delete-stale requires --yes");
  if (yes && !deleteStale) throw new Error("--yes requires --delete-stale");
  return { mode: deleteStale ? "cleanup" : "audit", help };
}

export interface DcrMaintenanceConfig {
  supabaseUrl: string;
  secretKey: string | null;
  databaseUrl: string;
  publicConfigUrl: string;
  protectedClientIds: Set<string>;
}

export function assertDcrMaintenanceSucceeded(summary: {
  failed: number;
  markerDrift: boolean | null;
  cleanupBlocked: boolean;
}): void {
  if (summary.failed > 0) throw new Error("DCR maintenance completed with failures");
  if (summary.markerDrift) throw new Error("DCR maintenance marker drift detected");
  if (summary.cleanupBlocked) {
    throw new Error("DCR cleanup requires provider DCR and Brian approvals to be paused");
  }
}

function normalizeSupabaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DCR maintenance configuration failed");
  }
  if (url.protocol !== "https:"
    || url.username
    || url.password
    || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search
    || url.hash) {
    throw new Error("DCR maintenance configuration failed");
  }
  return url.origin;
}

function normalizePublicConfigUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DCR maintenance configuration failed");
  }
  if (url.protocol !== "https:"
    || url.username
    || url.password
    || url.hostname !== "api.brianthebrain.app"
    || url.pathname !== "/api/public/config"
    || url.search
    || url.hash) {
    throw new Error("DCR maintenance configuration failed");
  }
  return url.toString();
}

export function readDcrMaintenanceConfig(
  env: NodeJS.ProcessEnv,
  mode: "audit" | "cleanup" = "audit",
): DcrMaintenanceConfig {
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  const databaseUrl = env.DCR_MAINTENANCE_DATABASE_URL?.trim();
  if (!supabaseUrl || !databaseUrl) {
    throw new Error("SUPABASE_URL and DCR_MAINTENANCE_DATABASE_URL are required");
  }
  if (mode === "cleanup" && !secretKey) {
    throw new Error("SUPABASE_SECRET_KEY is required for DCR cleanup");
  }
  const trustedSupabaseUrl = normalizeSupabaseUrl(supabaseUrl);
  const protectedClientIds = new Set(
    String(env.DCR_PROTECTED_CLIENT_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const publicConfigUrl = normalizePublicConfigUrl(env.BRIAN_PUBLIC_CONFIG_URL?.trim()
    || "https://api.brianthebrain.app/api/public/config");
  return {
    supabaseUrl: trustedSupabaseUrl,
    secretKey: secretKey || null,
    databaseUrl,
    publicConfigUrl,
    protectedClientIds,
  };
}

function usage(): string {
  return [
    "Usage: npm run oauth:dcr:audit -- [--delete-stale --yes]",
    "",
    "Audit is the read-only default. Cleanup requires both --delete-stale and --yes.",
    "Server credentials and protected client identifiers are read only from environment variables.",
  ].join("\n");
}

interface DcrMaintenanceDependencies {
  now(): Date;
  runId(): string;
  createPool(databaseUrl: string): MaintenancePool;
  write(line: string): void;
}

export async function runDcrMaintenanceCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  dependencies: Partial<DcrMaintenanceDependencies> = {},
): Promise<void> {
  const options = parseDcrMaintenanceArgs(argv);
  const write = dependencies.write ?? ((line: string) => console.log(line));
  if (options.help) {
    write(usage());
    return;
  }
  const config = readDcrMaintenanceConfig(env, options.mode);
  const createPool = dependencies.createPool ?? createDcrMaintenancePool;
  const pool = createPool(config.databaseUrl);
  try {
    const admin = options.mode === "cleanup"
      ? createSupabaseOAuthAdminAdapter({
        supabaseUrl: config.supabaseUrl,
        secretKey: config.secretKey!,
      })
      : null;
    const [clients, lifecycle, markerState] = await Promise.all([
      admin ? admin.listClients() : loadRegistryClients(pool),
      loadLifecycleEvidence(pool),
      loadDcrMarkerState({
        supabaseUrl: config.supabaseUrl,
        publicConfigUrl: config.publicConfigUrl,
      }),
    ]);
    const result = await executeDcrMaintenance({
      clients,
      evidence: lifecycle,
      protectedClientIds: config.protectedClientIds,
      now: dependencies.now?.() ?? new Date(),
      runId: dependencies.runId?.() ?? randomUUID(),
      mode: options.mode,
      markerState,
      revalidateCleanupWindow: options.mode === "cleanup"
        ? async () => {
          const current = await loadDcrMarkerState({
            supabaseUrl: config.supabaseUrl,
            publicConfigUrl: config.publicConfigUrl,
          });
          return !current.providerDcrAdvertised
            && !current.brianDcrEnabled
            && !current.brianApprovalsEnabled
            && !current.markerDrift;
        }
        : undefined,
      revalidateClient: (clientId) => isClientLifecycleInactive(pool, clientId),
      deleteClient: admin
        ? admin.deleteClient
        : async () => { throw new Error("DCR audit cannot delete clients"); },
    });
    write(JSON.stringify(result.summary));
    for (const deletion of result.deletions) write(JSON.stringify(deletion));
    assertDcrMaintenanceSucceeded(result.summary);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const direct = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];
if (direct) {
  loadServerEnv();
  runDcrMaintenanceCli(process.argv.slice(2)).catch(() => {
    console.error("DCR maintenance failed");
    process.exitCode = 1;
  });
}
