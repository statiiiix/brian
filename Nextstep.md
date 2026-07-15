# Brian — Next Steps

> Context-preservation doc. Snapshot of where the Company Brain backend stands and
> what to do next, so we can resume without re-deriving anything.
> Last updated: 2026-07-15.

---

## Current milestone override — public signup, MCP OAuth, and CLI

> Updated 2026-07-13. This section supersedes older static-token and "not built yet" statements later in this historical snapshot.

Implemented in the working tree:

- migrations 010-016 for identity/provisioning/OAuth claims, legacy-token retirement, privacy deletion/retention, narrow security-definer resolvers, the Supabase custom access-token hook, and request-time guarded MCP release flags;
- fail-closed Supabase dashboard identity, separate MCP JWT/JWKS/resource/grant validation, RFC 9728 discovery/challenge, per-tool permissions, and immediate Brian-side revocation;
- PKCE Supabase browser sessions, signup/confirmation/recovery/reset, safe continuations, email-bound invitation preflight/acceptance, durable onboarding, verified OAuth consent, and Settings → Agents & connections;
- account/company deletion UI and APIs, a 30-day grace workflow with immediate credential revocation, owner-only due-deletion processing, and bounded 365/180-day audit/execution retention defaults;
- publishable `packages/cli` with URL-only Claude Code, Cursor, and Codex adapters, account-level Claude Desktop custom-connector guidance and legacy cleanup, plus signup/connect/status/doctor/disconnect, private last-health state, backups, refusal safety, and fixture tests;
- guarded universal MCP connection work: explicit server-authoritative Brian permissions, native post-configuration login orchestration, doctor readiness labels, a pinned Supabase OAuth Admin adapter, count-only DCR audit, fail-closed stale cleanup with read-only schema attestation, scheduled hygiene, alert thresholds, and a kill-switch runbook;
- pinned CI across web/server and Node 22/24/26 Linux plus macOS arm64/x64 tarball installs, with deterministic Edge generation and drift enforcement;
- architecture, security, operations, privacy, signup, OAuth, compatibility, CLI, migration, incident, legacy-token, backup, and retention documentation.

Verified locally so far:

- **2026-07-15 real Codex production E2E:** Codex dynamically registered with
  Supabase, opened Brian's browser consent, authenticated the founder, approved
  the default closed permission set for tenant `sokoon`, and completed an actual
  `find_skill` MCP call from a fresh process using the saved OAuth session. The
  active Brian connection was then revoked and the same saved credential was
  rejected with `invalid_token` before MCP initialization, proving immediate
  Brian-side denial. A final reconnect was started so the user's client is not
  intentionally left revoked. Forced access-token expiry and refresh rotation
  remain untested and must not be marked passed.
- Production Edge `brian` version 13 is ACTIVE. It includes Edge-compatible
  Supabase publishable-key resolution and a fail-closed compatibility path for
  an older cached consent page that omitted the permissions field: omission
  receives only Brian's three closed defaults, while null, malformed, duplicate,
  or unknown permissions still fail. The production tenant display name is now
  exactly `sokoon`.
- **2026-07-15 post-fix verification:** CLI 54/54 tests pass; server TypeScript
  build passes; 44 runnable server files / 211 tests pass and 43 database-backed
  files / 193 tests skip without isolated test-database credentials; the Edge
  bundle regenerates successfully; and the credential-free production OAuth/DCR
  discovery smoke passes.
- **2026-07-15 npm releases:** npm organization `brianthebrain` was created with
  the founder as owner and publishing 2FA enabled. The initial
  `@brianthebrain/cli@0.1.0` release was followed by `0.1.1`, which fixes Claude
  Desktop setup: remote connectors are account-level and must not be written to
  `claude_desktop_config.json`. The upgrade safely removes only an obsolete
  local Brian entry, preserves unrelated local servers/settings, and directs the
  user to Claude's custom connector UI. A fresh-cache public-registry `npx`
  execution returns `0.1.1`, and the founder's global `brian` command is updated
  to `0.1.1`.
- **2026-07-15 Claude Desktop diagnosis:** the desktop startup modal was
  reproduced in `main.log`; Claude rejected the former `{ type: "http", url }`
  file entry before any network request. That entry is removed from the
  founder's live config with a timestamped backup, and restart no longer has
  that invalid configuration source. The remaining proof is manual creation of
  the account-level Brian connector at `https://claude.ai/customize/connectors`,
  followed by browser consent and an authenticated MCP tool call. Browser
  automation cannot access `claude.ai` under the active enterprise network
  policy, so this final UI action remains a founder handoff rather than a passed
  E2E result.

- **2026-07-14 guarded-connection release verification:** frontend 9 suites,
  51/51 tests, and the production build pass; CLI 51/51 tests, syntax check,
  package dry-run, clean-prefix tarball install, version, URL-only dry-run, and
  credential-free doctor output pass; the regenerated Edge bundle is
  deterministic across consecutive builds (SHA-256
  `661add722cace59f7011b43bd0d4f55babdb65fbb3baf871a968313cfe575f62`).
- server TypeScript build and 44 non-database files / 208 tests pass, including
  the localhost hook suite; 43 DB-backed files / 193 tests skip in this
  worktree because `TEST_DATABASE_URL` and `APP_TEST_DATABASE_URL` are not
  available. Do not reinterpret that skip as a new DB proof; the last complete
  isolated-DB evidence remains the dated 363/363 run below;
