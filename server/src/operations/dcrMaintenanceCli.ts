import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadServerEnv } from "../env.js";
import {
  createDcrMaintenancePool,
  createSupabaseOAuthAdminAdapter,
  executeDcrMaintenance,
  loadLifecycleEvidence,
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
  secretKey: string;
  databaseUrl: string;
  protectedClientIds: Set<string>;
}

export function readDcrMaintenanceConfig(env: NodeJS.ProcessEnv): DcrMaintenanceConfig {
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  const databaseUrl = env.DCR_MAINTENANCE_DATABASE_URL?.trim();
  if (!supabaseUrl || !secretKey || !databaseUrl) {
    throw new Error("SUPABASE_URL, SUPABASE_SECRET_KEY, and DCR_MAINTENANCE_DATABASE_URL are required");
  }
  const protectedClientIds = new Set(
    String(env.DCR_PROTECTED_CLIENT_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return { supabaseUrl, secretKey, databaseUrl, protectedClientIds };
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
  const config = readDcrMaintenanceConfig(env);
  const createPool = dependencies.createPool ?? createDcrMaintenancePool;
  const pool = createPool(config.databaseUrl);
  try {
    const admin = createSupabaseOAuthAdminAdapter(config);
    const [clients, lifecycle] = await Promise.all([
      admin.listClients(),
      loadLifecycleEvidence(pool),
    ]);
    const result = await executeDcrMaintenance({
      clients,
      evidence: lifecycle,
      protectedClientIds: config.protectedClientIds,
      now: dependencies.now?.() ?? new Date(),
      runId: dependencies.runId?.() ?? randomUUID(),
      mode: options.mode,
      markerDrift: null,
      deleteClient: admin.deleteClient,
    });
    write(JSON.stringify(result.summary));
    for (const deletion of result.deletions) write(JSON.stringify(deletion));
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
