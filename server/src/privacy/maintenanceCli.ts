import { loadServerEnv } from "../env.js";
import { pool } from "../db/pool.js";
import {
  createSupabaseAdminUserDeleter,
  maintenanceBatchLimit,
  previewMaintenance,
  processDueAccountDeletions,
  processDueCompanyDeletions,
  pruneRetention,
  retentionPolicy,
} from "./maintenance.js";

export interface MaintenanceCliOptions {
  processDue: boolean;
  prune: boolean;
  confirm: boolean;
  limit: number;
  help: boolean;
}
export function parseMaintenanceCli(argv: string[]): MaintenanceCliOptions {
  let processDue = false;
  let prune = false;
  let confirm = false;
  let help = false;
  let limit: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--process-due") processDue = true;
    else if (arg === "--prune-retention") prune = true;
    else if (arg === "--all") { processDue = true; prune = true; }
    else if (arg === "--confirm") confirm = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--limit") limit = maintenanceBatchLimit(argv[++index]);
    else throw new Error(`unknown privacy maintenance option: ${arg}`);
  }
  if (!processDue && !prune) { processDue = true; prune = true; }
  return { processDue, prune, confirm, limit: maintenanceBatchLimit(limit), help };
}

function usage(): string {
  return [
    "Usage: npm run privacy:maintain -- [--process-due|--prune-retention|--all] [--limit N] [--confirm]",
    "",
    "Dry-run is the default. --confirm is required before any deletion or retention pruning.",
    "Run only with the database-owner URL; account deletion also requires SUPABASE_URL and",
    "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY). Secrets are never printed.",
  ].join("\n");
}

export async function runMaintenanceCli(argv: string[]): Promise<void> {
  loadServerEnv();
  const options = parseMaintenanceCli(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const policy = retentionPolicy();
  const preview = await previewMaintenance(pool, policy);
  if (!options.confirm) {
    console.log(JSON.stringify({ mode: "dry-run", policy, preview }));
    return;
  }

  const result = {
    processedAccounts: 0,
    failedAccounts: 0,
    processedCompanies: 0,
    prunedAuditEvents: 0,
    prunedExecutions: 0,
  };
  if (options.processDue) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serverSecret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
    if (preview.dueAccountRequests > 0 && (!supabaseUrl || !serverSecret)) {
      throw new Error("Supabase server credentials are required to process due account deletions");
    }
    if (supabaseUrl && serverSecret) {
      const accounts = await processDueAccountDeletions({
        pool,
        admin: createSupabaseAdminUserDeleter({ supabaseUrl, serviceRoleKey: serverSecret }),
        limit: options.limit,
      });
      result.processedAccounts = accounts.processed;
      result.failedAccounts = accounts.failed;
    }
    result.processedCompanies = await processDueCompanyDeletions(pool, options.limit);
  }
  if (options.prune) {
    const pruned = await pruneRetention({ pool, policy, limit: options.limit });
    result.prunedAuditEvents = pruned.auditEvents;
    result.prunedExecutions = pruned.executions;
  }
  console.log(JSON.stringify({ mode: "confirmed", policy, result }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMaintenanceCli(process.argv.slice(2))
    .then(() => pool.end())
    .catch((error) => {
      // Fixed messages above contain no provider response body or credential.
      console.error(error instanceof Error ? error.message : "privacy maintenance failed");
      process.exitCode = 1;
      return pool.end();
    });
}