- **2026-07-13 (founder machine): the complete DB-backed suite is green — 81 files, 363/363 tests — against the isolated test schema on the live Supabase host, including migrations 010–014, RLS leak (as `brian_app` via `APP_TEST_DATABASE_URL`), identity, tenancy, and privacy suites.** Three defects were found and fixed on first real execution of the previously unrun 014 slice:
  1. **Migration 014 (real production bug):** the `data_deletion_requests` actor/scope CHECK used strict `target is not distinct from requested_by`, but the two `on delete set null` FK actions fire as separate statements during auth-user deletion, so the transient one-null state violated the check and aborted the account deletion itself. Replaced with a null-tolerant named constraint `data_deletion_requests_actor_scope_check` plus a convergent fixup that drops the stale anonymous check; strict target=requester equality remains enforced by `request_data_deletion` at insert time.
  2. `migrate014.test.ts` referenced only `$1`/`$3` in the api_tokens seed while passing 3 params (unreferenced `$2` is untypable); second row now correctly uses tenant B.
  3. `authRoutes.test.ts` predated fail-closed memberships: a legacy JWT is honored only when its user id has an active membership, so the test now seeds the founding membership (mirroring the trusted backfill) instead of expecting an unmembered 200.
- CLI test suite (51/51 on Node 24), syntax check, package dry run, and native-login orchestration fixtures;
- DCR registry/CLI/workflow/probe suites: 34 focused tests, with Supabase-owned Admin-host pinning and credential preflight, retrying ambiguous-response recovery cleanup across network/5xx/malformed/missing-ID outcomes, redaction, nonzero failure/drift status, per-client lifecycle and paused-window rechecks, a secret-free read-only hourly audit, manual protected cleanup restricted to a fully paused window, and cleanup-after-registration coverage; server TypeScript build passes;
- deterministic generated Edge bundle build and drift check (rebuilt 2026-07-13 from current source).
- **2026-07-14 registration-boundary probe:** the credential-free production
  OAuth smoke passed again. An isolated Codex CLI 0.144.2 login reached Brian's
  discovery metadata and failed only at Supabase DCR with
  `Dynamic client registration not supported`. A local control server proved
  Codex can instead use a pre-registered public client ID with PKCE S256,
  `email`, the exact Brian resource, and stable callback
  `http://127.0.0.1:1455/callback/YL4-rwMAP0YR` when callback port 1455 is pinned.
  Live read-only checks found zero `auth.oauth_clients`, zero
  `agent_connections`, and no release-flag rows in `app_config`, so the
  fail-closed defaults remain active. The safest first real-client proof is now
  concrete: manually register this Codex client, configure its public client ID,
  enable new OAuth approvals for the controlled test, then run consent, an MCP
  tool call, refresh, and revocation. Open DCR is not required for this proof.
- **2026-07-14 guarded DCR enablement:** the founder explicitly chose the
  universal-registration path. Supabase Authentication → OAuth Server → Allow
  Dynamic OAuth Apps was enabled and saved successfully. Production discovery
  now advertises a valid `registration_endpoint`. The extended public smoke
  intentionally stops at the next deployment gate because the live Brian Edge
  bundle predates the new `mcpOAuth`, `mcpOAuthApprovals`, and `mcpDcr` public
  markers. No disposable client was created: the controlled probe will not run
  until `SUPABASE_SECRET_KEY` is available so Admin-API deletion is guaranteed.

Applied to live production on 2026-07-13/14 (founder explicitly approved in-session):

- **guarded control rollout advanced on 2026-07-14:** migration 016 is applied;
  explicit `false` rows now exist for `MCP_DCR_ENABLED`,
  `MCP_OAUTH_APPROVALS_ENABLED`, and `PUBLIC_SIGNUP_ENABLED`; function privileges
  are verified as execute=true only for `brian_app` and false for `anon` and
  `authenticated`. Edge `brian` version 9 is ACTIVE with `verify_jwt=false`,
  direct build marker `426539cd9d66b208`, and the branded credential-free OAuth
  smoke passes. Public config returns OAuth enabled with signup, DCR marker, and
  approvals all paused. The reviewed Vercel web/consent artifact is not yet
  deployed because the external code upload requires explicit founder approval;
- the disposable registration probe remains intentionally unrun: no
  `SUPABASE_SECRET_KEY` or maintenance database credential exists in the local
  environment, so Admin-API cleanup cannot yet be guaranteed. Do not create a
  disposable client until that server-only authority is provisioned;
- **migrations 010–016 are applied to the live Supabase project** via the Supabase MCP. Two earlier live-only defects surfaced and were fixed convergently in the repo files:
  1. `citext` had been installed into the isolated `test` schema by earlier test runs, so migration 010's unqualified `citext` column type failed on live `public`. 010 now resolves the installed extension's actual schema (`pg_extension`/`pg_namespace`) and qualifies the type.
  2. Supabase default privileges grant EXECUTE on new public-schema functions directly to `anon`/`authenticated`; `revoke ... from public` does not remove those direct grants. Seven SECURITY DEFINER resolvers/trigger functions from 012/014 were therefore RPC-callable (they still failed closed internally on the `app.user_id` binding, but violated default-deny). 012/014 now revoke `anon`/`authenticated` explicitly, and live migration `015_function_execute_hardening` applied the same revokes; the security advisor WARNs are cleared.
