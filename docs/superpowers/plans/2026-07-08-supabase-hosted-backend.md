# Supabase-Hosted Backend (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve Brian's REST API + `POST /mcp` from a Supabase Edge Function so no local server is required in production, with the MCP stdio server staying local.

**Architecture:** Port the ~350-line Fastify HTTP layer to Hono (`buildApp()` returns a Hono app that runs on Node locally, in tests via `app.request()`, and on Deno via `Deno.serve(app.fetch)`). MCP Streamable HTTP moves to `@hono/mcp`'s fetch-native transport, same stateless server-per-request model. The deploy artifact is an esbuild single-file bundle at `supabase/functions/brian/index.ts` — Deno never resolves our Node-style imports. Repos/services/db layer unchanged.

**Tech Stack:** hono ^4.12, @hono/node-server ^2, @hono/mcp ^0.3, @modelcontextprotocol/sdk ^1.25.1 (bump), esbuild ^0.28 (dev), Supabase Edge Functions (Deno 2), pg over Supabase pooler.

## Global Constraints

- LLM provider is OpenAI only; generative calls use Structured Outputs (spec + Nextstep hard conventions). No Anthropic API.
- Migrations must stay convergent; no DB schema change in this phase.
- Tests hit the real Supabase DB but only the `test` schema; run with `cd server && set -a && . ./.env && set +a && npm test`.
- Agent-facing client-machine scripts stay zero-dep ESM `.mjs`, fail-silent.
- Behavior parity: every route keeps its path, status codes, payloads, and auth/tenant semantics exactly as in `server/src/api/app.ts` @ 96f71c7.
- Commit policy (Brian skill "Github Commiting"): commit at feature-milestone granularity with descriptions; no routine noise commits.

---

### Task 1: Dependencies + fetch-style test helper

**Files:**
- Modify: `server/package.json`
- Create: `server/src/test/http.ts`
- Test: `server/src/test/http.test.ts`

**Interfaces:**
- Produces: `inject(app: Hono, opts: { method: string; url: string; payload?: unknown; headers?: Record<string,string> }): Promise<{ statusCode: number; body: string; json<T=any>(): T }>` — used by every ported test file.

- [ ] **Step 1: Install deps**

```bash
cd server && npm i hono @hono/node-server @hono/mcp && npm i @modelcontextprotocol/sdk@^1.25.1 && npm i -D esbuild
```

- [ ] **Step 2: Write failing test for the helper**

```ts
// server/src/test/http.test.ts
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { inject } from "./http.js";

describe("inject helper", () => {
  it("posts JSON and reads JSON", async () => {
    const app = new Hono();
    app.post("/echo", async (c) => c.json(await c.req.json(), 201));
    const res = await inject(app, { method: "POST", url: "/echo", payload: { a: 1 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().a).toBe(1);
  });
});
```

- [ ] **Step 3: Implement**

```ts
// server/src/test/http.ts — Fastify-inject-shaped wrapper over Hono's fetch
// interface, so ported tests keep their shape.
import type { Hono } from "hono";

export interface InjectOpts {
  method: string;
  url: string;
  payload?: unknown;
  headers?: Record<string, string>;
}

export async function inject(app: Hono, opts: InjectOpts) {
  const headers = new Headers(opts.headers ?? {});
  let body: string | undefined;
  if (opts.payload !== undefined) {
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    body = typeof opts.payload === "string" ? opts.payload : JSON.stringify(opts.payload);
  }
  const res = await app.request(opts.url, { method: opts.method, headers, body });
  const text = await res.text();
  return { statusCode: res.status, body: text, json: <T = any>(): T => JSON.parse(text) as T };
}
```

- [ ] **Step 4: Run** `npx vitest run src/test/http.test.ts` → PASS.

### Task 2: Port `buildApp()` to Hono — guard, auth routes, error mapping

**Files:**
- Rewrite: `server/src/api/app.ts` (same exports: `buildApp`, `AppOptions`)
- Modify tests to the helper: `server/src/api/app.test.ts`, `server/src/api/auth.test.ts`, `server/src/api/authRoutes.test.ts`

**Interfaces:**
- Produces: `buildApp(opts: AppOptions = {}): Hono` — `AppOptions` unchanged (`authToken`, `jwtSecret`, `llm`, `sync`). No `app.ready()`/`app.close()` lifecycle (Hono has none); tests drop those calls.

Key mechanics (the rest of the routes are 1:1 translations):

