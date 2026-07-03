# Interview Mode + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brian interviews a process expert in a web chat until it can draft a complete skill; ships inside a logged-in dashboard (skills, review queue, interviews, capture, executions) sharing the landing page's design language.

**Architecture:** Backend adds a `users`/`interviews` migration, JWT auth alongside the existing static bearer token, and an interview engine that makes one Structured-Outputs LLM call per turn (same seam as `capture`). Frontend converts the CRA root into a routed app: `/` landing, `/login`, `/app/*` dashboard consuming the existing + new REST endpoints.

**Tech Stack:** Node/TS + Fastify + pg + pgvector (existing `server/`), OpenAI Structured Outputs via `LlmClient` seam, `bcryptjs` + `jsonwebtoken`, React 19 + react-router-dom + plain CSS (CRA).

**Spec:** `docs/superpowers/specs/2026-07-03-interview-mode-dashboard-design.md`

## Global Constraints

- LLM provider is OpenAI only; generative model `gpt-5.4-mini` via `LLM_MODEL`; all generative calls go through `LlmClient` (`server/src/llm/complete.ts`) with strict Structured Outputs schemas (every object: all props `required`, `additionalProperties:false`, nullable = `["type","null"]` or `anyOf` with null).
- Tests: Vitest, run against the `test` schema (`TEST_DATABASE_URL`), LLM always mocked, embeds mocked with the existing `vi.mock("../db/embed.js", ...)` pattern. Run: `cd server && set -a && . ./.env && set +a && npm test`.
- Migrations are convergent (`create table if not exists`, safe to re-run every time) and run in filename order.
- No credentials in the repo: admin email/password come from `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars in gitignored `server/.env`; JWT secret from `AUTH_JWT_SECRET`.
- Frontend design tokens come from `src/HomePage.css` (`--bg:#0a0a0b`, `--accent:#f5a623`, Inter/JetBrains Mono, hairline `--border`); dashboard must read as the same product. Use the ui-ux-pro-max skill when building dashboard views.
- Backend commits use `feat(server):`/`test(server):`; frontend `feat(ui):`.

---

### Task 1: Migration 004 — users + interviews tables

**Files:**
- Create: `server/src/db/migrations/004_users_interviews.sql`
- Test: `server/src/db/migrate004.test.ts`

**Interfaces:**
- Produces: tables `users(id,email,password_hash,name,role,created_at)` and `interviews(id,topic,owner,status,messages,coverage,draft,resulting_skill_id,created_by,created_at,updated_at)`.

- [ ] **Step 1: Write the failing test**

`server/src/db/migrate004.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runMigrations } from "./migrate.js";
import { pool } from "./pool.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("migration 004: users + interviews", () => {
  beforeAll(async () => { await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("creates users with unique email", async () => {
    await pool.query("delete from users where email = 'a@b.c'");
    await pool.query("insert into users (email, password_hash) values ('a@b.c','h')");
    await expect(
      pool.query("insert into users (email, password_hash) values ('a@b.c','h2')")
    ).rejects.toThrow();
  });

  it("creates interviews with defaults", async () => {
    const { rows } = await pool.query(
      "insert into interviews (topic) values ('refunds') returning *"
    );
    expect(rows[0].status).toBe("active");
    expect(rows[0].messages).toEqual([]);
    expect(rows[0].coverage).toEqual({});
    expect(rows[0].draft).toBeNull();
    await pool.query("delete from interviews where id = $1", [rows[0].id]);
  });

  it("is convergent (re-runs cleanly)", async () => {
    await runMigrations(pool);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `cd server && set -a && . ./.env && set +a && npx vitest run src/db/migrate004.test.ts` → FAIL (`relation "users" does not exist`).

- [ ] **Step 3: Write the migration**

`server/src/db/migrations/004_users_interviews.sql`:

```sql
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  name          text,
  role          text not null default 'admin',
  created_at    timestamptz not null default now()
);
alter table users enable row level security;