- **the founding owner membership is provisioned on live**: the founder's auth user received trusted `app_metadata` (`brian_tenant_id` founding tenant + `brian_role` owner), which fired the migration-011 trigger — active default owner membership, onboarding_state row, and `membership.provisioned_trusted` audit event all verified. `identity_membership_report` flags exactly one remaining row: the second auth user with zero memberships (fail-closed by design; founder to review/delete);
- **the current Edge Function bundle is deployed and verified on live (2026-07-14):** `brian` version 9 is ACTIVE with `verify_jwt=false` so public OAuth discovery can reach Brian's own JWT/resource/grant validation. The direct live `/__build` endpoint returns `426539cd9d66b208`. The credential-free `npm run smoke:mcp-oauth` release smoke passes protected-resource metadata, Supabase authorization-server discovery, PKCE S256 advertisement, the authorization route, and the unauthenticated `/mcp` 401 `WWW-Authenticate` challenge. Authenticated token-binding and `tools/list` checks were skipped because no `MCP_SMOKE_ACCESS_TOKEN` was supplied;
- remaining security advisors after hardening: `vector` extension in public (known, low priority), owner-only `app_config` with RLS and no policies (intentional), and Auth leaked-password protection disabled (founder dashboard toggle).

Remaining release gates / not yet claimed complete externally:

- production still needs a verified non-owner `brian_app` runtime credential, deployment of the guarded DCR/approval markers and maintenance workflow secrets, signup rate-limit configuration, and Turnstile;
- `api.brianthebrain.app` is attached to the Vercel `brian` project, the branded proxy is reachable, and the current credential-free public OAuth/MCP release smoke passes. Public signup remains server-side disabled with an explicit `PUBLIC_SIGNUP_ENABLED=false` row;
- **Supabase OAuth dashboard setup completed and verified 2026-07-14:** OAuth 2.1 is enabled; Site URL is `https://brianthebrain.app`; Authorization Path is `/oauth/consent`; exact web callback `https://brianthebrain.app/auth/callback` is allowlisted; `public.custom_access_token_hook` is enabled as the Postgres custom access-token hook with execute restricted to `supabase_auth_admin`; authorization-server discovery now returns HTTP 200 with authorization/token/JWKS/DCR endpoints and PKCE S256. Dynamic OAuth app registration is enabled under the guarded rollout decision above;
- DCR, RFC 8707 resource binding, browser authentication, a tenant-scoped tool call, saved-session reuse, and Brian-side revocation are proven for Codex. Forced refresh rotation, the disposable registration-cleanup probe, and other client families still need dated proof;
- 2026-07-14 release reviews blocked two unsafe guarded artifacts, then cleared the corrected branch at `0a19304` with no remaining Critical or Important findings. The branch pins Admin calls to a Supabase-owned HTTPS origin, recovers and deletes ambiguous probe registrations by a unique marker, makes the hourly audit DB-only and secret-free, confines Admin deletion to a manually approved fully paused window, rechecks lifecycle evidence per client, distinguishes unknown marker evidence from real drift, and drives request-time flags through migration 016's boolean-only function. Migration 016 and Edge are live; the web artifact, maintenance authority, and real-client proofs remain gated;
- Claude Code and Claude Desktop surfaces were inspected, but neither has a completed authenticated Brian E2E row yet. Codex has the dated production E2E described above;
- reviewed legal pages/subprocessors, production monitoring and alert delivery, a dated backup/restore exercise, the selected deep security scan in a fresh Codex session, remaining license/release-policy decisions, and deployment remain release actions. The npm scope and initial CLI publication are complete.

Keep public signup disabled and do not call the feature GA until those gates pass. The authoritative implementation plan is `docs/superpowers/plans/2026-07-12-public-signup-mcp-oauth-cli.md`; operational detail is linked from the root README.

---

## Where we are now (done)

A working **Company Brain backend** lives in `server/` (standalone Node/TS, Fastify,
pg, pgvector). The repo root is a separate Create-React-App UI the founder owns.

- **v1 engine (M0–M5):** skills schema + pgvector, skill repo with version history,
  `find_skill` semantic retrieval, MCP execution server with mock business tools, the
  end-to-end execution loop (retrieve → read guardrails → act or escalate → log),
  REST API, execution logging, staleness detection, `draft-from-text` ingestion.
- **v2 Knowledge Capture:** second knowledge type **context** (goals/decisions/prefs);
  `capture(text)` that classifies each item skill-vs-context and routes it
  (create or update); **graduated autonomy** (context always active; skills auto-active
  only when confident AND all tools are reversible/safe, else draft); tool-risk
  registry; bulk ingestion; MCP `capture` + `find_context` tools.
- **Roadmap-to-done (2026-07-01):** the four next-steps below are BUILT
  (spec: `docs/superpowers/specs/2026-07-01-brian-roadmap-to-done-design.md`):
  1. **MCP wired into Claude** — repo `.mcp.json` (Claude Code) + `mcpServers.brian`
     in the Claude Desktop config; the stdio entry self-loads `server/.env`
     (`src/env.ts`), so it works when launched by any client.
  2. **Draft review surface** — `npm run review -- [list|show|approve|reject]`
     (`src/review/`). Proven live: the "Customer inquiry reply" skill went
     draft → approved → active through it.
  3. **Real business tool: Gmail** — adapter registry (`src/mcp/adapters.ts`),
     Gmail client (`src/gmail/client.ts`, plain fetch + OAuth refresh token),
     tools `create_email_draft` (risk: safe) / `send_email` (risk: destructive),
     one-time `npm run gmail:auth` helper, setup guide `docs/gmail-setup.md`,
     live smoke `src/scripts/gmailSmoke.ts`.
  4. **HTTP transport + auth + agent contract** — MCP Streamable HTTP at
     `POST /mcp` inside the Fastify app (stateless), bearer-token auth
     (`BRIAN_API_TOKEN`) on `/api/*` and `/mcp`, new `log_execution` MCP tool,
     and the system-prompt contract in `docs/agent-contract.md`.
     **Cloud deploy deliberately deferred** — runs locally until a real external
     agent needs it.