```ts
import { Hono } from "hono";
import type { Context, Next } from "hono";

// Tenant binding: ALS around downstream. Hono middleware is promise-based,
// so als.run can wrap next() directly — no Fastify done() dance.
app.use("*", async (c: Context, next: Next) => {
  if (!authToken && !jwtSecret) return next();
  const path = new URL(c.req.url).pathname;
  if (PUBLIC_PATHS.has(path)) return next();
  const header = c.req.header("authorization");
  if (authToken && bearerMatches(header, authToken)) {
    return runTenant(FOUNDING_TENANT_ID, () => next());
  }
  if (header?.startsWith("Bearer ")) {
    const raw = header.slice("Bearer ".length);
    const tenantId = await tenantForToken(raw).catch(() => null);
    if (tenantId) return runTenant(tenantId, () => next());
    if (jwtSecret) {
      const u = verifyUserToken(raw, jwtSecret);
      if (u) { c.set("user", u); return runTenant(FOUNDING_TENANT_ID, () => next()); }
    }
  }
  return c.json({ error: "unauthorized" }, 401);
});

// Error mapping (was setErrorHandler)
app.onError((err, c) => {
  if (err instanceof ValidationError) return c.json({ error: err.issues.join("; ") }, 400);
  if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
  return c.json({ error: "internal error" }, 500);
});
```

- `bearerMatches` keeps `timingSafeEqual` via `node:crypto` (works on Deno).
- `req.user` becomes Hono context var: `type Vars = { user?: TokenUser }`, `new Hono<{ Variables: Vars }>()`; handlers read `c.get("user")`.
- Route translation pattern: `app.get("/api/skills/:id", async (c) => { const s = await getSkill(c.req.param("id")); if (!s) return c.json({ error: "skill not found" }, 404); return c.json(s); })`. Query: `c.req.query("status")`. Body: `await c.req.json().catch(() => ({}))` where Fastify tolerated empty bodies.

- [ ] Port guard + `/api/auth/login` + `/api/auth/me` + error handler + skills routes; adapt the three test files (drop `ready/close`, use `inject`).
- [ ] Run: `npx vitest run src/api/app.test.ts src/api/auth.test.ts src/api/authRoutes.test.ts` → PASS.

### Task 3: Port remaining REST routes

**Files:**
- Modify: `server/src/api/app.ts`
- Modify tests: `server/src/api/contextApi.test.ts`, `server/src/api/interviewApi.test.ts`, `server/src/api/connectorsApi.test.ts`, `server/src/api/agentBriefing.test.ts`, `server/src/api/tenancy.test.ts`

Route inventory to port 1:1 (paths/codes/payloads identical): executions, evidence, briefing (0.6 cutoff), draft-from-text, capture, ingest/bulk, context CRUD+versions+retire, interviews (create/list/get/messages/approve/abandon/resume), connectors (list redacted / connect / disable / sync with 400-on-throw).

- [ ] Port routes; adapt tests; run the five files → PASS.

### Task 4: MCP `/mcp` over `@hono/mcp`

**Files:**
- Rewrite: `server/src/mcp/http.ts`
- Modify test: `server/src/mcp/http.test.ts` (same three cases: initialize 200 + serverInfo "brian"; GET 405; 401 with auth on)

```ts
// server/src/mcp/http.ts
import type { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { buildMcpServer } from "./server.js";

// Stateless: fresh server + transport per request (same model as before).
export function registerMcpHttp(app: Hono): void {
  app.post("/mcp", async (c) => {
    const server = buildMcpServer();
    const transport = new StreamableHTTPTransport();
    await server.connect(transport);
    return transport.handleRequest(c);
  });
  const notAllowed = (c: any) =>
    c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Use POST (stateless mode)." }, id: null }, 405);
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
```

- [ ] Port + adapt test; run `src/mcp/http.test.ts` + `src/api/tenancy.test.ts` → PASS.

### Task 5: Node entry on @hono/node-server; remove Fastify; full suite; commit

**Files:**
- Modify: `server/src/api/index.ts` (replace `.listen(...)` with `serve({ fetch: app.fetch, port })` from `@hono/node-server`; keep env self-load + founding-token seeding)
- Modify: `server/package.json` (drop `fastify`)

- [ ] `grep -r "fastify" server/src` → no hits; `npm test` full suite → 202/202 equivalent (208+ with new helper tests).
- [ ] Local smoke: `npm run api` + `curl -s -H "Authorization: Bearer $BRIAN_API_TOKEN" localhost:3001/api/skills` → 200 JSON; MCP initialize via curl → 200.
- [ ] Commit: `feat(api): port HTTP layer Fastify→Hono (Node+Deno portable), MCP via fetch-native transport`

### Task 6: Edge entry + esbuild bundle

