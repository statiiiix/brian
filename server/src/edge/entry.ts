// Supabase Edge Function entry — bundled by `npm run edge:build` into
// supabase/functions/brian/index.js (our code only; npm deps resolve via the
// generated deno.json import map). Serves the same Hono app as `npm run api`.
//
// Edge-runtime env rules (learned the hard way): process.env READS pass
// through to the platform env; WRITES and Deno.env.toObject() throw
// NotSupported. So no env bridging here — code reads process.env lazily, and
// the pool falls back to the platform-provided SUPABASE_DB_URL (pool.ts).
import { Hono } from "hono";
import { buildApp } from "../api/app.js";
import { ensureLegacyToken } from "../auth/apiTokens.js";
import { secret } from "../config/secrets.js";
import { FOUNDING_TENANT_ID } from "../db/tenant.js";

declare const Deno: {
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

// Config resolves env-first, with owner-only app_config retained only for
// legacy/local owner-mode compatibility. Production uses brian_app and must
// receive secrets from the deployment environment. Fail closed: if no
// BRIAN_API_TOKEN is configured, the guard gets a random unguessable
// token — the static-bearer path then never matches, but per-tenant
// api_tokens rows and Supabase/dashboard JWTs still resolve. The API is never
// served open on the public internet.
const configuredStaticToken = await secret("BRIAN_API_TOKEN");
let directStaticFallback = configuredStaticToken ?? crypto.randomUUID();
if (configuredStaticToken) {
  try {
    await ensureLegacyToken(
      FOUNDING_TENANT_ID,
      configuredStaticToken,
      "BRIAN_API_TOKEN (founding)",
    );
    // The configured bearer now resolves through api_tokens, so keep the
    // direct comparison path deliberately unmatchable.
    directStaticFallback = crypto.randomUUID();
  } catch (error) {
    console.error("founding token seed failed; using temporary direct fallback:", error);
  }
}

const inner = buildApp({
  authToken: directStaticFallback,
  jwtSecret: (await secret("AUTH_JWT_SECRET")) ?? null,
});

// The edge runtime hands the function the path segment after /functions/v1,
// i.e. "/brian/api/skills". Mount at /brian, plus bare paths as a fallback in
// case a gateway variant strips the function name.
declare const __BUILD_ID__: string; // injected by scripts/edge-build.mjs

const root = new Hono();
// Unauthenticated build marker so a deploy can be verified from outside.
root.get("/brian/__build", (c) => c.text(__BUILD_ID__));
root.get("/__build", (c) => c.text(__BUILD_ID__));
root.route("/brian", inner);
root.route("/", inner);

Deno.serve(root.fetch);