create table if not exists interviews (
  id                 uuid primary key default gen_random_uuid(),
  topic              text not null,
  owner              text,
  status             text not null default 'active',
  messages           jsonb not null default '[]',
  coverage           jsonb not null default '{}',
  draft              jsonb,
  resulting_skill_id uuid references skills(id),
  created_by         uuid references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
alter table interviews enable row level security;
```

- [ ] **Step 4: Run test to verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git add server/src/db && git commit -m "feat(server): users + interviews tables (migration 004)"`

---

### Task 2: Auth primitives — password hashing + JWT + users repo

**Files:**
- Create: `server/src/auth/users.ts`, `server/src/auth/jwt.ts`
- Test: `server/src/auth/users.test.ts`, `server/src/auth/jwt.test.ts`
- Modify: `server/package.json` (add `bcryptjs`, `jsonwebtoken`, `@types/jsonwebtoken`)

**Interfaces:**
- Produces:
  - `interface User { id: string; email: string; name: string | null; role: string; created_at: string }`
  - `upsertUser({email,password,name?,role?}, p?): Promise<User>` (bcrypt-hashes; on email conflict updates hash/name/role)
  - `findUserByEmail(email, p?): Promise<(User & {password_hash: string}) | null>`
  - `verifyPassword(hash: string, password: string): Promise<boolean>`
  - `signUserToken(u: {id,email,role}, secret: string): string` (HS256, 7d expiry)
  - `verifyUserToken(token: string, secret: string): {id,email,role} | null`

- [ ] **Step 1: Install deps** — `cd server && npm i bcryptjs jsonwebtoken && npm i -D @types/jsonwebtoken`
- [ ] **Step 2: Write failing tests**

`server/src/auth/jwt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { signUserToken, verifyUserToken } from "./jwt.js";

describe("jwt", () => {
  const u = { id: "11111111-1111-1111-1111-111111111111", email: "a@b.c", role: "admin" };
  it("round-trips a user", () => {
    const t = signUserToken(u, "s3");
    expect(verifyUserToken(t, "s3")).toMatchObject(u);
  });
  it("rejects a bad secret and garbage", () => {
    const t = signUserToken(u, "s3");
    expect(verifyUserToken(t, "other")).toBeNull();
    expect(verifyUserToken("garbage", "s3")).toBeNull();
  });
});
```

`server/src/auth/users.test.ts` (DB test, same skip pattern as others):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { upsertUser, findUserByEmail, verifyPassword } from "./users.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

d("users repo", () => {
  beforeAll(async () => {
    await runMigrations(pool);
    await pool.query("delete from users where email = 'admin@test.io'");
  });
  afterAll(async () => { await pool.end(); });

  it("upserts, finds, verifies password; rejects wrong password", async () => {
    const u = await upsertUser({ email: "admin@test.io", password: "pw-one", name: "Admin" });
    expect(u.email).toBe("admin@test.io");
    const found = await findUserByEmail("admin@test.io");
    expect(found).not.toBeNull();
    expect(await verifyPassword(found!.password_hash, "pw-one")).toBe(true);
    expect(await verifyPassword(found!.password_hash, "nope")).toBe(false);

    // upsert same email changes password
    await upsertUser({ email: "admin@test.io", password: "pw-two" });
    const again = await findUserByEmail("admin@test.io");
    expect(await verifyPassword(again!.password_hash, "pw-two")).toBe(true);
  });

  it("returns null for unknown email", async () => {
    expect(await findUserByEmail("ghost@test.io")).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify FAIL** (modules missing).
- [ ] **Step 4: Implement**

`server/src/auth/jwt.ts`:

```ts
import jwt from "jsonwebtoken";

export interface TokenUser { id: string; email: string; role: string; }

export function signUserToken(u: TokenUser, secret: string): string {
  return jwt.sign({ sub: u.id, email: u.email, role: u.role }, secret, {
    algorithm: "HS256", expiresIn: "7d",
  });
}

export function verifyUserToken(token: string, secret: string): TokenUser | null {
  try {
    const p = jwt.verify(token, secret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    if (!p.sub || typeof p.email !== "string") return null;
    return { id: String(p.sub), email: p.email, role: String(p.role ?? "admin") };
  } catch {
    return null;
  }
}
```

`server/src/auth/users.ts`:

```ts
import bcrypt from "bcryptjs";
import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";

export interface User {
  id: string; email: string; name: string | null; role: string; created_at: string;
}

const COLS = "id, email, name, role, created_at";

export async function upsertUser(
  input: { email: string; password: string; name?: string | null; role?: string },
  p: pg.Pool = defaultPool
): Promise<User> {
  const hash = await bcrypt.hash(input.password, 10);
  const { rows } = await p.query(
    `insert into users (email, password_hash, name, role)
     values ($1, $2, $3, $4)
     on conflict (email) do update
       set password_hash = excluded.password_hash,
           name = coalesce(excluded.name, users.name),
           role = excluded.role
     returning ${COLS}`,
    [input.email.toLowerCase(), hash, input.name ?? null, input.role ?? "admin"]
  );
  return rows[0];
}

export async function findUserByEmail(
  email: string, p: pg.Pool = defaultPool
): Promise<(User & { password_hash: string }) | null> {
  const { rows } = await p.query(
    `select ${COLS}, password_hash from users where email = $1`,
    [email.toLowerCase()]
  );
  return rows[0] ?? null;
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

- [ ] **Step 5: Run tests → PASS. Commit** — `git add server && git commit -m "feat(server): auth primitives — users repo, bcrypt, JWT"`

---

### Task 3: Login endpoints + dual-mode API auth (static token OR user JWT)

**Files:**
- Modify: `server/src/api/app.ts` (auth hook + `/api/auth/login` + `/api/auth/me`), `server/src/api/index.ts` (pass `jwtSecret`)
- Test: `server/src/api/authRoutes.test.ts`

**Interfaces:**
- Consumes: Task 2 (`findUserByEmail`, `verifyPassword`, `signUserToken`, `verifyUserToken`).
- Produces: `buildApp({ authToken?, jwtSecret? })`; `POST /api/auth/login {email,password} → {token, user:{id,email,name,role}}` (public); `GET /api/auth/me → user` (JWT only); every `/api/*` + `/mcp` route accepts static token **or** JWT; `req.user` is set when JWT is used.

- [ ] **Step 1: Write failing tests**

`server/src/api/authRoutes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { upsertUser } from "../auth/users.js";
import { buildApp } from "./app.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

d("auth routes + dual-mode guard", () => {
  beforeAll(async () => {
    await runMigrations(pool);
    await upsertUser({ email: "founder@test.io", password: "hunter22", name: "Founder" });
  });
  afterAll(async () => { await pool.end(); });

  const app = () => buildApp({ authToken: "static-tok", jwtSecret: "jwt-secret" });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    const a = app();
    const ok = await a.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "founder@test.io", password: "hunter22" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().token).toBeTruthy();
    expect(ok.json().user.email).toBe("founder@test.io");

    const bad = await a.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "founder@test.io", password: "wrong" } });
    expect(bad.statusCode).toBe(401);
    await a.close();
  });

  it("JWT works on /api routes; /me returns the user; static token still works", async () => {
    const a = app();
    const login = await a.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "founder@test.io", password: "hunter22" } });
    const jwt = login.json().token;

    const viaJwt = await a.inject({ method: "GET", url: "/api/skills",
      headers: { authorization: `Bearer ${jwt}` } });
    expect(viaJwt.statusCode).toBe(200);

    const me = await a.inject({ method: "GET", url: "/api/auth/me",
      headers: { authorization: `Bearer ${jwt}` } });
    expect(me.json().email).toBe("founder@test.io");

    const viaStatic = await a.inject({ method: "GET", url: "/api/skills",
      headers: { authorization: "Bearer static-tok" } });
    expect(viaStatic.statusCode).toBe(200);

    const meStatic = await a.inject({ method: "GET", url: "/api/auth/me",
      headers: { authorization: "Bearer static-tok" } });
    expect(meStatic.statusCode).toBe(401);

    const nope = await a.inject({ method: "GET", url: "/api/skills",
      headers: { authorization: "Bearer garbage" } });
    expect(nope.statusCode).toBe(401);
    await a.close();
  });
});
```

- [ ] **Step 2: Run → FAIL** (login route 401s under guard / doesn't exist).
- [ ] **Step 3: Implement in `app.ts`**

Add to imports:

```ts
import { findUserByEmail, verifyPassword } from "../auth/users.js";
import { signUserToken, verifyUserToken, type TokenUser } from "../auth/jwt.js";
```

Extend options and the guard (replace the existing `if (authToken)` block):

```ts
export interface AppOptions {
  authToken?: string | null;
  jwtSecret?: string | null;
}

declare module "fastify" {
  interface FastifyRequest { user?: TokenUser }
}

// inside buildApp:
const jwtSecret = opts.jwtSecret ?? null;
const PUBLIC_PATHS = new Set(["/api/auth/login"]);

if (authToken || jwtSecret) {
  app.addHook("onRequest", async (req, reply) => {
    if (PUBLIC_PATHS.has(req.url.split("?")[0])) return;
    if (authToken && bearerMatches(req.headers.authorization, authToken)) return;
    if (jwtSecret && req.headers.authorization?.startsWith("Bearer ")) {
      const u = verifyUserToken(req.headers.authorization.slice(7), jwtSecret);
      if (u) { req.user = u; return; }
    }
    return reply.code(401).send({ error: "unauthorized" });
  });
}
```

Routes:

```ts
app.post("/api/auth/login", async (req, reply) => {
  if (!jwtSecret) return reply.code(500).send({ error: "auth not configured" });
  const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
  if (!email || !password) return reply.code(400).send({ error: "email and password required" });
  const u = await findUserByEmail(email);
  if (!u || !(await verifyPassword(u.password_hash, password))) {
    return reply.code(401).send({ error: "invalid credentials" });
  }
  const token = signUserToken({ id: u.id, email: u.email, role: u.role }, jwtSecret);
  return { token, user: { id: u.id, email: u.email, name: u.name, role: u.role } };
});

app.get("/api/auth/me", async (req, reply) => {
  if (!req.user) return reply.code(401).send({ error: "unauthorized" });
  return req.user;
});
```

`server/src/api/index.ts`: pass `jwtSecret: process.env.AUTH_JWT_SECRET ?? null` to `buildApp`.

- [ ] **Step 4: Run new tests + existing `auth.test.ts` → PASS. Commit** — `feat(server): login + dual-mode auth (static token or user JWT)`

---

### Task 4: Admin seed script

**Files:**
- Create: `server/src/scripts/seedAdmin.ts`
- Modify: `server/package.json` (script `"seed:admin": "tsx src/scripts/seedAdmin.ts"`)

**Interfaces:**
- Consumes: `upsertUser` (Task 2), `loadServerEnv` (`src/env.ts`).

- [ ] **Step 1: Implement**

```ts
import { loadServerEnv } from "../env.js";
loadServerEnv();

const { upsertUser } = await import("../auth/users.js");
const { pool } = await import("../db/pool.js");

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD in server/.env first.");
  process.exit(1);
}
const u = await upsertUser({ email, password, name: process.env.ADMIN_NAME ?? null });
console.log(`admin user ready: ${u.email} (${u.id})`);
if (!process.env.AUTH_JWT_SECRET) {
  console.warn("WARNING: AUTH_JWT_SECRET is not set — logins will fail until it is.");
}
await pool.end();
```

- [ ] **Step 2: Verify manually** — add `ADMIN_EMAIL=a7madokss@gmail.com`, `ADMIN_PASSWORD=<founder's password>`, `AUTH_JWT_SECRET=<openssl rand -hex 32>` to `server/.env`, run `npm run seed:admin`, expect `admin user ready: ...` against live DB.
- [ ] **Step 3: Commit** — `feat(server): admin seed script (env-driven, no creds in repo)`

---

### Task 5: Interview types + repo

**Files:**
- Create: `server/src/interviews/types.ts`, `server/src/interviews/repo.ts`
- Test: `server/src/interviews/repo.test.ts`

**Interfaces:**
- Produces:

```ts
export type InterviewStatus = "active" | "ready" | "completed" | "abandoned";
export interface InterviewMessage { role: "brian" | "expert"; content: string; at: string; }
export interface Coverage {
  trigger: boolean; inputs: boolean; procedure: boolean; hard_rules: boolean;
  guardrails: boolean; escalation_target: boolean; examples: boolean;
}
export const EMPTY_COVERAGE: Coverage; // all false
export interface Interview {
  id: string; topic: string; owner: string | null; status: InterviewStatus;
  messages: InterviewMessage[]; coverage: Coverage; draft: NewSkill | null;
  resulting_skill_id: string | null; created_by: string | null;
  created_at: string; updated_at: string;
}
```

Repo functions (all take `p: pg.Pool = defaultPool` last):
`createInterview({topic, owner?, created_by?})`, `getInterview(id)` (null when missing), `listInterviews()` (newest first), `appendMessage(id, msg: {role, content})` (stamps `at`, bumps `updated_at`), `setTurnResult(id, {coverage, question} | {coverage, draft})` (question → appends nothing, engine appends; draft → stores draft, status `ready`), `completeInterview(id, skillId)` (status `completed`, sets `resulting_skill_id`), `abandonInterview(id)`. `NotFoundError` re-used from skills repo? No — throw the same-shaped local `NotFoundError` imported from `../skills/repo.js`.

- [ ] **Step 1: Write failing test**

`server/src/interviews/repo.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import {
  createInterview, getInterview, listInterviews, appendMessage,
  setTurnResult, completeInterview, abandonInterview,
} from "./repo.js";
import { EMPTY_COVERAGE } from "./types.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const draft = {
  name: "Refund Handling", trigger: "Customer asks for refund", inputs: ["order_id"],
  procedure: "1. look up. 2. refund.", hard_rules: ["never > $200"], tools: ["get_order"],
  guardrails: ["stop if > $200"], escalation_target: "lead", examples: [], owner: "Sam",
};

d("interviews repo", () => {
  beforeAll(async () => {
    await runMigrations(pool);
    await pool.query("delete from interviews");
  });
  afterAll(async () => { await pool.end(); });

  it("creates with defaults and lists newest first", async () => {
    const a = await createInterview({ topic: "refunds", owner: "Sam" });
    expect(a.status).toBe("active");
    expect(a.messages).toEqual([]);
    expect(a.coverage).toEqual(EMPTY_COVERAGE);
    const b = await createInterview({ topic: "pricing" });
    const list = await listInterviews();
    expect(list[0].id).toBe(b.id);
  });

  it("appends messages with timestamps", async () => {
    const iv = await createInterview({ topic: "sev2" });
    await appendMessage(iv.id, { role: "brian", content: "What triggers this?" });
    const got = await appendMessage(iv.id, { role: "expert", content: "An alert fires." });
    expect(got.messages).toHaveLength(2);
    expect(got.messages[1].role).toBe("expert");
    expect(got.messages[1].at).toBeTruthy();
  });

  it("setTurnResult stores coverage, and draft flips status to ready", async () => {
    const iv = await createInterview({ topic: "refunds" });
    const asking = await setTurnResult(iv.id, {
      coverage: { ...EMPTY_COVERAGE, trigger: true },
    });
    expect(asking.status).toBe("active");
    expect(asking.coverage.trigger).toBe(true);

    const ready = await setTurnResult(iv.id, {
      coverage: { trigger: true, inputs: true, procedure: true, hard_rules: true,
        guardrails: true, escalation_target: true, examples: true },
      draft,
    });
    expect(ready.status).toBe("ready");
    expect(ready.draft?.name).toBe("Refund Handling");
  });

  it("completes and abandons", async () => {
    const iv = await createInterview({ topic: "x" });
    const ab = await abandonInterview(iv.id);
    expect(ab.status).toBe("abandoned");

    const iv2 = await createInterview({ topic: "y" });
    const { rows } = await pool.query(
      `insert into skills (name, trigger, procedure) values ('s','t','p') returning id`);
    const done = await completeInterview(iv2.id, rows[0].id);
    expect(done.status).toBe("completed");
    expect(done.resulting_skill_id).toBe(rows[0].id);
  });

  it("getInterview returns null for unknown id", async () => {
    expect(await getInterview("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `types.ts` + `repo.ts`**

`types.ts` exactly as the Interfaces block above, plus:

```ts
export const EMPTY_COVERAGE: Coverage = {
  trigger: false, inputs: false, procedure: false, hard_rules: false,
  guardrails: false, escalation_target: false, examples: false,
};
```

`repo.ts`:

```ts
import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import { NotFoundError } from "../skills/repo.js";
import type { NewSkill } from "../skills/types.js";
import { EMPTY_COVERAGE, type Coverage, type Interview, type InterviewMessage } from "./types.js";

const COLS = `id, topic, owner, status, messages, coverage, draft,
  resulting_skill_id, created_by, created_at, updated_at`;

function hydrate(row: any): Interview {
  return { ...row, coverage: { ...EMPTY_COVERAGE, ...row.coverage } };
}

export async function createInterview(
  input: { topic: string; owner?: string | null; created_by?: string | null },
  p: pg.Pool = defaultPool
): Promise<Interview> {
  const { rows } = await p.query(
    `insert into interviews (topic, owner, created_by) values ($1,$2,$3) returning ${COLS}`,
    [input.topic, input.owner ?? null, input.created_by ?? null]
  );
  return hydrate(rows[0]);
}

export async function getInterview(id: string, p: pg.Pool = defaultPool): Promise<Interview | null> {
  const { rows } = await p.query(`select ${COLS} from interviews where id = $1`, [id]);
  return rows[0] ? hydrate(rows[0]) : null;
}

export async function listInterviews(p: pg.Pool = defaultPool): Promise<Interview[]> {
  const { rows } = await p.query(`select ${COLS} from interviews order by created_at desc`);
  return rows.map(hydrate);
}

async function mustGet(id: string, p: pg.Pool): Promise<void> {
  const { rowCount } = await p.query("select 1 from interviews where id = $1", [id]);
  if (!rowCount) throw new NotFoundError(`interview ${id} not found`);
}

export async function appendMessage(
  id: string, msg: { role: InterviewMessage["role"]; content: string }, p: pg.Pool = defaultPool
): Promise<Interview> {
  await mustGet(id, p);
  const entry: InterviewMessage = { ...msg, at: new Date().toISOString() };
  const { rows } = await p.query(
    `update interviews set messages = messages || $2::jsonb, updated_at = now()
     where id = $1 returning ${COLS}`,
    [id, JSON.stringify([entry])]
  );
  return hydrate(rows[0]);
}

export async function setTurnResult(
  id: string, result: { coverage: Coverage; draft?: NewSkill }, p: pg.Pool = defaultPool
): Promise<Interview> {
  await mustGet(id, p);
  const { rows } = await p.query(
    `update interviews set coverage = $2::jsonb,
       draft = coalesce($3::jsonb, draft),
       status = case when $3::jsonb is not null then 'ready' else status end,
       updated_at = now()
     where id = $1 returning ${COLS}`,
    [id, JSON.stringify(result.coverage), result.draft ? JSON.stringify(result.draft) : null]
  );
  return hydrate(rows[0]);
}

export async function completeInterview(
  id: string, skillId: string, p: pg.Pool = defaultPool
): Promise<Interview> {
  await mustGet(id, p);
  const { rows } = await p.query(
    `update interviews set status = 'completed', resulting_skill_id = $2, updated_at = now()
     where id = $1 returning ${COLS}`, [id, skillId]);
  return hydrate(rows[0]);
}

export async function abandonInterview(id: string, p: pg.Pool = defaultPool): Promise<Interview> {
  await mustGet(id, p);
  const { rows } = await p.query(
    `update interviews set status = 'abandoned', updated_at = now()
     where id = $1 returning ${COLS}`, [id]);
  return hydrate(rows[0]);
}
```

- [ ] **Step 4: Run → PASS. Commit** — `feat(server): interviews repo + types`

---

### Task 6: Interview engine — one Structured-Outputs call per turn

**Files:**
- Create: `server/src/interviews/engine.ts`
- Modify: `server/src/llm/schemas.ts` (add + export `INTERVIEW_TURN_JSON_SCHEMA`)
- Test: `server/src/interviews/engine.test.ts`

**Interfaces:**
- Consumes: `LlmClient` seam, `SKILL_JSON_SCHEMA`, interview repo (Task 5), `parseNewSkill`.
- Produces: `runTurn(interview: Interview, llm?: LlmClient, p?: pg.Pool): Promise<Interview>` — reads the transcript, makes ONE LLM call, then either appends the next `brian` question (status stays `active`) or stores the validated draft (status `ready`). Exports `MAX_QUESTIONS = 25`.

**Behavior contract:**
1. Prompt = system interviewer instructions + user message containing topic, owner, transcript, and (when `brian` messages ≥ MAX_QUESTIONS) a forced-finish directive.
2. LLM returns `{status:'asking'|'ready', question: string|null, coverage: {7 booleans}, draft: Skill|null}` via strict Structured Outputs.
3. `asking` → `setTurnResult(coverage)` + `appendMessage({role:'brian', question})`.
4. `ready` → validate draft with `parseNewSkill` (fill `owner` from interview if draft owner null) → `setTurnResult({coverage, draft})`.
5. Zod/parse failure → retry the LLM call once; second failure throws.
6. At the question cap, if the model still says `asking`, throw `new Error("interview exceeded max questions")` (API surfaces 502; UI shows retry).

- [ ] **Step 1: Write failing tests**

`server/src/interviews/engine.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { createInterview, appendMessage, getInterview } from "./repo.js";
import { runTurn, MAX_QUESTIONS } from "./engine.js";
import type { LlmClient } from "../llm/complete.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const askingOut = JSON.stringify({
  status: "asking", question: "What triggers a refund request?",
  coverage: { trigger: false, inputs: false, procedure: false, hard_rules: false,
    guardrails: false, escalation_target: false, examples: false },
  draft: null,
});

const draft = {
  name: "Refund Handling", trigger: "Customer asks for a refund", inputs: ["order_id"],
  procedure: "1. Look up order. 2. Refund if in window.", hard_rules: ["Never refund > $200"],
  tools: ["get_order"], guardrails: ["STOP if > $200"], escalation_target: "Support lead",
  examples: [{ scenario: "s", correct_action: "a" }], owner: null,
};
const readyOut = JSON.stringify({
  status: "ready", question: null,
  coverage: { trigger: true, inputs: true, procedure: true, hard_rules: true,
    guardrails: true, escalation_target: true, examples: true },
  draft,
});

const fake = (outputs: string[]): LlmClient => {
  let i = 0;
  return { complete: vi.fn(async () => outputs[Math.min(i++, outputs.length - 1)]) };
};

d("interview engine", () => {
  beforeAll(async () => { await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("asking turn appends a brian question and stores coverage", async () => {
    const iv = await createInterview({ topic: "refunds" });
    const out = await runTurn(iv, fake([askingOut]));
    expect(out.status).toBe("active");
    expect(out.messages.at(-1)).toMatchObject({ role: "brian", content: "What triggers a refund request?" });
  });

  it("ready turn validates the draft, fills owner from interview, sets status ready", async () => {
    const iv = await createInterview({ topic: "refunds", owner: "Sam" });
    const out = await runTurn(iv, fake([readyOut]));
    expect(out.status).toBe("ready");
    expect(out.draft?.owner).toBe("Sam");
    expect(out.coverage.examples).toBe(true);
  });

  it("retries once on malformed output, then succeeds", async () => {
    const iv = await createInterview({ topic: "refunds" });
    const llm = fake(["not json{{", askingOut]);
    const out = await runTurn(iv, llm);
    expect(out.messages.at(-1)?.content).toBe("What triggers a refund request?");
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it("throws after two malformed outputs", async () => {
    const iv = await createInterview({ topic: "refunds" });
    await expect(runTurn(iv, fake(["bad", "still bad"]))).rejects.toThrow();
  });

  it("forces a finish directive at the question cap and rejects further asking", async () => {
    let iv = await createInterview({ topic: "refunds" });
    for (let i = 0; i < MAX_QUESTIONS; i++) {
      iv = await appendMessage(iv.id, { role: "brian", content: `q${i}` });
    }
    const llm = fake([askingOut]);
    await expect(runTurn((await getInterview(iv.id))!, llm)).rejects.toThrow(/max questions/);
    const promptUser = (llm.complete as any).mock.calls[0][0].user as string;
    expect(promptUser).toMatch(/finish now/i);
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement**

Add to `server/src/llm/schemas.ts` (reusing `SKILL_JSON_SCHEMA`):

```ts
export const INTERVIEW_TURN_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["status", "question", "coverage", "draft"],
  properties: {
    status: { type: "string", enum: ["asking", "ready"] },
    question: { type: ["string", "null"] },
    coverage: {
      type: "object",
      additionalProperties: false,
      required: ["trigger", "inputs", "procedure", "hard_rules", "guardrails", "escalation_target", "examples"],
      properties: {
        trigger: { type: "boolean" }, inputs: { type: "boolean" },
        procedure: { type: "boolean" }, hard_rules: { type: "boolean" },
        guardrails: { type: "boolean" }, escalation_target: { type: "boolean" },
        examples: { type: "boolean" },
      },
    },
    draft: { anyOf: [SKILL_JSON_SCHEMA, { type: "null" }] },
  },
};
```

`server/src/interviews/engine.ts`:

```ts
import { z } from "zod";
import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";
import { INTERVIEW_TURN_JSON_SCHEMA } from "../llm/schemas.js";
import { parseNewSkill } from "../skills/validation.js";
import { appendMessage, setTurnResult } from "./repo.js";
import type { Interview } from "./types.js";

export const MAX_QUESTIONS = 25;

const SYSTEM = `You are Brian, a company-brain interviewer. You are interviewing the person
who owns a business process, to turn their tacit knowledge into an executable skill with:
trigger (when it applies), inputs (info needed), procedure (step-by-step decision logic),
hard_rules (non-negotiable policy), guardrails (when to STOP and escalate),
escalation_target (who to escalate to), and examples (2-3 worked cases).
Ask exactly ONE question at a time — short, concrete, in plain language, like a sharp
consultant. Prefer questions about edge cases and thresholds ("what if it's over $200?").
Track which fields the transcript already covers in "coverage".
When every field is covered, return status "ready" with the complete skill draft,
written so an AI agent can follow it. Do not invent policy the expert did not state.`;

const coverageSchema = z.object({
  trigger: z.boolean(), inputs: z.boolean(), procedure: z.boolean(),
  hard_rules: z.boolean(), guardrails: z.boolean(),
  escalation_target: z.boolean(), examples: z.boolean(),
});
const turnSchema = z.object({
  status: z.enum(["asking", "ready"]),
  question: z.string().nullable(),
  coverage: coverageSchema,
  draft: z.unknown().nullable(),
});

function buildUser(iv: Interview, forceFinish: boolean): string {
  const transcript = iv.messages
    .map((m) => `${m.role === "brian" ? "Brian" : "Expert"}: ${m.content}`)
    .join("\n");
  return [
    `Process being captured: ${iv.topic}`,
    iv.owner ? `Process owner: ${iv.owner}` : "",
    transcript ? `Transcript so far:\n${transcript}` : "No questions asked yet — open the interview.",
    forceFinish
      ? "You have reached the question limit. FINISH NOW: return status \"ready\" with your best complete draft from the transcript."
      : "",
  ].filter(Boolean).join("\n\n");
}

export async function runTurn(
  iv: Interview, llm: LlmClient = defaultLlm(), p: pg.Pool = defaultPool
): Promise<Interview> {
  const questionsAsked = iv.messages.filter((m) => m.role === "brian").length;
  const forceFinish = questionsAsked >= MAX_QUESTIONS;
  const args = {
    system: SYSTEM,
    user: buildUser(iv, forceFinish),
    schema: { name: "interview_turn", schema: INTERVIEW_TURN_JSON_SCHEMA },
  };

  let parsed: z.infer<typeof turnSchema> | null = null;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try {
      parsed = turnSchema.parse(JSON.parse(await llm.complete(args)));
    } catch (e) { lastErr = e; }
  }
  if (!parsed) throw new Error(`interview turn failed: ${String(lastErr)}`);

  if (parsed.status === "ready") {
    const raw = (parsed.draft ?? {}) as Record<string, unknown>;
    const draft = parseNewSkill({ ...raw, owner: raw.owner ?? iv.owner ?? null });
    return setTurnResult(iv.id, { coverage: parsed.coverage, draft }, p);
  }
  if (forceFinish) throw new Error("interview exceeded max questions");
  if (!parsed.question) throw new Error("interview turn failed: asking without a question");
  await setTurnResult(iv.id, { coverage: parsed.coverage }, p);
  return appendMessage(iv.id, { role: "brian", content: parsed.question }, p);
}
```

- [ ] **Step 4: Run → PASS. Commit** — `feat(server): interview engine — one structured-outputs call per turn`

---

### Task 7: Interview REST endpoints

**Files:**
- Modify: `server/src/api/app.ts`
- Test: `server/src/api/interviewApi.test.ts`

**Interfaces:**
- Consumes: repo (Task 5), `runTurn` (Task 6), `createSkill`/`setStatus` from skills repo.
- Produces (all auth-guarded like the rest):

```
POST /api/interviews              {topic, owner?}      → 201 Interview (first brian question already appended)
GET  /api/interviews              → Interview[]
GET  /api/interviews/:id          → Interview | 404
POST /api/interviews/:id/messages {content}            → Interview (next question, or status ready + draft)
POST /api/interviews/:id/approve  {activate?: boolean} → {interview, skill}  (400 unless status ready)
POST /api/interviews/:id/abandon  → Interview
```

Approve semantics: `createSkill(interview.draft)` (arrives as `draft` status) → if `activate !== false` also `setStatus(id,'active')` → `completeInterview`. Engine LLM comes from `opts.llm ?? defaultLlm()` — add optional `llm?: LlmClient` to `AppOptions` so tests inject the fake.

- [ ] **Step 1: Write failing tests**

`server/src/api/interviewApi.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { buildApp } from "./app.js";
import type { LlmClient } from "../llm/complete.js";

const d = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const asking = (q: string) => JSON.stringify({
  status: "asking", question: q,
  coverage: { trigger: true, inputs: false, procedure: false, hard_rules: false,
    guardrails: false, escalation_target: false, examples: false },
  draft: null,
});
const ready = JSON.stringify({
  status: "ready", question: null,
  coverage: { trigger: true, inputs: true, procedure: true, hard_rules: true,
    guardrails: true, escalation_target: true, examples: true },
  draft: {
    name: "Refund Handling", trigger: "refund requested", inputs: ["order_id"],
    procedure: "1. check. 2. refund.", hard_rules: ["never > $200"], tools: [],
    guardrails: ["STOP > $200"], escalation_target: "lead",
    examples: [{ scenario: "s", correct_action: "a" }], owner: null,
  },
});

function appWith(outputs: string[]) {
  let i = 0;
  const llm: LlmClient = { complete: vi.fn(async () => outputs[Math.min(i++, outputs.length - 1)]) };
  return buildApp({ llm });
}

d("interview API", () => {
  beforeAll(async () => { await runMigrations(pool); await pool.query("delete from interviews"); });
  afterAll(async () => { await pool.end(); });

  it("full loop: create → answer → ready → approve activates a skill", async () => {
    const app = appWith([asking("What triggers this?"), ready]);

    const created = await app.inject({ method: "POST", url: "/api/interviews",
      payload: { topic: "refunds", owner: "Sam" } });
    expect(created.statusCode).toBe(201);
    const iv = created.json();
    expect(iv.messages.at(-1)).toMatchObject({ role: "brian", content: "What triggers this?" });

    const answered = await app.inject({ method: "POST", url: `/api/interviews/${iv.id}/messages`,
      payload: { content: "A customer emails asking for money back." } });
    expect(answered.statusCode).toBe(200);
    expect(answered.json().status).toBe("ready");
    expect(answered.json().draft.name).toBe("Refund Handling");

    const approved = await app.inject({ method: "POST", url: `/api/interviews/${iv.id}/approve`,
      payload: { activate: true } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().skill.status).toBe("active");
    expect(approved.json().interview.status).toBe("completed");
    await app.close();
  });

  it("approve on a non-ready interview → 400; unknown id → 404; empty topic → 400", async () => {
    const app = appWith([asking("q?")]);
    const created = await app.inject({ method: "POST", url: "/api/interviews", payload: { topic: "x" } });
    const bad = await app.inject({ method: "POST",
      url: `/api/interviews/${created.json().id}/approve`, payload: {} });
    expect(bad.statusCode).toBe(400);

    const missing = await app.inject({ method: "GET",
      url: "/api/interviews/00000000-0000-0000-0000-000000000000" });
    expect(missing.statusCode).toBe(404);

    const noTopic = await app.inject({ method: "POST", url: "/api/interviews", payload: {} });
    expect(noTopic.statusCode).toBe(400);
    await app.close();
  });

  it("abandon works and list returns interviews", async () => {
    const app = appWith([asking("q?")]);
    const created = await app.inject({ method: "POST", url: "/api/interviews", payload: { topic: "z" } });
    const ab = await app.inject({ method: "POST",
      url: `/api/interviews/${created.json().id}/abandon` });
    expect(ab.json().status).toBe("abandoned");
    const list = await app.inject({ method: "GET", url: "/api/interviews" });
    expect(list.json().length).toBeGreaterThan(0);
    await app.close();
  });
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement routes in `app.ts`**

```ts
import { createInterview, getInterview, listInterviews, appendMessage,
  completeInterview, abandonInterview } from "../interviews/repo.js";
import { runTurn } from "../interviews/engine.js";
import { defaultLlm, type LlmClient } from "../llm/complete.js";

// AppOptions gains: llm?: LlmClient
// in buildApp: const llm = opts.llm ?? defaultLlm();  (lazily: () => opts.llm ?? defaultLlm() — defaultLlm needs no key until called)

app.post("/api/interviews", async (req, reply) => {
  const { topic, owner } = (req.body ?? {}) as { topic?: string; owner?: string };
  if (!topic?.trim()) return reply.code(400).send({ error: "topic is required" });
  const iv = await createInterview({ topic: topic.trim(), owner: owner ?? null,
    created_by: req.user?.id ?? null });
  return reply.code(201).send(await runTurn(iv, llm));
});

app.get("/api/interviews", async () => listInterviews());

app.get("/api/interviews/:id", async (req, reply) => {
  const iv = await getInterview((req.params as any).id);
  if (!iv) return reply.code(404).send({ error: "interview not found" });
  return iv;
});

app.post("/api/interviews/:id/messages", async (req, reply) => {
  const content = (req.body as any)?.content;
  if (typeof content !== "string" || !content.trim()) {
    return reply.code(400).send({ error: "content is required" });
  }
  const iv = await getInterview((req.params as any).id);
  if (!iv) return reply.code(404).send({ error: "interview not found" });
  if (iv.status !== "active") return reply.code(400).send({ error: `interview is ${iv.status}` });
  const withMsg = await appendMessage(iv.id, { role: "expert", content: content.trim() });
  return runTurn(withMsg, llm);
});

app.post("/api/interviews/:id/approve", async (req, reply) => {
  const iv = await getInterview((req.params as any).id);
  if (!iv) return reply.code(404).send({ error: "interview not found" });
  if (iv.status !== "ready" || !iv.draft) {
    return reply.code(400).send({ error: "interview has no draft to approve" });
  }
  const activate = (req.body as any)?.activate !== false;
  let skill = await createSkill(parseNewSkill(iv.draft));
  if (activate) skill = await setStatus(skill.id, "active");
  const interview = await completeInterview(iv.id, skill.id);
  return { interview, skill };
});

app.post("/api/interviews/:id/abandon", async (req, reply) => {
  const iv = await getInterview((req.params as any).id);
  if (!iv) return reply.code(404).send({ error: "interview not found" });
  return abandonInterview(iv.id);
});
```

- [ ] **Step 4: Run full server suite → all PASS. Commit** — `feat(server): interview REST endpoints`

---

### Task 8: Frontend foundation — router, auth store, API client, login page, nav button

**Files:**
- Modify: `package.json` (add `react-router-dom`, `"proxy": "http://localhost:3001"`), `src/App.js`, `src/App.test.js`, `src/sections/Nav.js`
- Create: `src/app/api.js`, `src/app/auth.js`, `src/pages/Login.js`, `src/pages/Login.css`

**Interfaces:**
- Produces:
  - `auth.js`: `getToken()`, `setToken(t)`, `clearToken()`, `isLoggedIn()` (localStorage key `brian_token`).
  - `api.js`: `api(path, {method, body}) → parsed JSON`; sends `Authorization: Bearer <token>`; on 401 clears token and redirects to `/login`; throws `Error(message)` on non-OK.
  - Routes: `/` landing, `/login`, `/app/*` (protected — redirects to `/login` when logged out).
  - Nav gains a "Log in" link to `/login` styled as a ghost button.

- [ ] **Step 1: Install** — `npm i react-router-dom` (repo root); add `"proxy": "http://localhost:3001"` to `package.json`.
- [ ] **Step 2: Write failing test** — replace `src/App.test.js`:

```js
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders landing at /', () => {
  window.history.pushState({}, '', '/');
  render(<App />);
  expect(screen.getAllByText(/Brian/i).length).toBeGreaterThan(0);
});

test('/app redirects to login when logged out', () => {
  localStorage.clear();
  window.history.pushState({}, '', '/app');
  render(<App />);
  expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
});
```

- [ ] **Step 3: Implement**

`src/app/auth.js`:

```js
const KEY = 'brian_token';
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => localStorage.setItem(KEY, t);
export const clearToken = () => localStorage.removeItem(KEY);
export const isLoggedIn = () => Boolean(getToken());
```

`src/app/api.js`:

```js
import { getToken, clearToken } from './auth';

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 401) {
    clearToken();
    window.location.assign('/login');
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}
```

`src/App.js`:

```js
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './HomePage';
import Login from './pages/Login';
import AppLayout from './app/AppLayout';
import SkillsList from './app/views/SkillsList';
import SkillDetail from './app/views/SkillDetail';
import ReviewQueue from './app/views/ReviewQueue';
import Interviews from './app/views/Interviews';
import InterviewChat from './app/views/InterviewChat';
import Capture from './app/views/Capture';
import Executions from './app/views/Executions';
import { isLoggedIn } from './app/auth';

function RequireAuth({ children }) {
  return isLoggedIn() ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<Navigate to="skills" replace />} />
          <Route path="skills" element={<SkillsList />} />
          <Route path="skills/:id" element={<SkillDetail />} />
          <Route path="review" element={<ReviewQueue />} />
          <Route path="interviews" element={<Interviews />} />
          <Route path="interviews/:id" element={<InterviewChat />} />
          <Route path="capture" element={<Capture />} />
          <Route path="executions" element={<Executions />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

(For this task, create `src/app/AppLayout.js` and the six views as minimal stubs rendering their name — Tasks 9–12 fill them in. Stubs keep the router test green.)

`src/pages/Login.js` — email + password form (labels wired via `htmlFor`), error line, submits to `POST /api/auth/login` via `api()`, on success `setToken(token)` + navigate `/app`. Style per landing tokens in `Login.css` (dark card, amber primary button, mono accents).

`src/sections/Nav.js` — before the "Get a demo" anchor add:

```jsx
<a href="/login" className="btn btn--ghost btn--sm nav-login">Log in</a>
```

(`.btn--ghost` exists in HomePage.css; add a `.nav-login` margin rule in `Nav.css` if needed.)

- [ ] **Step 4: Run `npm test -- --watchAll=false` → PASS. Commit** — `feat(ui): router, auth store, login page, nav login button`

---

### Task 9: Dashboard shell + Skills list/detail views

**Files:**
- Create: `src/app/AppLayout.js`, `src/app/Dashboard.css`, `src/app/views/SkillsList.js`, `src/app/views/SkillDetail.js`, shared bits `src/app/components/StatusBadge.js`
- Use the **ui-ux-pro-max skill** for layout/visual decisions before writing these components.

**Interfaces:**
- Consumes: `api()`; REST `GET /api/skills[?status=]`, `GET /api/skills/:id`, `PUT /api/skills/:id`, `POST /api/skills/:id/activate|retire`, `GET /api/skills/:id/versions`.
- Produces: `AppLayout` = fixed sidebar (Skills / Review / Interviews / Capture / Executions + logout) + `<Outlet/>`; `StatusBadge status=` renders colored pill (draft=muted, active=green, needs_review=amber, retired=red).

- [ ] **Step 1:** Invoke ui-ux-pro-max for the dashboard shell design (dark sidebar app, tokens from HomePage.css).
- [ ] **Step 2:** Implement `AppLayout` (sidebar nav with `NavLink`, logout button that clears token → `/login`) and `Dashboard.css` (reuses `:root` tokens: re-declare the token block scoped to `.dash` since HomePage.css scopes styles to `.home`).
- [ ] **Step 3:** `SkillsList`: fetch on mount, status filter chips (all/draft/active/needs_review/retired), table (name → link, owner, status badge, version, last reviewed date), empty + error states.
- [ ] **Step 4:** `SkillDetail`: fetch skill + versions; editable fields (name, trigger, textarea procedure, list editors for inputs/hard_rules/tools/guardrails, examples pairs, owner, escalation_target); Save (PUT), Activate/Retire buttons; version history list (version, changed_by, date).
- [ ] **Step 5:** Manual verify against running API (`npm run api` + `npm start`), then commit — `feat(ui): dashboard shell + skills list/detail`

---

### Task 10: Review queue view

**Files:**
- Create: `src/app/views/ReviewQueue.js`

**Interfaces:**
- Consumes: `GET /api/skills?status=draft`, `GET /api/skills?status=needs_review`, `POST /api/skills/:id/activate`, `POST /api/skills/:id/retire`.
- Produces: queue list (drafts + needs_review, newest first) with expandable detail (all skill fields, read-only) and Approve → activate / Reject → retire buttons; optimistic removal from list on action; count badge data for the sidebar (export `fetchReviewCount()` used by AppLayout).

- [ ] **Step 1:** Implement (two fetches merged, `status` chip per row shows which queue it came from).
- [ ] **Step 2:** Manual verify: create a draft via `POST /api/capture` or the review CLI fixtures, approve it in the UI, confirm status flips in Skills view.
- [ ] **Step 3: Commit** — `feat(ui): review queue (web replacement for review CLI)`

---

### Task 11: Interviews list + chat view (the core feature)

**Files:**
- Create: `src/app/views/Interviews.js`, `src/app/views/InterviewChat.js`, `src/app/views/InterviewChat.css`

**Interfaces:**
- Consumes: interview REST endpoints (Task 7).
- Produces:
  - `Interviews`: list (topic, owner, status badge, last updated) + "New interview" inline form (topic required, owner optional) → POST → navigate to `/app/interviews/:id`.
  - `InterviewChat`: three-region layout — message thread (brian left/accent, expert right), input box (textarea + send, disabled while a turn is in flight, Enter submits), right rail **coverage checklist** (7 fields: Trigger, Inputs, Procedure, Hard rules, Guardrails, Escalation, Examples — checked per `interview.coverage`). When `status === 'ready'`: input is replaced by the **draft panel** (skill fields rendered read-only) with "Approve & activate" (`POST .../approve {activate:true}`), "Save as draft" (`{activate:false}`), both → success note linking to the created skill. "Abandon" secondary action while active. Turn errors show a retry row (re-POST the same message — expert message is already persisted server-side only after success, so retry re-sends content held in client state).

- [ ] **Step 1:** Invoke ui-ux-pro-max for the chat + coverage layout.
- [ ] **Step 2:** Implement both views; keep all state server-driven (each POST returns the full interview).
- [ ] **Step 3:** Manual verify with the real LLM: run an actual interview about a real process end to end → ready → approve → skill visible in Skills list as active.
- [ ] **Step 4: Commit** — `feat(ui): interview mode — chat, live coverage, approve-to-active`

---

### Task 12: Capture + Executions views

**Files:**
- Create: `src/app/views/Capture.js`, `src/app/views/Executions.js`

**Interfaces:**
- Consumes: `POST /api/capture {text}` → `{items:[{kind,action,id,confidence}]}`; `GET /api/executions` → `Execution[]`.
- Produces:
  - `Capture`: big textarea ("Paste anything — meeting notes, a Slack thread, a process description"), submit → result cards per item: kind (skill/context), action (`created_active`/`created_draft`/`updated_active`/`proposed_draft` → human labels like "Saved as active skill", "Draft — waiting in review"), confidence %, link to the skill when kind=skill.
  - `Executions`: read-only table — skill id (linked), outcome badge (completed=green, escalated=amber, failed=red), human override marker, timestamp; newest first.

- [ ] **Step 1:** Implement both.
- [ ] **Step 2:** Manual verify capture with a short pasted note; verify executions renders (seeded data or empty state).
- [ ] **Step 3: Commit** — `feat(ui): capture box + execution log`

---

### Task 13: End-to-end verification + docs

**Files:**
- Modify: `Nextstep.md` (record the milestone), `CompanyBrain.md` API contract section (append interview + auth endpoints)

- [ ] **Step 1:** Backend: full suite `cd server && set -a && . ./.env && set +a && npm test` → all pass.
- [ ] **Step 2:** Frontend: `npm test -- --watchAll=false` → pass; `npm run build` → compiles.
- [ ] **Step 3:** Live e2e: `npm run migrate && npm run seed:admin && npm run api` + `npm start`; log in with the founder account; run one real interview to `ready`; approve & activate; confirm `find_skill` retrieves it (`review CLI or MCP`); check review queue, capture, executions views.
- [ ] **Step 4:** Update docs; commit — `docs: interview mode + dashboard shipped; API contract additions`