- **Brian-bench Phase 1 (2026-07-02):** retrieval benchmark at scale
  (`npm run bench`, spec `docs/superpowers/specs/2026-07-02-brian-bench-design.md`).
  120 skills drafted from real GitLab-handbook pages in an isolated `bench` schema;
  120 labeled queries. **Result: 85.0% top-1 / 91.7% top-3**
  (`docs/bench/2026-07-02-retrieval.md`). The bench exposed a real production bug —
  ivfflat embedding indexes trained on empty tables silently returned empty/partial
  results at 100+ rows (first run scored 12.5%) — fixed by migration `003_hnsw.sql`
  (HNSW), applied to live. New repo fn `findSkillsWithDistance` (top-k).
  Phases 2–3 (500-task inbox marathon w/ adversarial slice; learning curve) are
  specced in the design doc, not built.
- **LLM:** OpenAI only (no Claude). Embeddings `text-embedding-3-small` (1536);
  generative `gpt-5.4-mini` via `LLM_MODEL`, using **Structured Outputs** (strict
  `json_schema`) because it's a reasoning model.
- **Status:** 204/204 tests pass on the live DB (as of 2026-07-08). Multi-tenancy
  Phase 1 + connectors + interview resume are **merged to `main`** (96f71c7).
  Newest work (Supabase-hosted backend) is on branch `supabase-hosted-backend`.