**Files:**
- Create: `server/src/edge/entry.ts`
- Create: `server/scripts/edge-build.mjs`; npm script `edge:build`
- Create: `supabase/config.toml` (`[functions.brian] verify_jwt = false`) if the CLI is used; otherwise set at deploy time.

```ts
// server/src/edge/entry.ts — Supabase Edge Function entry (bundled by esbuild).
// Paths arrive as /brian/api/* when invoked at /functions/v1/brian/*; also
// tolerate /functions/v1 prefix so both invocation URLs work.
import { Hono } from "hono";
import { buildApp } from "../api/app.js";

const inner = buildApp({
  authToken: Deno.env.get("BRIAN_API_TOKEN") ?? null,
  jwtSecret: Deno.env.get("AUTH_JWT_SECRET") ?? null,
});
const root = new Hono();
root.route("/brian", inner);            // functions.supabase.co/brian/...
root.route("/functions/v1/brian", inner); // supabase.co/functions/v1/brian/...
Deno.serve(root.fetch);
```

(`Deno` global: declare via `declare const Deno: any;` in the entry — it is compiled by esbuild, not tsc-node. Env reading must go through `Deno.env.get` because `process.env` on the edge runtime is partial; alternatively rely on Deno 2's `process.env` node-compat — verify in Task 7 smoke. `src/env.ts` loading of `server/.env` is Node-only and NOT imported here; secrets come from the platform.)

```js
// server/scripts/edge-build.mjs
import { build } from "esbuild";
await build({
  entryPoints: ["src/edge/entry.ts"],
  bundle: true,
  format: "esm",
  platform: "node",           // resolve npm deps Node-style; Deno provides node:* builtins
  external: ["node:*", "pg-native"],
  outfile: "../supabase/functions/brian/index.ts",
  banner: { js: "// AUTO-GENERATED by npm run edge:build — do not edit." },
});
console.log("bundled → supabase/functions/brian/index.ts");
```

- [ ] `npm run edge:build` succeeds; grep bundle for `require("pg-native")` guarded, no bare unbundled imports besides `node:*`.
- [ ] If `deno` is installed locally: `deno check`/`deno run --allow-net --allow-env` smoke; else defer to deployed smoke.

### Task 7: Deploy + secrets + live smoke

- [ ] Secrets on project `foydcrwyakpkisxtvzgr`: `DATABASE_URL` (session/transaction pooler URL), `OPENAI_API_KEY`, `LLM_MODEL`, `BRIAN_API_TOKEN`, `AUTH_JWT_SECRET` — via `supabase secrets set` (CLI) or dashboard; note edge runtime auto-provides `SUPABASE_DB_URL` (direct, IPv6 — prefer our pooler URL).
- [ ] Deploy via Supabase MCP `deploy_edge_function` (name `brian`, `verify_jwt=false`) with the bundled file.
- [ ] Smoke (live): REST `GET <base>/api/skills` with bearer → 200 with the seeded skills; MCP `initialize` then `tools/call find_skill {"query":"customer wants a refund"}` → returns the active "Customer inquiry reply"/refund skill; briefing endpoint POST → 200. Verify pooler+HNSW sanity (non-empty result — the ivfflat lesson).
- [ ] Commit: `feat(edge): Supabase Edge Function hosting for /api + /mcp (bundled Hono app)`

### Task 8: Repoint clients + docs + Nextstep

**Files:**
- Modify: `server/scripts/onboard/*` (default `--url` → hosted base when provided; docs examples), `server/scripts/hooks/brian-hook.mjs` + hooks installer (briefing URL from env/settings, default stays local dev, document hosted value), `docs/onboard.md`, `docs/agent-contract.md`, `docs/connectors.md` (sync via hosted endpoint), `Nextstep.md` (phase breakdown + status), root README if it references `npm run api`.
- Dashboard: CRA proxy stays for dev; production build gets `REACT_APP_API_BASE` or a Vercel rewrite (`/api/*` → edge URL) — config only, no component change.

- [ ] stdio MCP explicitly untouched (founder requirement) — verify `.mcp.json` still points at local stdio and works.
- [ ] Full suite green; commit: `feat(hosting): clients point at Supabase-hosted backend; docs + Nextstep phases`

## Self-review notes

- Spec coverage: framework port (T2–5), MCP transport (T4), bundle (T6), deploy+secrets+smoke (T7), repoint+docs (T8), stdio-stays-local (T8 check). Phases 2–4 are separate plans by design.
- Types: `buildApp(): Hono<{ Variables: { user?: TokenUser } }>`; `inject` consumes any Hono app.
- Open risk carried from spec: `@hono/mcp` peer `hono-rate-limiter` (unused feature) may just warn on install; if npm hard-fails, add it as a dev dep no-op.
