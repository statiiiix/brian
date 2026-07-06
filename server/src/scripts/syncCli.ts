import { loadServerEnv } from "../env.js";
loadServerEnv();

// Dynamic imports so env is loaded before any module reads process.env.
const { runTenant, FOUNDING_TENANT_ID } = await import("../db/tenant.js");
const { syncConnector } = await import("../connectors/sync.js");
const { CONNECTOR_TYPES } = await import("../connectors/adapters/index.js");
const { pool } = await import("../db/pool.js");

const arg = (process.argv[2] ?? "all").toLowerCase();
const types = arg === "all" ? CONNECTOR_TYPES : [arg];

await runTenant(FOUNDING_TENANT_ID, async () => {
  for (const type of types) {
    if (!CONNECTOR_TYPES.includes(type as (typeof CONNECTOR_TYPES)[number])) {
      console.error(`unknown connector: ${type} (expected: ${CONNECTOR_TYPES.join(", ")}, or all)`);
      continue;
    }
    try {
      const s = await syncConnector(type as (typeof CONNECTOR_TYPES)[number]);
      console.log(`[${type}] fetched=${s.fetched} kept=${s.kept} evidence=${s.evidence} drafts=${s.drafts}`);
    } catch (e) {
      console.error(`[${type}] sync failed:`, e instanceof Error ? e.message : e);
    }
  }
});

await pool.end();
