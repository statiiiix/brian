# Supabase Integration — how Brian serves many companies from one brain

> Design doc for taking Brian from "one company's brain on the founder's
> machine" to "hosted product where every client company has its own set of
> skills, context, users, and agents." Companion to `CompanyBrain.md` (product)
> and `docs/superpowers/specs/2026-07-04-brian-onboard-design.md` (client-side
> onboarding). Nothing here is built yet; this is the agreed target.

---

## 1. Where we are today (facts, not plans)

- Supabase project **brian** (ref `foydcrwyakpkisxtvzgr`), Postgres 17 +
  pgvector. One tenant: us. Tables: `skills`, `skill_versions`,
  `context_entries`, `context_versions`, `executions`, `users`, `interviews`.
- Embeddings are `vector(1536)` columns (`text-embedding-3-small`) on `skills`
  and `context_entries`, searched with HNSW indexes (migration `003_hnsw.sql`).
- RLS is *enabled* on every table but not *doing* anything: the backend
  connects as the `postgres` owner role, which bypasses RLS.
- Two auth planes, both custom: humans log into the dashboard with
  bcrypt+JWT (`server/src/auth/`); agents hit `/api/*` and `POST /mcp` with a
  single static bearer `BRIAN_API_TOKEN`.
- The MCP server (stdio locally, Streamable HTTP at `POST /mcp`) is the whole
  integration surface for agents.

## 2. The core decision: how client data is separated

The question "does each client get their own vector table?" has four possible
answers. Comparison:

| Model | Isolation | Ops cost | Verdict |
|---|---|---|---|
| **Supabase project per client** | Strongest (separate DB, keys, region) | New project, migrations, monitoring, billing *per client*; no cross-client queries; onboarding stops being one command | Only as a paid "dedicated" tier for enterprise, later |
| **Postgres schema per client** | Strong-ish | Migrations × N schemas, connection search_path juggling, pgvector indexes × N; we already learned migrations must stay convergent — multiplying them is asking for drift | No |
| **Table per client** (`skills_acme`, …) | Weak, messy | Dynamic SQL everywhere, no FK sanity, index sprawl | No |
| **Shared tables + `tenant_id` + RLS** | Good (enforced in the DB, not just app code) | One set of migrations, one set of indexes, one query path; standard Postgres multi-tenancy | **Yes — this is the design** |

**Decision: shared tables, a `tenant_id` column on every tenant-owned table,
and RLS policies that make cross-tenant reads impossible at the database
layer.** No per-client vector tables. A client's "set of skills" is simply
`skills where tenant_id = <their id>`, versioned and vector-indexed exactly as
today.

When a future enterprise client demands physical isolation, we spin them a
dedicated Supabase project running the *same* migrations — the shared-schema
design degrades gracefully into model 1 because nothing in the code assumes
single-tenancy once `tenant_id` exists.

## 3. Data model changes (migration `005_tenants.sql`)

New tables:

```sql
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,          -- 'acme'
  status      text not null default 'active',-- active | suspended
  created_at  timestamptz not null default now()
);

-- Agent credentials. One or more per tenant (per environment / per agent
-- platform), revocable independently. Only a hash is stored; the plaintext
-- token is shown once at creation.
create table api_tokens (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  token_hash  text not null unique,          -- sha256 of the bearer token
  label       text not null,                 -- 'prod claude-code', 'codex laptop'
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
```

Changes to existing tables: add `tenant_id uuid not null references
tenants(id)` to `skills`, `skill_versions`, `context_entries`,
`context_versions`, `executions`, `interviews`, and `users`; backfill
everything to a founding tenant (`slug 'sameh'`) in the same migration;
add `(tenant_id)` to the natural lookup indexes. Uniqueness constraints
become per-tenant (e.g. skill names, user emails → unique on
`(tenant_id, email)`).

Migration stays convergent (re-runnable), matching the existing 001–004
convention.

## 4. Vector search per client

- **No separate vector tables or indexes per client.** The existing HNSW
  indexes stay global; queries gain `and tenant_id = $tenant`.
- Filtered ANN search is the one real technical caveat: an HNSW scan that
  post-filters by tenant can return fewer than k results. pgvector ≥ 0.8
  mitigates this with iterative index scans, and — more importantly — our
  scale makes it a non-issue: a client's skill library is hundreds of rows,
  not millions. `find_skill` is top-1/top-3 over a few hundred candidates;
  even an exact (sequential) scan per tenant would be milliseconds.
- Lesson from brian-bench stays in force: never trust a vector index created
  on an empty table (the ivfflat 12.5% incident). Any index change reruns
  `npm run bench` before going live.
- Escape hatch if a giant tenant ever appears: per-tenant **partial** HNSW
  indexes (`create index ... where tenant_id = '...'`) are additive and need
  no schema change.
- Embedding *generation* is unchanged (OpenAI `text-embedding-3-small`,
  1536 dims). Embeddings are derived data; per-tenant encryption of vectors is
  explicitly out of scope (they live in the same Postgres as the source text).

## 5. Authentication: two planes, two mechanisms

### 5a. Humans (dashboard) → Supabase Auth

Replace the custom bcrypt+JWT stack with **Supabase Auth**:

- Clients' experts and admins sign in with email/password or magic link
  (Google OAuth is a checkbox later). Supabase handles password storage,
  reset flows, MFA — code we should not own.
- Each auth user carries `tenant_id` and `role` (`admin` | `expert`) in
  `app_metadata` (set server-side at invite time, not user-editable).
  The dashboard sends the Supabase JWT to our Fastify API exactly as it sends
  the custom JWT today; the API verifies it with the project's JWT secret and
  reads tenant + role from claims. `src/auth/` shrinks to claim verification.
