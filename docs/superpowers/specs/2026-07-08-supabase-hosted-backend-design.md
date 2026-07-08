# Supabase-hosted backend — design

> Founder mandate (2026-07-08): **fully migrate the backend to Supabase** —
> no local server required for production use — **while keeping the MCP stdio
> server local**. This spec is the design for that migration plus the phase
> breakdown to YC readiness. Companion docs: `SupabaseIntegration.md`
> (multi-tenant target, §8 rollout), `Nextstep.md` (state).

## Where this starts from

- DB is already Supabase (project `brian`, ref `foydcrwyakpkisxtvzgr`,
  migrations 001–006 applied). What is *not* hosted is the HTTP surface:
  Fastify REST API + `POST /mcp` Streamable HTTP run on the founder's machine
  (`npm run api`). Hooks/briefing and any remote agent depend on that process
  being up.
- Multi-tenancy Phase 1 is merged to `main` (tenant context via
  AsyncLocalStorage, token→tenant guard, per-tenant repos). RLS is enabled but
  policy-less (owner connection bypasses it) — Phase 2 of
  `SupabaseIntegration.md` makes it real.

## Decision: how the backend runs on Supabase

Supabase hosts arbitrary HTTP via **Edge Functions** (Deno 2 runtime,
fetch-API handlers). Fastify is Node-server-coupled; porting the ~350-line
HTTP layer beats emulating Node's http stack inside Deno.

1. **HTTP framework: Hono.** One `buildApp()` (routes, guard, error mapping
   identical to today) that runs everywhere: locally on Node via
   `@hono/node-server` (`npm run api` keeps working, dev unchanged), in tests
   via `app.request()` (fetch-native, no listener), and on Supabase Edge
   Functions via `Deno.serve(app.fetch)`. Fastify is removed, not kept in
   parallel — two HTTP layers is drift.
2. **MCP over HTTP: fetch-native transport.** Replace
   `StreamableHTTPServerTransport` (Node req/res) with `@hono/mcp`'s
   `StreamableHTTPTransport` (Web Request/Response). Same stateless
   fresh-server-per-request model as today.
3. **Deploy artifact: esbuild bundle.** The shared `server/src` code uses
   Node-style ESM (`./foo.js` relative specifiers, bare npm names) that Deno
   does not resolve natively. Rather than fight resolution (import maps +
   sloppy-imports), `npm run edge:build` bundles
   `server/src/edge/entry.ts` → `supabase/functions/brian/index.ts` — a
   single self-contained file (`node:*` builtins stay external; Deno provides
   them; `pg-native` marked external — optional dep never loaded). Deployed
   via the Supabase MCP `deploy_edge_function` (or CLI).
4. **One fat function, named `brian`.** Routes keep their paths under the
   function base: `…/functions/v1/brian/api/*` and `…/functions/v1/brian/mcp`.
   Every client already takes a base URL (`onboard --url`, hooks, dashboard),
   so this is config, not code. Platform JWT verification is **off** for this
   function (`verify_jwt = false`) — auth is our own bearer/JWT guard, same
   code as today.
5. **DB from the edge: keep `pg`, connect via the Supabase pooler**
   (transaction pooler; small per-instance pool). `AsyncLocalStorage`
   (`node:async_hooks`) is supported on the Edge runtime, so the tenant
   context works unchanged. Phase 2's `SET LOCAL app.tenant_id` wraps each
   request in a transaction, which the transaction pooler supports.
6. **Secrets** via `supabase secrets set`: `DATABASE_URL` (pooler),
   `OPENAI_API_KEY`, `LLM_MODEL`, `BRIAN_API_TOKEN`, `AUTH_JWT_SECRET`.
7. **What stays local (by design):** the stdio MCP server (`npm run mcp`) for
   dev machines and self-hosted single-tenant use (founder requirement);
   `npm run api` as the local dev loop; CLIs (review, sync, bench, onboard).
   Everything a *client machine* needs in production points at the hosted URL.

## Phase breakdown to YC-ready

- **Phase 1 — Hosted backend (this spec's core).**
  1a. Port Fastify → Hono, all tests green locally (TDD, same behavior).
  1b. Edge entry + bundle + deploy + secrets; live smoke: REST list skills and
      MCP `initialize`/`find_skill` against the hosted URL with a bearer.
  1c. Repoint clients: onboard installer default URL, hooks briefing URL,
      dashboard API base, docs. stdio MCP untouched.
- **Phase 2 — RLS for real** (`SupabaseIntegration.md` §7): non-owner
  `brian_app` role, per-request `SET LOCAL app.tenant_id` inside `db()`,
  `tenant_isolation` policies on every tenant table, cross-tenant leak tests.
  Was "optional until external clients" — a publicly reachable API makes it
  mandatory now.
- **Phase 3 — Supabase Auth swap** (§5a): dashboard humans log in via
  Supabase Auth (invites, reset, MFA for free), guard verifies Supabase JWT
  claims (`tenant_id`, `role` in `app_metadata`), bcrypt path deleted.
  Plus the "Agents & tokens" admin page (mint/label/revoke `api_tokens`).
- **Phase 4 — YC polish.** Frontend (dashboard + landing) deployed (Vercel,
  `/api/*` rewrite → edge function so the CRA code stays relative-path);
  one-command demo: `npm run onboard -- --url <hosted> --token <minted>` on a
  clean machine → agent uses the hosted brain. Founder-gated items surfaced:
  Gmail/Slack connector credentials, rotate the OpenAI key, encrypt
  `connectors.credentials`.

## Non-goals

- Rewriting repos/services — they are framework-agnostic and stay as-is.
- Supabase client-side keys in the dashboard — all data access stays behind
  our API (one authorization path; `SupabaseIntegration.md` §7).
- Schedulers/daemons for connectors; graph anything; per-tenant vector
  tables (all previously decided anti-goals stand).

## Risks / verification

- **Deno compat of bundled deps** (`pg`, `jsonwebtoken`, `bcryptjs`,
  `openai`, MCP SDK server core): verified by the live smoke in 1b before
  anything is repointed. Fallback if a dep is edge-hostile: swap that dep
  (e.g. `jose` for `jsonwebtoken`), not the architecture.
- **Function path prefix**: all clients take base URLs; the dashboard gets a
  Vercel rewrite; verified in 1c.
- **Pooler + HNSW**: no index change, so no bench gate; still run one
  `find_skill` smoke over the pooler connection (the ivfflat lesson).
- **Cold starts**: fine for agent calls (sub-second after first hit);
  briefing hook is fail-silent by design if latency spikes.
