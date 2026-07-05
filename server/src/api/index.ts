import { loadServerEnv } from "../env.js";
loadServerEnv();

const { buildApp } = await import("./app.js");
const { ensureToken } = await import("../auth/apiTokens.js");
const { FOUNDING_TENANT_ID } = await import("../db/tenant.js");

const port = Number(process.env.PORT ?? 3001);

// Migrate the single global BRIAN_API_TOKEN into the founding tenant's first
// api_tokens row so it also resolves through the per-tenant path (and can be
// retired from env later). Best-effort; never blocks startup.
const staticToken = process.env.BRIAN_API_TOKEN;
if (staticToken) {
  ensureToken(FOUNDING_TENANT_ID, staticToken, "BRIAN_API_TOKEN (founding)").catch((e) =>
    console.error("founding token seed failed:", e),
  );
}

buildApp({
  authToken: staticToken ?? null,
  jwtSecret: process.env.AUTH_JWT_SECRET ?? null,
})
  .listen({ port, host: "0.0.0.0" })
  .then((addr) => console.log(`API listening on ${addr}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