- Our `users` table remains as the app-level profile (name, role display,
  interview authorship) keyed by the Supabase auth user id, with `tenant_id`.
- Migration path: the two existing accounts (founder admin + any test user)
  are recreated via `supabase.auth.admin.createUser` with the founding
  tenant's metadata; `npm run seed:admin` is rewritten to do that; the
  bcrypt path is deleted, not maintained in parallel.
- Invites: an admin invites an expert by email → Supabase invite email →
  first login lands in the interview dashboard. This replaces "shareable
  interview links" from the old follow-up list.

### 5b. Agents (MCP + REST) → per-tenant API tokens

Agents cannot do interactive OAuth, and MCP clients speak "bearer token".
So agents keep static bearers — but scoped and revocable:

- `POST /mcp` and `/api/*` accept `Authorization: Bearer <token>`; the guard
  hashes the presented token (sha256), looks it up in `api_tokens`
  (`revoked_at is null`, tenant `active`), and resolves the **tenant** for the
  request. Constant-time compare concerns disappear because we compare hashes
  via unique index lookup.
- The single global `BRIAN_API_TOKEN` becomes just the founding tenant's first
  row in `api_tokens` (kept working through the migration), then is retired
  from `.env`.
- Tokens are minted per client *and per surface* ("acme — claude-code prod",
  "acme — codex laptop") so one leaked laptop doesn't rotate the whole
  company. Admin UI: a "Agents & tokens" page in the dashboard (create,
  label, revoke; plaintext shown once).
- The `brian onboard` installer takes exactly this token (`--url --token`) —
  the client-side story is already built for this.

## 6. How it combines with MCP (request flow)

Nothing about the MCP *protocol* surface changes — same tools, same
instructions, same briefing endpoint. What changes is that every request now
knows its tenant:

```
Agent (any client company, any platform)
  │  POST https://api.brian.app/mcp        Authorization: Bearer <acme token>
  ▼
Fastify guard: sha256(token) → api_tokens → tenant_id = acme, role = agent
  ▼
per-request DB context:  SET LOCAL app.tenant_id = '<acme uuid>'
  ▼
MCP tool handlers (find_skill / find_context / capture / log_execution / …)
  — repo functions add `tenant_id = current_setting('app.tenant_id')::uuid`
  ▼
RLS (second line of defense, §7) — even a buggy query cannot cross tenants
```

- `find_skill("customer wants a refund")` from an Acme agent searches only
  Acme's vectors; the same call from a Globex agent searches only Globex's.
  Same server, same table, zero shared results.
- `capture` and `log_execution` write with the request's tenant_id — each
  client's brain learns only from its own agents.
- The MCP `instructions` blob and the agent contract remain tenant-neutral
  (they contain no company data), so onboarding artifacts on client machines
  never need updating when server-side data changes.
- **stdio MCP** (`npm run mcp`) stays for development and self-hosted
  single-tenant use; it pins the founding tenant via env
  (`BRIAN_TENANT=sameh`). Hosted clients use Streamable HTTP only.
- The hooks briefing endpoint (`POST /api/agent/briefing`) is tenant-scoped
  by the same guard — client machines already send the bearer token.

## 7. What RLS actually enforces (and what changes)

Today RLS is decorative (owner role bypasses it). Multi-tenant flips that:

- The backend connects as a dedicated **non-owner role** (`brian_app`) with
  RLS in force. Migrations keep running as `postgres`.
- Policy pattern on every tenant-owned table:

```sql
create policy tenant_isolation on skills
  using (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

- The guard sets `app.tenant_id` with `SET LOCAL` inside the request's
  transaction (pool-safe: it dies with the transaction).
- Result: tenant scoping is enforced twice — explicitly in repo SQL (for
  correctness and index use) and by RLS (so a forgotten `where` clause is a
  bug, not a breach).
- Supabase client-side keys (`anon`, `service_role`) stay unused by the
  dashboard: all data access continues to go through our Fastify API. Supabase
  Auth is the only Supabase product the browser talks to directly. This keeps
  one authorization code path.

## 8. Rollout phases

1. **005_tenants migration + token guard** — tenants, api_tokens, tenant_id
   everywhere, backfill founding tenant, guard resolves tenant from token.
   All 114 tests updated to create a test tenant. No user-visible change.
2. **RLS for real** — `brian_app` role, `SET LOCAL`, policies, cross-tenant
   leak tests (agent A must get NO_MATCHING_SKILL for agent B's skills even
   with hand-crafted queries).
3. **Supabase Auth swap** — dashboard login via Supabase, claims-based guard,
   invite flow, delete bcrypt path.
4. **Hosted deploy** — the deliberately-deferred cloud step (Fly/Railway for
   Fastify; DB is already cloud). Token admin UI. First design partner
   onboarded with `npm run onboard -- --url ... --token ...`.

Phases 1–2 are safe to build now and don't block anything; 3–4 land when the
first external design partner is ready.

## 9. Open questions (genuinely open, need a decision later)

- **Region/residency:** current project is `eu-central-1`; fine for EU
  partners, a US-heavy pipeline might want a US project (model 1 makes this a
  per-client choice later).
- **Supabase Auth vs keeping custom JWT:** decided above (Supabase Auth), but
  revisit if a design partner demands SSO/SAML before Supabase's offering
  fits the price we can pay.
- **Billing/limits per tenant:** executions and capture calls are already
  logged per tenant after phase 1 — pricing metering can hang off
  `executions` later; not designed here.
- **Realtime:** Supabase Realtime could push review-queue badges to the
  dashboard; nice-to-have, not part of this design.