### Environment / infra facts (don't re-derive)
- Supabase project **brian**, ref `foydcrwyakpkisxtvzgr` (Postgres 17 + pgvector).
  Migrations through **009 are applied to live prod** (via the Supabase MCP):
  001–004 base, 005 tenancy, 006 connectors, 007 rls-backstop, 008 app_config,
  009 oauth_states (**009 applied 2026-07-12** — it had silently been missing on
  live; 006 shipped connectors+evidence but 009's `oauth_states` never ran, so the
  OAuth authorize flow would have 500'd). **RLS is now enabled on every
  owned table** (context_entries/context_versions got it 2026-07-06, closing the
  last `rls_disabled_in_public` advisor); the backend connects as the `postgres`
  owner, which bypasses RLS, so RLS is currently a latent backstop (see step 4).
  Only remaining advisor is a low-priority `vector`-extension-in-public WARN.
- DB access via the **session pooler** in gitignored `server/.env` (direct connection
  is IPv6-only and fails on the IPv4 network).
- **Tests run in a dedicated `test` schema** (`TEST_DATABASE_URL` has
  `?options=-c search_path=test,public`); they never touch live `public`. Live
  `public` holds 2 seeded skills + the active "Customer inquiry reply" skill.
- Run DB tests: `cd server && set -a && . ./.env && set +a && npm test`.
- `server/.env` vars: `DATABASE_URL`, `TEST_DATABASE_URL`, `OPENAI_API_KEY`,
  `LLM_MODEL=gpt-5.4-mini`, `BRIAN_API_TOKEN` (bearer for REST + /mcp), and —
  once the founder finishes `docs/gmail-setup.md` — `GMAIL_CLIENT_ID`,
  `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`.
- Consider rotating the OpenAI key (it was shared in chat).

- **Interview mode + dashboard (2026-07-03, branch `interview-mode-dashboard`):**
  spec `docs/superpowers/specs/2026-07-03-interview-mode-dashboard-design.md`.
  Backend: migration `004_users_interviews.sql` (users + interviews, RLS),
  bcrypt+JWT auth (`src/auth/`), dual-mode guard (static `BRIAN_API_TOKEN` **or**
  user JWT on `/api/*` + `/mcp`; `POST /api/auth/login`, `GET /api/auth/me`),
  `npm run seed:admin` (env-driven: `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`AUTH_JWT_SECRET`),
  interview engine (`src/interviews/`, one Structured-Outputs call per turn:
  next question OR finished draft + 7-field coverage map, 25-question cap,
  retry-once on malformed output), REST: `POST/GET /api/interviews`,
  `POST /api/interviews/:id/messages|approve|abandon`. 103/103 tests.
  Frontend: react-router v6 (`/` landing, `/login`, `/app/*` JWT-gated), CRA
  proxy → :3001, nav "Log in" button, dashboard (`src/app/`, one CSS per
  component): Skills list/editor + versions, Review queue (web replacement for
  the CLI), Interviews list + chat with live coverage checklist and
  approve-to-active draft panel, Capture box, Executions log.
  **Verified live end to end:** JWT login → real-LLM interview (2 rich answers →
  faithful draft, zero invented policy) → approve → active → `find_skill`
  retrieves it ("Approve customer discount requests").

- **Always-on invocation (2026-07-04, branch `always-on-invocation`):**
  spec `docs/superpowers/specs/2026-07-04-always-on-invocation-design.md`.
  Fixes "agents only call Brian when asked": (1) the MCP server now sends the
  agent contract as MCP `instructions` at initialize
  (`src/mcp/instructions.ts`) + trigger-rich tool descriptions — raises call
  rates in every MCP client; (2) Claude Code hooks make it deterministic:
  `POST /api/agent/briefing` (one-shot skill+context lookup, 0.6 distance
  cutoff), zero-dep hook `server/scripts/hooks/brian-hook.mjs` (SessionStart →
  contract; UserPromptSubmit → briefing injected; fail-silent if the API is
  down), installer `npm run hooks:install [-- --user]`, repo-level
  `.claude/settings.json`. The hook needs the API running (`npm run api`).

- **Brian onboard — one-command multi-agent installer (2026-07-04, branch
  `brian-onboard`):** spec `docs/superpowers/specs/2026-07-04-brian-onboard-design.md`,
  plan `docs/superpowers/plans/2026-07-04-brian-onboard.md`, usage `docs/onboard.md`.
  `cd server && npm run onboard` detects installed agent platforms, prints a plan,
  and wires each: MCP registration + the strongest always-on layer it supports.
  Zero-dep ESM (`server/scripts/onboard/`): `onboard.mjs` entry + `lib.mjs`
  (JSON deep-merge with timestamped `.bak-brian-*` backup + refuse-on-unparseable,
  marker-block editing, TOML section append, `mcpEntry` stdio/http builders) +
  one adapter per platform behind a `{detect,status,plan,apply}` interface.
  Adapters: **Claude Code** (merge `~/.claude.json` + delegate hooks to the
  shipped `installBrianHooks()` — no duplication), **Claude Desktop**
  (`claude_desktop_config.json`/`mcp.json` merge), **Cursor** (`~/.cursor/mcp.json`
  + contract block in `~/.cursor/AGENTS.md`), plus Tier-B **Codex**
  (`~/.codex/config.toml` section + AGENTS.md) and **OpenClaw** (contract file +
  manual MCP note). Flags: `--status`/`--dry-run`/`--yes`/`--only`/`--url --token`.
  Safety invariants: backup-before-touch, refuse (never rewrite) unparseable
  configs, idempotent (zero-diff re-runs), honest per-layer labels, exit 1 on any
  refusal. 39 new tests (lib/adapters/CLI subprocess vs temp-HOME fixtures).
  **Live-verified on this machine:** Claude Code + Claude Desktop + Cursor all
  wired, backups created, second run reports "already wired". Restart each app to
  load the new MCP server; keep `npm run api` up for the Claude Code hook.

- **Multi-tenancy Phase 1 (2026-07-06, branch `supabase-tenancy`):** one brian
  project serves many client companies via shared tables + `tenant_id` + RLS
  (design: `SupabaseIntegration.md`). Migration `005_tenants.sql` (tenants +
  api_tokens + `tenant_id` on every owned table, founding tenant `sameh` =
  `…0001`, per-tenant email uniqueness) **applied to live prod**, non-breaking
  (existing rows backfilled). Tenant context in `src/db/tenant.ts`
  (`runTenant`/`currentTenantId`/`tenantOrFounding`/`db()` over AsyncLocalStorage)
  + token→tenant resolver (`src/auth/apiTokens.ts`, sha256). Every repo scopes by
  `tenant_id`; the Fastify guard resolves the request tenant (static founding
  bearer, per-tenant `api_tokens`, or dashboard JWT→founding) and binds it via
  `als.run(done)`. Cross-tenant isolation proven (`src/api/tenancy.test.ts`). RLS
  policies + non-owner role are Phase 2 (step 4 — optional/deferred).

- **Connectors — mine Gmail/Slack for SOPs (2026-07-06, branch `connectors`):**
  full pipeline `npm run sync -- gmail|slack|all` → fetch → deterministic junk
  filter → LLM extract (Structured Outputs) → aggregate/cluster (K=3) →
  skill/context drafts in the existing review queue, with provenance. Migration
  `006_connectors.sql` (`connectors` + `evidence`, tenant-scoped, RLS, deduped on
  thread_id) **applied to live prod**. Adapters (`src/connectors/adapters/`:
  Gmail `historyId` / Slack `ts` cursors; live HTTP impls founder-gated on
  tokens). REST API + dashboard **Activity → Connectors** page + "Sourced from
  connectors" provenance panel on skill detail. Spec/plan/`docs/connectors.md`.
  **Initial connector implementation is deployed**; customer-facing OAuth and
  focused source discovery are described in the 2026-07-10 product-surface
  milestone below.

- **Product control plane + focused source discovery (2026-07-10):** dashboard
  `/app` is now an overview of active skills, review work, governed runs, and
  connected sources; `/app/build` is a risk-aware skill builder for high-stakes
  decisions, incidents, team processes, and customer decisions. The Sources
  page accepts the process the user wants to teach, passes it through connector
  extraction/drafting, and shows unpromoted evidence with source links before
  review. Google Workspace OAuth connects Gmail + Drive in one read-only flow;
  Google Docs/Sheets/Slides are normalized through the new `google_drive`
  adapter. Slack now has the same OAuth installation flow; direct bot-token
  setup remains for local development. Migration `009_google_oauth.sql` stores
  short-lived, hashed one-time OAuth state. Frontend and backend verification:
  `npm run build`, frontend 3/3 tests, backend 63/63 files and 232/232 tests.

- **Interview resume-from-abandoned (2026-07-06):** `POST /api/interviews/:id/resume`
  + Resume buttons on the interview detail view and list (dashboard).

- **Supabase-hosted backend (2026-07-08, branch `supabase-hosted-backend`):**
  founder mandate: fully migrate the backend to Supabase; MCP stdio stays local.
  Spec `docs/superpowers/specs/2026-07-08-supabase-hosted-backend-design.md`,
  plan `docs/superpowers/plans/2026-07-08-supabase-hosted-backend.md`.
  (1) HTTP layer ported **Fastify → Hono** (same routes/codes/guard; MCP over
  `@hono/mcp` fetch-native transport; local entry on `@hono/node-server`;
  Fastify removed; tests via `src/test/http.ts` inject shim).
  (2) `npm run edge:build` bundles `src/edge/entry.ts` (our code only, esbuild,
  minified) → `supabase/functions/brian/index.js` + a generated `deno.json`
  import map pinning npm deps; **deployed via the Supabase MCP** with
  `verify_jwt=false` (the app enforces its own bearer/JWT guard).
  **LIVE at `https://foydcrwyakpkisxtvzgr.supabase.co/functions/v1/brian`**
  (`/api/*`, `/mcp`, `/__build` marker). Edge-runtime gotchas (encoded in
  comments): `process.env` READS pass through, WRITES + `Deno.env.toObject()`
  throw NotSupported; pool falls back to platform `SUPABASE_DB_URL`; auth
  fails closed (random token when the `BRIAN_API_TOKEN` secret is unset, so
  only `api_tokens` rows / JWTs authenticate — verified 401).
  (3) Clients repointed: `BRIAN_URL` in `server/.env` (hook needs no local
  API), `vercel.json` rewrites `/api/*` → the edge function for the deployed
  dashboard, docs updated. Live-verified: REST, MCP initialize + tools/list,
  hook SessionStart. `find_skill`/briefing/LLM routes await the
  `OPENAI_API_KEY` **edge secret** (founder step — no MCP tool for secrets).

- **Self-sufficient hosted secrets + Supabase login (2026-07-08, evening):**
  the hosted backend no longer needs platform secrets or any local process.
  Migration `008_app_config.sql` (applied live): owner-only `app_config`
  table (RLS on, zero policies, `brian_app` revoked); `src/config/secrets.ts`
  resolves env → app_config; embed/LLM/edge-entry read through it. The four
  values (`OPENAI_API_KEY`, `LLM_MODEL`, `BRIAN_API_TOKEN`,
  `AUTH_JWT_SECRET`) are **populated in app_config on live prod**
  (founder-authorized). Edge v4 deployed. **Live-verified end to end:**
  hosted MCP `find_skill` returns the right skill, `/api/agent/briefing`
  matches Refund Handling — the hosted brain is fully functional. Founder's
  Supabase Auth account created via public signup (a7madokss@gmail.com, same
  password as the legacy dashboard login; confirmation email pending). RLS
  role `brian_app` has login; **all 6 cross-tenant leak tests pass**.

- **RLS backstop (2026-07-08, branch `rls-backstop`):** SupabaseIntegration
  §7 Phase 2, now REQUIRED (public API). Migration `007_rls_backstop.sql`
  **applied to live prod** (via Supabase MCP): non-owner `brian_app` role
  (nologin until the founder sets a password — see Phase F), DML grants +
  default privileges per schema, RLS enabled everywhere, `tenant_isolation`
  policies on all 10 tenant tables keyed to transaction-scoped
  `app.tenant_id`, `pre_tenant_lookup` SELECT policies on api_tokens/tenants
  (bearer-hash → tenant resolution happens before a tenant exists).
  Code: `db()` in `src/db/tenant.ts` now wraps every one-shot repo query in
  `begin; set_config('app.tenant_id', tenant, true); …; commit` (setting dies
  with the tx — no cross-checkout leakage); updateSkill/updateContext bind it
  after their own `begin`. Tests: `migrate007.test.ts` (4) green;
  `rlsLeak.test.ts` (6, connect AS brian_app: unfiltered selects return only
  the bound tenant, cross-tenant insert rejected) **skip until
  `APP_TEST_DATABASE_URL` exists** — the agent classifier blocks granting a
  prod login credential, deliberately left to the founder.

- **Connector OAuth — hosted config wired + Google registered (2026-07-12):**
  made the connectors readiness path real on live prod. Root cause of a source
  showing **"Setup required"** / **"Brian's OAuth app still needs to be registered
  by the Brian team"**: `GET /api/connectors/providers` reports `configured:true`
  for a source only when that provider's `*_CLIENT_ID`+`*_CLIENT_SECRET` **plus**
  `BRIAN_OAUTH_BASE_URL` are readable via `secret()` (env → `app_config`). Live
  `app_config` had **zero** OAuth config, so every source read as not-configured
  (expected, not a bug). Done this session (Supabase MCP): **applied migration
  `009` (`oauth_states`)** to live; set in `app_config` — `BRIAN_OAUTH_BASE_URL`
  (edge function base), `BRIAN_APP_URL` = `https://brianthebrain.app` (production
  frontend domain, confirmed by founder), and a fresh 64-hex
  `CONNECTOR_ENCRYPTION_KEY` (**record it** — losing/rotating it makes encrypted
  connector tokens unreadable). **Google OAuth app registered** by the founder in
  the new **Google Auth Platform** (project "Brian", Web client; redirect
  `…/functions/v1/brian/api/connectors/google/callback`; JS origin
  `https://brianthebrain.app`); `GOOGLE_CLIENT_ID`+`GOOGLE_CLIENT_SECRET` stored in
  `app_config` → **Google is now `configured:true`** (hosted edge picks it up on
  next cold start). Google is deliberately in **Testing** publishing status for now
  (pilots): works for allow-listed test users. Because Gmail/Drive read are Google
  **restricted** scopes, a public launch requires Google verification + an annual
  **CASA** security assessment (~$1–3k/yr typical) — deferred by decision. Gotcha:
  Testing mode expires Google refresh tokens after **7 days**, so it is not a
  launch state. Only Google + Slack have ingestion adapters; the other 15 catalog
  providers can authorize but not yet ingest.

---

## How any agent should resume work here (read this first)

1. **Read order:** this file → `CompanyBrain.md` (product truth) → the spec
   for the step you're picking up (paths in each step + Key files below).
   For step 4 specifically, `SupabaseIntegration.md` is mandatory, in full.
2. **Workflow:** brainstorm → design spec (`docs/superpowers/specs/`) → 
   implementation plan (`docs/superpowers/plans/`) → TDD (failing test first),
   frequent commits on a feature branch → full suite green → `--no-ff` merge
   to `main`. Every merged milestone updates this file + the "done" list.
3. **Run tests:** `cd server && set -a && . ./.env && set +a && npm test`
   (the env file is gitignored and holds real credentials; tests hit the real
   Supabase DB but only the dedicated `test` schema — see infra facts above).
4. **Hard conventions (violating these has bitten us before):**
   - LLM provider is **OpenAI only** — no Anthropic/Claude API calls anywhere
     (founder directive). Generative calls use **Structured Outputs** (strict
     `json_schema`) because `gpt-5.4-mini` is a reasoning model that drifts
     otherwise; tests mock the LlmClient, never the DB.
   - Migrations (`server/src/db/migrations/`) re-run every time and must stay
     **convergent**; a later file dropping an index means removing its create
     from the earlier file.
   - Never trust a pgvector index created on an empty table; after index
     changes run `npm run bench`.
   - Frontend: CRA + react-router **v6** (v7 breaks CRA jest); every component
     is a `Component.js` + `Component.css` pair (founder directive).
   - Agent-facing scripts under `server/scripts/` are zero-dependency ESM
     `.mjs`, runnable by bare `node`, fail-silent when Brian is down.
   - Client-machine files (hooks, settings, AGENTS.md blocks) stay
     tenant-neutral — pointers + generic contract only, never company data.

## Next steps — the YC-ready phase plan (2026-07-08)

Goal: **YC-ready** — hosted product, one-command onboarding, real isolation,
demo that works on a clean machine. The backend is now hosted on Supabase
(Phase 1 ✅, see done list); what remains:

### Phase F — Founder checklist (updated 2026-07-08 evening; most items DONE)
✅ RLS role login + leak tests · ✅ hosted secrets (app_config) · ✅ hosted
find_skill/briefing verified · ✅ Supabase Auth account created.
Remaining:
1. **Click the Supabase confirmation email** sent to a7madokss@gmail.com —
   then Supabase login works everywhere (guard validates via the auth
   server; no other setup).
2. **Deploy the dashboard:** `npx vercel deploy --prod` at repo root (CLI is
   logged in; `vercel.json` routes `/api/*` to the edge function; the
   `REACT_APP_SUPABASE_*` values are in the committed root `.env`). The
   permission classifier blocks agents from prod deploys — founder runs it
   or explicitly instructs "deploy the frontend to Vercel production".
3. Security housekeeping (soon, not blocking): **rotate the OpenAI key**
   (shared in chat; update `app_config` + `server/.env`), set hosted RLS
   enforcement by adding `DATABASE_URL` (brian_app session-pooler URL) as an
   edge secret or app_config-driven boot (currently the edge connects as the
   `postgres` owner, so RLS is app-level-only there), delete the retired
   `brian-diag` function (410 stub).
4. **Connector OAuth configuration** — *in progress* (see the 2026-07-12 done
   bullet). Google is registered + `configured:true`; base URL, app URL, and
   encryption key are set in `app_config`; migration 009 (`oauth_states`) is live.
   Remaining:
   - **Google, to authorize without "Access blocked":** in the Google console add
     the founder's email under **Audience → Test users**, and register the
     `gmail.readonly` + `drive.readonly` scopes under **Data Access**.
   - **Slack (still unregistered):** create the app at api.slack.com/apps, store
     `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET` in `app_config`, add bot scopes
     (`channels:history`, `groups:history`, `users:read`, `users:read.email`) +
     the `…/slack/callback` redirect URL, and activate public distribution.
   - **Frictionless-launch strategy:** lead with Slack (and later Notion / Linear /
     GitHub — no security assessment) while Google verification/CASA runs in
     parallel; the other 15 catalog providers remain unregistered.
   - **Frontend must be deployed to `https://brianthebrain.app`** (Phase F step 2)
     so OAuth callbacks return to the real domain.
   - Then run one focused sync from **Sources**.

### Phase 2 — RLS as a real backstop ✅ BUILT (2026-07-08; live activation = Phase F step 0)
Migration 007 + tenant-bound queries are live and tested (see done list).
All that remains is the founder credential step above — no code left here.

### Phase 3 — Supabase Auth for dashboard humans ✅ BUILT (2026-07-08, branch `supabase-auth`)
- Guard (4th auth path): Supabase access tokens validated against the auth
  server (`GET /auth/v1/user`; `src/auth/supabase.ts` — no JWKS/secret
  handling, works with any signing scheme), `tenant_id`/`role` read from
  `app_metadata`, issuer pre-filter so agent bearers never trigger a network
  call. `SUPABASE_URL`+`SUPABASE_ANON_KEY` config (auto-present on the edge;
  added to `server/.env` locally).
- Login page tries Supabase password grant first
  (`REACT_APP_SUPABASE_URL/_ANON_KEY` in root `.env`, anon key is public);
  falls back to legacy `/api/auth/login`.
- `npm run seed:supabase-admin` creates/updates the founder auth user with
  founding-tenant `app_metadata` — needs `SUPABASE_SERVICE_ROLE_KEY` +
  `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `server/.env` (founder: dashboard →
  Settings → API → service_role). **Legacy bcrypt path deliberately kept**
  until that user exists; delete `src/auth/users.ts`+`jwt.ts` and the login
  route's bcrypt branch at cutover. Token auto-refresh (supabase-js) and the
  invite flow + "Agents & tokens" page: Phase 4 backlog.

### Phase 4 — YC polish (remaining)
- **Founder: deploy the frontend** — `vercel deploy` at repo root
  (`vercel.json` rewrites `/api/*` → the edge function; set
  `REACT_APP_SUPABASE_URL/_ANON_KEY` in Vercel env, values in root `.env`).
- **YC demo script** (after Phase F secrets): on any machine,
  `cd server && npm run onboard -- --url
  https://foydcrwyakpkisxtvzgr.supabase.co/functions/v1/brian --token <TOKEN>`
  → open Claude/Cursor → ask for a refund task → agent pulls the skill from
  the hosted brain, respects guardrails, logs the execution → show the
  execution + provenance in the dashboard. No laptop server anywhere.
- Connectors live on real data (after Phase F): tune junk-filter thresholds /
  cluster K, **encrypt `connectors.credentials`**, and verify Google/Slack OAuth
  callbacks in the hosted environment.
- Backlog: supabase-js token refresh + invite flow + "Agents & tokens" page;
  metrics for the pitch (executions per tenant; bench 85/91.7 + Phases 2–3).

### Smaller follow-ups (nice-to-have)
- Once real syncs run: tune the junk-filter thresholds / cluster `K` on live
  signal; per-channel Slack selection; **encrypt `connectors.credentials`**
  (currently plaintext in the tenant row — a noted hardening).
- Brian-bench Phases 2–3 (500-task inbox marathon + learning curve) — specced in
  `docs/superpowers/specs/2026-07-02-brian-bench-design.md`, not built.
- Done already: interview resume-from-abandoned; sidebar review-count badge.

### 6. Later / deferred (intentional anti-goals until real use proves them out)
- Cloud hosting of the HTTP surface (Fly/Railway) — transport-ready; deploy when
  a remote agent needs it (with Supabase Phase 4).
- Connector schedulers/daemons — v1 syncs are manual `npm run sync`; automate
  only after the pipeline proves signal-to-noise on real data.
- Graph DB / graph UI — not happening for v1; a skill table beats it.
- Move pgvector out of `public` schema (minor security-linter WARN) — low priority.

---

## How to equip a company's AI agent (reference)
The MCP server **is** the integration surface. A company's agent: (a) connects to
Brian's MCP server (stdio locally, or `POST /mcp` + bearer token), (b) gets the
system-prompt contract in `docs/agent-contract.md`, (c) has the company's real
business tools wired behind the MCP tool names via `src/mcp/adapters.ts`,
(d) logs every run via `log_execution`. The brain supplies judgment + rules; the
agent executes; `capture` keeps it current.

## Key files
- Specs: `docs/superpowers/specs/2026-06-29-company-brain-design.md`,
  `docs/superpowers/specs/2026-06-29-knowledge-capture-design.md`,
  `docs/superpowers/specs/2026-07-01-brian-roadmap-to-done-design.md`
- Plans: `docs/superpowers/plans/2026-06-29-company-brain-v1.md`,
  `docs/superpowers/plans/2026-06-29-knowledge-capture-v2.md`,
  `docs/superpowers/plans/2026-07-01-roadmap-to-done.md`
- Product source of truth: `CompanyBrain.md` · Supabase/multi-tenant design:
  `SupabaseIntegration.md` (mandatory reading before building tenancy)
- Newer specs: `docs/superpowers/specs/2026-07-04-always-on-invocation-design.md`,
  `docs/superpowers/specs/2026-07-04-brian-onboard-design.md`,
  `docs/superpowers/specs/2026-07-06-connectors-design.md`
- Docs: `docs/agent-contract.md`, `docs/gmail-setup.md`, `docs/onboard.md`,
  `docs/connectors.md` · Multi-tenant design: `SupabaseIntegration.md`
- Backend entry points: `server/src/api/index.ts` (REST + `/mcp` HTTP),
  `server/src/mcp/index.ts` (MCP stdio), `server/src/review/cli.ts` (review CLI),
  `server/src/ingestion/capture.ts` (capture pipeline), `server/src/llm/` (OpenAI),
  `server/src/db/tenant.ts` (tenant context), `server/src/connectors/` (Gmail/Slack
  pipeline; `npm run sync`), `server/scripts/onboard/` (`npm run onboard`).
