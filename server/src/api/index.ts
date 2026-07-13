import { loadServerEnv } from "../env.js";
loadServerEnv();

const { buildApp } = await import("./app.js");
const { ensureLegacyToken } = await import("../auth/apiTokens.js");
const { FOUNDING_TENANT_ID } = await import("../db/tenant.js");

const port = Number(process.env.PORT ?? 3001);

// Migrate the single global BRIAN_API_TOKEN into the founding tenant's first
// api_tokens row so normal requests use the tracked/revocable resolver. Keep
// the direct compatibility fallback only when that bootstrap cannot reach a
// migrated database, preserving startup during a staged rollout.
const staticToken = process.env.BRIAN_API_TOKEN;
let directStaticFallback: string | null = staticToken ?? null;
if (staticToken) {
  try {
    await ensureLegacyToken(FOUNDING_TENANT_ID, staticToken, "BRIAN_API_TOKEN (founding)");
    directStaticFallback = null;
  } catch (error) {
    console.error("founding token seed failed; using temporary direct fallback:", error);
  }
}

const { serve } = await import("@hono/node-server");

const app = buildApp({
  authToken: directStaticFallback,
  jwtSecret: process.env.AUTH_JWT_SECRET ?? null,
});
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (addr) =>
  console.log(`API listening on http://${addr.address}:${addr.port}`),
);
