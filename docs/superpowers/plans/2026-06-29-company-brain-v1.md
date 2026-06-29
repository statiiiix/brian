# Company Brain ("Brian") v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the generic Company Brain backend — a TypeScript service that stores company processes as executable "skills," retrieves the right one semantically, lets an agent execute it end-to-end via MCP within hard rules and guardrails, and logs every run so the brain stays current.

**Architecture:** A standalone Node/TypeScript service in `server/`, fully decoupled from the existing CRA UI (they share only the JSON contract). Postgres (Supabase) + pgvector holds skills, version history, and execution logs. OpenAI `text-embedding-3-small` produces 1536-dim embeddings for pgvector `find_skill` search. A Fastify app exposes the REST contract; an MCP server exposes `find_skill`/`get_skill` plus mock business tools so an agent can run one skill end-to-end. Claude (`claude-sonnet-4-6`) drafts skills from pasted company text.

**Tech Stack:** Node 20+, TypeScript, Fastify, `pg`, pgvector, `openai` (embeddings only), `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `zod`, Vitest.

## Global Constraints

- All backend code lives under `server/`. Never modify the root CRA (`src/`, `public/`) — UI is the founder's, contract-only coupling.
- Backend has its **own** `server/package.json`; do not add backend deps to the root CRA package.
- Embeddings: OpenAI `text-embedding-3-small`, **1536** dimensions. The `skills.embedding` column is `vector(1536)`. Never change this dimension without changing both.
- Anthropic model for `draft-from-text`: `claude-sonnet-4-6`. Before writing any Anthropic API call, consult the `claude-api` skill for current SDK usage.
- A skill created by ingestion or `POST /api/skills` is ALWAYS `status: 'draft'`. Skills never auto-activate. Activation is an explicit human action.
- The agent must never act outside a skill's `hard_rules` and must escalate whenever a `guardrails` condition is met.
- Every skill execution writes exactly one row to `executions`.
- Error responses are `{ error: string }` with an appropriate HTTP status. Never leak stack traces or internals.
- Tests mock `embed()` and the Anthropic client — no live OpenAI/Anthropic calls in tests. DB-backed tests run against `TEST_DATABASE_URL`.
- Env vars: `DATABASE_URL`, `TEST_DATABASE_URL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PORT` (default 3001), `STALE_DAYS` (default 30).

---

### Task 0: Backend scaffold

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`
- Create: `server/.env.example`
- Create: `server/.gitignore`
- Create: `server/src/test/smoke.test.ts`

**Interfaces:**
- Produces: a runnable backend project; `npm test` and `npm run build` work from `server/`.

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "brian-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "migrate": "tsx src/db/migrate.ts",
    "seed": "tsx src/seed.ts",
    "api": "tsx src/api/index.ts",
    "mcp": "tsx src/mcp/index.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.65.0",
    "@modelcontextprotocol/sdk": "^1.20.0",
    "fastify": "^5.6.0",
    "openai": "^6.7.0",
    "pg": "^8.16.0",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@types/node": "^24.10.0",
    "@types/pg": "^8.15.0",
    "tsx": "^4.20.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `server/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
```

- [ ] **Step 4: Create `server/.env.example`**

```bash
DATABASE_URL=postgresql://user:pass@host:5432/postgres
TEST_DATABASE_URL=postgresql://user:pass@host:5432/postgres
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
PORT=3001
STALE_DAYS=30
```

- [ ] **Step 5: Create `server/.gitignore`**

```
node_modules
dist
.env
```

- [ ] **Step 6: Write the smoke test `server/src/test/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("scaffold", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Install and run**

Run: `cd server && npm install && npm test`
Expected: smoke test PASSES (1 passed).

- [ ] **Step 8: Commit**

```bash
git add server/package.json server/tsconfig.json server/vitest.config.ts server/.env.example server/.gitignore server/src/test/smoke.test.ts server/package-lock.json
git commit -m "chore: scaffold backend server project"
```

---

### Task 1: Database schema, migrations, and embedding helper (M0)

**Files:**
- Create: `server/src/db/migrations/001_init.sql`
- Create: `server/src/db/pool.ts`
- Create: `server/src/db/migrate.ts`
- Create: `server/src/db/embed.ts`
- Create: `server/src/db/vector.ts`
- Test: `server/src/db/migrate.test.ts`
- Test: `server/src/db/vector.test.ts`

**Interfaces:**
- Produces:
  - `pool: pg.Pool` (from `db/pool.ts`)
  - `runMigrations(p?: Pool): Promise<void>` (from `db/migrate.ts`)
  - `embed(text: string): Promise<number[]>` returns 1536 numbers (from `db/embed.ts`)
  - `toVectorLiteral(v: number[]): string` → `"[0.1,0.2,...]"` (from `db/vector.ts`)

- [ ] **Step 1: Write the schema `server/src/db/migrations/001_init.sql`**

```sql
create extension if not exists vector;

create table if not exists skills (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  trigger           text not null,
  inputs            jsonb not null default '[]',
  procedure         text not null,
  hard_rules        jsonb not null default '[]',
  tools             jsonb not null default '[]',
  guardrails        jsonb not null default '[]',
  escalation_target text,
  examples          jsonb not null default '[]',
  owner             text,
  status            text not null default 'draft',
  version           int  not null default 1,
  last_reviewed_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  embedding         vector(1536)
);

create index if not exists skills_embedding_idx on skills using ivfflat (embedding vector_cosine_ops);

create table if not exists skill_versions (
  id          uuid primary key default gen_random_uuid(),
  skill_id    uuid not null references skills(id),
  version     int not null,
  snapshot    jsonb not null,
  changed_by  text,
  created_at  timestamptz not null default now()
);

create table if not exists skill_links (
  id            uuid primary key default gen_random_uuid(),
  from_skill_id uuid not null references skills(id),
  to_skill_id   uuid not null references skills(id),
  relation      text not null
);

create table if not exists executions (
  id            uuid primary key default gen_random_uuid(),
  skill_id      uuid references skills(id),
  skill_version int,
  task_input    jsonb,
  actions_taken jsonb,
  outcome       text,
  human_override jsonb,
  created_at    timestamptz not null default now()
);
```

- [ ] **Step 2: Write `server/src/db/pool.ts`**

```ts
import pg from "pg";

const { Pool } = pg;

export function makePool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new Pool({ connectionString });
}

export const pool = makePool();
```

- [ ] **Step 3: Write `server/src/db/migrate.ts`**

```ts
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { pool as defaultPool } from "./pool.js";

const here = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(p: pg.Pool = defaultPool): Promise<void> {
  const dir = join(here, "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    await p.query(sql);
  }
}

// Allow `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log("migrations applied");
      return defaultPool.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Write `server/src/db/vector.ts`**

```ts
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
```

- [ ] **Step 5: Write `server/src/db/embed.ts`**

```ts
import OpenAI from "openai";

let client: OpenAI | null = null;
function openai(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

export const EMBED_DIM = 1536;

export async function embed(text: string): Promise<number[]> {
  const res = await openai().embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}
```

- [ ] **Step 6: Write the failing vector test `server/src/db/vector.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { toVectorLiteral } from "./vector.js";

describe("toVectorLiteral", () => {
  it("formats a number array as a pgvector literal", () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });
});
```

- [ ] **Step 7: Write the failing migration test `server/src/db/migrate.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { runMigrations } from "./migrate.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("runMigrations", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await runMigrations(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("creates the core tables", async () => {
    const { rows } = await pool.query(
      `select table_name from information_schema.tables
       where table_schema = 'public'
         and table_name in ('skills','skill_versions','skill_links','executions')`
    );
    const names = rows.map((r) => r.table_name).sort();
    expect(names).toEqual(["executions", "skill_links", "skill_versions", "skills"]);
  });

  it("enables the vector extension", async () => {
    const { rows } = await pool.query(
      `select 1 from pg_extension where extname = 'vector'`
    );
    expect(rows.length).toBe(1);
  });
});
```

- [ ] **Step 8: Run the tests**

Run: `cd server && npm test`
Expected: `vector.test.ts` PASSES. `migrate.test.ts` PASSES if `TEST_DATABASE_URL` is set, otherwise it is SKIPPED (acceptable). If a test DB is available, it must pass.

- [ ] **Step 9: Commit**

```bash
git add server/src/db
git commit -m "feat: db schema, migrations, vector + embedding helpers (M0)"
```

---

### Task 2: Skill types and validation

**Files:**
- Create: `server/src/skills/types.ts`
- Create: `server/src/skills/validation.ts`
- Test: `server/src/skills/validation.test.ts`

**Interfaces:**
- Produces (from `types.ts`):
  - `SkillStatus = "draft" | "active" | "needs_review" | "retired"`
  - `ExecutionOutcome = "completed" | "escalated" | "failed"`
  - `SkillExample { scenario: string; correct_action: string }`
  - `Skill { id; name; trigger; inputs: string[]; procedure; hard_rules: string[]; tools: string[]; guardrails: string[]; escalation_target: string | null; examples: SkillExample[]; owner: string | null; status: SkillStatus; version: number; last_reviewed_at: string | null; created_at: string; updated_at: string }`
  - `SkillVersion { id; skill_id; version; snapshot: Skill; changed_by: string | null; created_at: string }`
  - `Execution { id; skill_id: string | null; skill_version: number | null; task_input: unknown; actions_taken: unknown; outcome: ExecutionOutcome | null; human_override: unknown; created_at: string }`
  - `NewSkill` = the create-input shape (no id/version/timestamps)
- Produces (from `validation.ts`):
  - `newSkillSchema: z.ZodType<NewSkill>`
  - `updateSkillSchema: z.ZodType<Partial<NewSkill>>`
  - `parseNewSkill(body: unknown): NewSkill` (throws `ValidationError` on failure)
  - `parseUpdateSkill(body: unknown): Partial<NewSkill>`
  - `class ValidationError extends Error { issues: string[] }`

- [ ] **Step 1: Write `server/src/skills/types.ts`**

```ts
export type SkillStatus = "draft" | "active" | "needs_review" | "retired";
export type ExecutionOutcome = "completed" | "escalated" | "failed";

export interface SkillExample {
  scenario: string;
  correct_action: string;
}

export interface Skill {
  id: string;
  name: string;
  trigger: string;
  inputs: string[];
  procedure: string;
  hard_rules: string[];
  tools: string[];
  guardrails: string[];
  escalation_target: string | null;
  examples: SkillExample[];
  owner: string | null;
  status: SkillStatus;
  version: number;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewSkill {
  name: string;
  trigger: string;
  inputs: string[];
  procedure: string;
  hard_rules: string[];
  tools: string[];
  guardrails: string[];
  escalation_target: string | null;
  examples: SkillExample[];
  owner: string | null;
}

export interface SkillVersion {
  id: string;
  skill_id: string;
  version: number;
  snapshot: Skill;
  changed_by: string | null;
  created_at: string;
}

export interface Execution {
  id: string;
  skill_id: string | null;
  skill_version: number | null;
  task_input: unknown;
  actions_taken: unknown;
  outcome: ExecutionOutcome | null;
  human_override: unknown;
  created_at: string;
}
```

- [ ] **Step 2: Write `server/src/skills/validation.ts`**

```ts
import { z } from "zod";
import type { NewSkill } from "./types.js";

export class ValidationError extends Error {
  issues: string[];
  constructor(issues: string[]) {
    super("validation failed");
    this.name = "ValidationError";
    this.issues = issues;
  }
}

const exampleSchema = z.object({
  scenario: z.string().min(1),
  correct_action: z.string().min(1),
});

export const newSkillSchema = z.object({
  name: z.string().min(1),
  trigger: z.string().min(1),
  inputs: z.array(z.string()).default([]),
  procedure: z.string().min(1),
  hard_rules: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  guardrails: z.array(z.string()).default([]),
  escalation_target: z.string().nullable().default(null),
  examples: z.array(exampleSchema).default([]),
  owner: z.string().nullable().default(null),
});

export const updateSkillSchema = newSkillSchema.partial();

function format(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

export function parseNewSkill(body: unknown): NewSkill {
  const r = newSkillSchema.safeParse(body);
  if (!r.success) throw new ValidationError(format(r.error));
  return r.data as NewSkill;
}

export function parseUpdateSkill(body: unknown): Partial<NewSkill> {
  const r = updateSkillSchema.safeParse(body);
  if (!r.success) throw new ValidationError(format(r.error));
  return r.data as Partial<NewSkill>;
}
```

- [ ] **Step 3: Write the failing test `server/src/skills/validation.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseNewSkill, parseUpdateSkill, ValidationError } from "./validation.js";

describe("parseNewSkill", () => {
  it("accepts a minimal valid skill and fills array defaults", () => {
    const s = parseNewSkill({ name: "Refunds", trigger: "refund request", procedure: "do it" });
    expect(s.name).toBe("Refunds");
    expect(s.inputs).toEqual([]);
    expect(s.hard_rules).toEqual([]);
    expect(s.escalation_target).toBeNull();
  });

  it("rejects a skill missing required fields", () => {
    expect(() => parseNewSkill({ name: "" })).toThrow(ValidationError);
  });

  it("collects human-readable issues", () => {
    try {
      parseNewSkill({});
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});

describe("parseUpdateSkill", () => {
  it("allows partial patches", () => {
    const p = parseUpdateSkill({ procedure: "new steps" });
    expect(p.procedure).toBe("new steps");
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `cd server && npm test -- validation`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/skills/types.ts server/src/skills/validation.ts server/src/skills/validation.test.ts
git commit -m "feat: skill types and zod validation"
```

---

### Task 3: Skill repository — CRUD, embedding on write, version history (M1)

**Files:**
- Create: `server/src/skills/repo.ts`
- Test: `server/src/skills/repo.test.ts`

**Interfaces:**
- Consumes: `pool` (db/pool), `embed` (db/embed), `toVectorLiteral` (db/vector), types + `NewSkill`.
- Produces (from `repo.ts`), all taking an optional final `p: pg.Pool` arg defaulting to `pool`:
  - `createSkill(input: NewSkill, p?): Promise<Skill>` — inserts `status:'draft'`, `version:1`, embeds `name+trigger+procedure`.
  - `getSkill(id: string, p?): Promise<Skill | null>`
  - `listSkills(status?: SkillStatus, p?): Promise<Skill[]>`
  - `updateSkill(id: string, patch: Partial<NewSkill>, changedBy: string | null, p?): Promise<Skill>` — snapshots current row into `skill_versions`, applies patch, bumps `version`, re-embeds if `name/trigger/procedure` changed, sets `updated_at=now()`.
  - `setStatus(id: string, status: SkillStatus, p?): Promise<Skill>` — also sets `last_reviewed_at=now()` when status becomes `active`.
  - `listVersions(id: string, p?): Promise<SkillVersion[]>`
  - `class NotFoundError extends Error`

- [ ] **Step 1: Write `server/src/skills/repo.ts`**

```ts
import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import { embed } from "../db/embed.js";
import { toVectorLiteral } from "../db/vector.js";
import type { NewSkill, Skill, SkillStatus, SkillVersion } from "./types.js";

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`skill not found: ${id}`);
    this.name = "NotFoundError";
  }
}

const SKILL_COLUMNS = `id, name, trigger, inputs, procedure, hard_rules, tools,
  guardrails, escalation_target, examples, owner, status, version,
  last_reviewed_at, created_at, updated_at`;

function iso(v: Date | null): string | null {
  return v ? new Date(v).toISOString() : null;
}

function rowToSkill(r: any): Skill {
  return {
    id: r.id,
    name: r.name,
    trigger: r.trigger,
    inputs: r.inputs,
    procedure: r.procedure,
    hard_rules: r.hard_rules,
    tools: r.tools,
    guardrails: r.guardrails,
    escalation_target: r.escalation_target,
    examples: r.examples,
    owner: r.owner,
    status: r.status,
    version: r.version,
    last_reviewed_at: iso(r.last_reviewed_at),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
  };
}

function embedText(s: Pick<Skill, "name" | "trigger" | "procedure">): string {
  return `${s.name}\n${s.trigger}\n${s.procedure}`;
}

export async function createSkill(input: NewSkill, p: pg.Pool = defaultPool): Promise<Skill> {
  const vec = toVectorLiteral(await embed(embedText(input)));
  const { rows } = await p.query(
    `insert into skills
      (name, trigger, inputs, procedure, hard_rules, tools, guardrails,
       escalation_target, examples, owner, status, version, embedding)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',1,$11::vector)
     returning ${SKILL_COLUMNS}`,
    [
      input.name, input.trigger, JSON.stringify(input.inputs), input.procedure,
      JSON.stringify(input.hard_rules), JSON.stringify(input.tools),
      JSON.stringify(input.guardrails), input.escalation_target,
      JSON.stringify(input.examples), input.owner, vec,
    ]
  );
  return rowToSkill(rows[0]);
}

export async function getSkill(id: string, p: pg.Pool = defaultPool): Promise<Skill | null> {
  const { rows } = await p.query(`select ${SKILL_COLUMNS} from skills where id = $1`, [id]);
  return rows[0] ? rowToSkill(rows[0]) : null;
}

export async function listSkills(status?: SkillStatus, p: pg.Pool = defaultPool): Promise<Skill[]> {
  const { rows } = status
    ? await p.query(`select ${SKILL_COLUMNS} from skills where status = $1 order by updated_at desc`, [status])
    : await p.query(`select ${SKILL_COLUMNS} from skills order by updated_at desc`);
  return rows.map(rowToSkill);
}

export async function listVersions(id: string, p: pg.Pool = defaultPool): Promise<SkillVersion[]> {
  const { rows } = await p.query(
    `select id, skill_id, version, snapshot, changed_by, created_at
     from skill_versions where skill_id = $1 order by version desc`,
    [id]
  );
  return rows.map((r) => ({
    id: r.id, skill_id: r.skill_id, version: r.version,
    snapshot: r.snapshot, changed_by: r.changed_by, created_at: iso(r.created_at)!,
  }));
}

export async function updateSkill(
  id: string,
  patch: Partial<NewSkill>,
  changedBy: string | null,
  p: pg.Pool = defaultPool
): Promise<Skill> {
  const client = await p.connect();
  try {
    await client.query("begin");
    const cur = await getSkill(id, p);
    if (!cur) throw new NotFoundError(id);

    // snapshot the current state before changing it
    await client.query(
      `insert into skill_versions (skill_id, version, snapshot, changed_by)
       values ($1,$2,$3,$4)`,
      [id, cur.version, JSON.stringify(cur), changedBy]
    );

    const next = { ...cur, ...patch } as Skill;
    const reembed =
      patch.name !== undefined || patch.trigger !== undefined || patch.procedure !== undefined;
    const vec = reembed ? toVectorLiteral(await embed(embedText(next))) : null;

    const { rows } = await client.query(
      `update skills set
         name=$2, trigger=$3, inputs=$4, procedure=$5, hard_rules=$6, tools=$7,
         guardrails=$8, escalation_target=$9, examples=$10, owner=$11,
         version=version+1, updated_at=now(),
         embedding = coalesce($12::vector, embedding)
       where id=$1
       returning ${SKILL_COLUMNS}`,
      [
        id, next.name, next.trigger, JSON.stringify(next.inputs), next.procedure,
        JSON.stringify(next.hard_rules), JSON.stringify(next.tools),
        JSON.stringify(next.guardrails), next.escalation_target,
        JSON.stringify(next.examples), next.owner, vec,
      ]
    );
    await client.query("commit");
    return rowToSkill(rows[0]);
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function setStatus(
  id: string,
  status: SkillStatus,
  p: pg.Pool = defaultPool
): Promise<Skill> {
  const { rows } = await p.query(
    `update skills set status=$2,
       last_reviewed_at = case when $2 = 'active' then now() else last_reviewed_at end,
       updated_at = now()
     where id=$1 returning ${SKILL_COLUMNS}`,
    [id, status]
  );
  if (!rows[0]) throw new NotFoundError(id);
  return rowToSkill(rows[0]);
}
```

- [ ] **Step 2: Write the failing test `server/src/skills/repo.test.ts`**

This test mocks `embed()` so no OpenAI call happens, and uses `TEST_DATABASE_URL`. It cleans the tables before each run.

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { createSkill, getSkill, listSkills, updateSkill, setStatus, listVersions } from "./repo.js";
import type { NewSkill } from "./types.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const sample: NewSkill = {
  name: "Refund Handling",
  trigger: "A customer requests a refund on a past order.",
  inputs: ["order_id", "customer_email", "reason"],
  procedure: "Look up the order, check the window, refund if valid.",
  hard_rules: ["Never refund an order older than 90 days."],
  tools: ["get_order", "issue_refund"],
  guardrails: ["If refund amount > $200, STOP and escalate."],
  escalation_target: "Support team lead",
  examples: [{ scenario: "$40 order, 5 days old", correct_action: "issue $40 refund" }],
  owner: "Support team lead",
};

d("skill repo", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await runMigrations(pool);
  });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query("delete from skill_versions");
    await pool.query("delete from executions");
    await pool.query("delete from skill_links");
    await pool.query("delete from skills");
  });

  it("creates a skill as draft v1", async () => {
    const s = await createSkill(sample, pool);
    expect(s.status).toBe("draft");
    expect(s.version).toBe(1);
    expect(s.inputs).toEqual(["order_id", "customer_email", "reason"]);
    expect(await getSkill(s.id, pool)).not.toBeNull();
  });

  it("lists by status", async () => {
    const s = await createSkill(sample, pool);
    await setStatus(s.id, "active", pool);
    expect((await listSkills("active", pool)).length).toBe(1);
    expect((await listSkills("draft", pool)).length).toBe(0);
  });

  it("activating sets last_reviewed_at", async () => {
    const s = await createSkill(sample, pool);
    const a = await setStatus(s.id, "active", pool);
    expect(a.status).toBe("active");
    expect(a.last_reviewed_at).not.toBeNull();
  });

  it("update snapshots prior version and bumps version", async () => {
    const s = await createSkill(sample, pool);
    const u = await updateSkill(s.id, { procedure: "new steps" }, "tester", pool);
    expect(u.version).toBe(2);
    expect(u.procedure).toBe("new steps");
    const versions = await listVersions(s.id, pool);
    expect(versions.length).toBe(1);
    expect(versions[0].version).toBe(1);
    expect((versions[0].snapshot as any).procedure).toBe(sample.procedure);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `cd server && npm test -- repo`
Expected: PASS with `TEST_DATABASE_URL` set (else SKIPPED). With a DB, all assertions pass.

- [ ] **Step 4: Commit**

```bash
git add server/src/skills/repo.ts server/src/skills/repo.test.ts
git commit -m "feat: skill repository with embedding-on-write and version history (M1)"
```

---

### Task 4: REST API — CRUD, activate, retire, versions (M1 + part of M5)

**Files:**
- Create: `server/src/api/app.ts`
- Create: `server/src/api/index.ts`
- Test: `server/src/api/app.test.ts`

**Interfaces:**
- Consumes: repo functions, `parseNewSkill`/`parseUpdateSkill`/`ValidationError`.
- Produces:
  - `buildApp(): FastifyInstance` (from `app.ts`) wiring these routes:
    - `GET /api/skills?status=` → `Skill[]`
    - `GET /api/skills/:id` → `Skill` or `404 { error }`
    - `POST /api/skills` → `Skill` (draft); `400 { error }` on invalid
    - `PUT /api/skills/:id` → `Skill`; `404`/`400`
    - `POST /api/skills/:id/activate` → `Skill`
    - `POST /api/skills/:id/retire` → `Skill`
    - `GET /api/skills/:id/versions` → `SkillVersion[]`
  - `index.ts` calls `buildApp().listen({ port: PORT })`.

- [ ] **Step 1: Write `server/src/api/app.ts`**

```ts
import Fastify, { type FastifyInstance } from "fastify";
import {
  createSkill, getSkill, listSkills, updateSkill, setStatus, listVersions, NotFoundError,
} from "../skills/repo.js";
import { parseNewSkill, parseUpdateSkill, ValidationError } from "../skills/validation.js";
import type { SkillStatus } from "../skills/types.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) return reply.code(400).send({ error: err.issues.join("; ") });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    reply.code(500).send({ error: "internal error" });
  });

  app.get("/api/skills", async (req) => {
    const status = (req.query as any)?.status as SkillStatus | undefined;
    return listSkills(status);
  });

  app.get("/api/skills/:id", async (req, reply) => {
    const s = await getSkill((req.params as any).id);
    if (!s) return reply.code(404).send({ error: "skill not found" });
    return s;
  });

  app.post("/api/skills", async (req, reply) => {
    const input = parseNewSkill(req.body);
    const s = await createSkill(input);
    return reply.code(201).send(s);
  });

  app.put("/api/skills/:id", async (req) => {
    const patch = parseUpdateSkill(req.body);
    return updateSkill((req.params as any).id, patch, "api", undefined);
  });

  app.post("/api/skills/:id/activate", async (req) =>
    setStatus((req.params as any).id, "active"));

  app.post("/api/skills/:id/retire", async (req) =>
    setStatus((req.params as any).id, "retired"));

  app.get("/api/skills/:id/versions", async (req) =>
    listVersions((req.params as any).id));

  return app;
}
```

- [ ] **Step 2: Write `server/src/api/index.ts`**

```ts
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
buildApp()
  .listen({ port, host: "0.0.0.0" })
  .then((addr) => console.log(`API listening on ${addr}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 3: Write the failing test `server/src/api/app.test.ts`**

Uses Fastify's `inject` (no network). `embed` mocked; DB-backed.

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { buildApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const valid = { name: "Refunds", trigger: "refund request", procedure: "do the steps" };

d("API", () => {
  const app = buildApp();
  beforeAll(async () => { await runMigrations(pool); await app.ready(); });
  afterAll(async () => { await app.close(); await pool.end(); });
  beforeEach(async () => {
    await pool.query("delete from skill_versions");
    await pool.query("delete from skills");
  });

  it("creates a draft skill via POST", async () => {
    const res = await app.inject({ method: "POST", url: "/api/skills", payload: valid });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("draft");
  });

  it("rejects invalid input with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/skills", payload: { name: "" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBeTruthy();
  });

  it("404s an unknown skill", async () => {
    const res = await app.inject({ method: "GET", url: "/api/skills/00000000-0000-0000-0000-000000000000" });
    expect(res.statusCode).toBe(404);
  });

  it("activates a skill", async () => {
    const created = (await app.inject({ method: "POST", url: "/api/skills", payload: valid })).json();
    const res = await app.inject({ method: "POST", url: `/api/skills/${created.id}/activate` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("active");
  });

  it("returns version history after an edit", async () => {
    const created = (await app.inject({ method: "POST", url: "/api/skills", payload: valid })).json();
    await app.inject({ method: "PUT", url: `/api/skills/${created.id}`, payload: { procedure: "v2 steps" } });
    const res = await app.inject({ method: "GET", url: `/api/skills/${created.id}/versions` });
    expect(res.json().length).toBe(1);
  });
});
```

- [ ] **Step 4: Run the tests**

Run: `cd server && npm test -- app`
Expected: PASS with `TEST_DATABASE_URL` (else SKIPPED).

- [ ] **Step 5: Commit**

```bash
git add server/src/api
git commit -m "feat: REST API for skill CRUD, activate/retire, versions (M1)"
```

---

### Task 5: Semantic retrieval — find_skill via pgvector (M2)

**Files:**
- Modify: `server/src/skills/repo.ts` (add `findSkill`)
- Test: `server/src/skills/find.test.ts`

**Interfaces:**
- Produces (from `repo.ts`):
  - `findSkill(query: string, p?): Promise<Skill | null>` — embeds the query, returns the single best-matching `active` skill by cosine distance, or `null` if there are no active skills.

- [ ] **Step 1: Add `findSkill` to `server/src/skills/repo.ts`** (append after `setStatus`)

```ts
export async function findSkill(query: string, p: pg.Pool = defaultPool): Promise<Skill | null> {
  const vec = toVectorLiteral(await embed(query));
  const { rows } = await p.query(
    `select ${SKILL_COLUMNS}
     from skills
     where status = 'active'
     order by embedding <=> $1::vector
     limit 1`,
    [vec]
  );
  return rows[0] ? rowToSkill(rows[0]) : null;
}
```

- [ ] **Step 2: Write the failing test `server/src/skills/find.test.ts`**

Mocks `embed` so that different texts map to distinct vectors, proving the nearest-neighbour query selects the right skill.

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Deterministic fake embeddings: a sparse one-hot-ish vector per keyword.
function fakeVec(text: string): number[] {
  const v = Array.from({ length: 1536 }, () => 0);
  if (/refund/i.test(text)) v[0] = 1;
  if (/incident|outage|sev/i.test(text)) v[1] = 1;
  return v;
}
vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async (t: string) => fakeVec(t)),
}));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { createSkill, setStatus, findSkill } from "./repo.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("findSkill", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query("delete from skill_versions");
    await pool.query("delete from skills");
  });

  it("returns the active skill whose trigger matches the query", async () => {
    const refund = await createSkill(
      { name: "Refund Handling", trigger: "customer wants a refund", inputs: [], procedure: "refund flow",
        hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    const incident = await createSkill(
      { name: "Incident Response", trigger: "production outage sev-2", inputs: [], procedure: "incident flow",
        hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    await setStatus(refund.id, "active", pool);
    await setStatus(incident.id, "active", pool);

    const hit = await findSkill("a customer is asking for a refund", pool);
    expect(hit?.name).toBe("Refund Handling");
  });

  it("ignores non-active skills", async () => {
    const refund = await createSkill(
      { name: "Refund Handling", trigger: "customer wants a refund", inputs: [], procedure: "refund flow",
        hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    // left as draft
    const hit = await findSkill("refund please", pool);
    expect(hit).toBeNull();
    expect(refund.status).toBe("draft");
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `cd server && npm test -- find`
Expected: PASS with `TEST_DATABASE_URL` (else SKIPPED).

- [ ] **Step 4: Commit**

```bash
git add server/src/skills/repo.ts server/src/skills/find.test.ts
git commit -m "feat: semantic find_skill via pgvector cosine search (M2)"
```

---

### Task 6: MCP server, mock business tools, and the end-to-end execution loop (M3) — win condition

**Files:**
- Create: `server/src/mcp/businessTools.ts`
- Create: `server/src/mcp/server.ts`
- Create: `server/src/mcp/index.ts`
- Test: `server/src/mcp/businessTools.test.ts`
- Test: `server/src/mcp/loop.test.ts`

**Interfaces:**
- Consumes: `findSkill`, `getSkill`, `createSkill`, `setStatus`, `logExecution` (defined in Task 7 — see note).
- Produces (from `businessTools.ts`):
  - `getOrder(orderId: string): Order | null` where `Order = { id: string; amount: number; placed_at: string; account_email: string; plan: "standard" | "enterprise" }`
  - `issueRefund(orderId: string, amount: number): { refunded: boolean; order_id: string; amount: number }`
  - `ORDERS: Record<string, Order>` fixtures
- Produces (from `server.ts`):
  - `buildMcpServer(): McpServer` registering tools `find_skill`, `get_skill`, `get_order`, `issue_refund`.

> **Sequencing note:** `loop.test.ts` imports `logExecution` from Task 7. Implement Task 7's `feedback/executions.ts` first if executing strictly top-to-bottom, OR stub `logExecution` here and replace in Task 7. Recommended: do Task 7 Step 1–2 (the `logExecution` function) before this task's `loop.test.ts`. The plan orders MCP first because it is the milestone that matters; the dependency is one function.

- [ ] **Step 1: Write `server/src/mcp/businessTools.ts`**

```ts
export interface Order {
  id: string;
  amount: number;
  placed_at: string; // ISO
  account_email: string;
  plan: "standard" | "enterprise";
}

export const ORDERS: Record<string, Order> = {
  "ORD-1": { id: "ORD-1", amount: 40, placed_at: "2026-06-24T00:00:00Z", account_email: "a@example.com", plan: "standard" },
  "ORD-2": { id: "ORD-2", amount: 350, placed_at: "2026-06-20T00:00:00Z", account_email: "b@example.com", plan: "standard" },
  "ORD-3": { id: "ORD-3", amount: 90, placed_at: "2026-06-10T00:00:00Z", account_email: "c@example.com", plan: "enterprise" },
};

export function getOrder(orderId: string): Order | null {
  return ORDERS[orderId] ?? null;
}

export function issueRefund(orderId: string, amount: number) {
  return { refunded: true, order_id: orderId, amount };
}
```

- [ ] **Step 2: Write the failing test `server/src/mcp/businessTools.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { getOrder, issueRefund } from "./businessTools.js";

describe("business tools", () => {
  it("looks up a known order", () => {
    expect(getOrder("ORD-1")?.amount).toBe(40);
  });
  it("returns null for an unknown order", () => {
    expect(getOrder("NOPE")).toBeNull();
  });
  it("issues a refund", () => {
    expect(issueRefund("ORD-1", 40)).toEqual({ refunded: true, order_id: "ORD-1", amount: 40 });
  });
});
```

- [ ] **Step 3: Run it**

Run: `cd server && npm test -- businessTools`
Expected: PASS.

- [ ] **Step 4: Write `server/src/mcp/server.ts`**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findSkill, getSkill } from "../skills/repo.js";
import { getOrder, issueRefund } from "./businessTools.js";

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "brian", version: "0.1.0" });

  server.registerTool(
    "find_skill",
    {
      description: "Find the best-matching active skill for a natural-language task.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      const skill = await findSkill(query);
      return {
        content: [{ type: "text", text: skill ? JSON.stringify(skill) : "NO_MATCHING_SKILL" }],
      };
    }
  );

  server.registerTool(
    "get_skill",
    { description: "Fetch a skill by id.", inputSchema: { id: z.string() } },
    async ({ id }) => {
      const skill = await getSkill(id);
      return { content: [{ type: "text", text: skill ? JSON.stringify(skill) : "NOT_FOUND" }] };
    }
  );

  server.registerTool(
    "get_order",
    { description: "Look up an order by id.", inputSchema: { order_id: z.string() } },
    async ({ order_id }) => {
      const order = getOrder(order_id);
      return { content: [{ type: "text", text: order ? JSON.stringify(order) : "NOT_FOUND" }] };
    }
  );

  server.registerTool(
    "issue_refund",
    {
      description: "Issue a refund for an order.",
      inputSchema: { order_id: z.string(), amount: z.number() },
    },
    async ({ order_id, amount }) => {
      return { content: [{ type: "text", text: JSON.stringify(issueRefund(order_id, amount)) }] };
    }
  );

  return server;
}
```

- [ ] **Step 5: Write `server/src/mcp/index.ts`**

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildMcpServer } from "./server.js";

const server = buildMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Brian MCP server running on stdio");
```

- [ ] **Step 6: Write the end-to-end loop test `server/src/mcp/loop.test.ts`**

This is the **win condition**: it drives the documented execution flow against a seeded refund skill — once for a case that completes, once for a case that trips a guardrail — and asserts an `executions` row is written with the right outcome each time. It calls the same functions the MCP tools call, plus a small `runRefund` harness that encodes the agent's guardrail check.

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))),
}));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { createSkill, setStatus, findSkill } from "../skills/repo.js";
import { logExecution, listExecutions } from "../feedback/executions.js";
import { getOrder, issueRefund } from "./businessTools.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

// Minimal agent harness: it reads the skill's guardrails and obeys them.
async function runRefund(pool: pg.Pool, task: { order_id: string }) {
  const skill = await findSkill("customer wants a refund", pool);
  if (!skill) throw new Error("no skill");
  const order = getOrder(task.order_id);
  const actions: unknown[] = [{ tool: "get_order", args: task, result: order }];

  // guardrails: order not found, > $200, enterprise plan -> escalate
  const escalate = !order || order.amount > 200 || order.plan === "enterprise";
  let outcome: "completed" | "escalated";
  if (escalate) {
    outcome = "escalated";
  } else {
    const refund = issueRefund(order!.id, order!.amount);
    actions.push({ tool: "issue_refund", args: { order_id: order!.id, amount: order!.amount }, result: refund });
    outcome = "completed";
  }
  await logExecution(
    { skill_id: skill.id, skill_version: skill.version, task_input: task, actions_taken: actions, outcome, human_override: null },
    pool
  );
  return { outcome, skillId: skill.id };
}

d("end-to-end execution loop (M3)", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await runMigrations(pool);
  });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query("delete from executions");
    await pool.query("delete from skill_versions");
    await pool.query("delete from skills");
    const s = await createSkill(
      {
        name: "Refund Handling",
        trigger: "A customer requests a refund on a past order.",
        inputs: ["order_id"],
        procedure: "Look up order; if within rules and under guardrails, refund; else escalate.",
        hard_rules: ["Never refund more than $200 without manager approval."],
        tools: ["get_order", "issue_refund"],
        guardrails: ["If refund amount > $200, STOP and escalate.", "If the customer is on an enterprise plan, STOP and escalate.", "If the order cannot be found, STOP and escalate."],
        escalation_target: "Support team lead",
        examples: [],
        owner: "Support team lead",
      },
      pool
    );
    await setStatus(s.id, "active", pool);
  });

  it("completes a small in-policy refund and logs it", async () => {
    const r = await runRefund(pool, { order_id: "ORD-1" }); // $40 standard
    expect(r.outcome).toBe("completed");
    const log = await listExecutions(r.skillId, pool);
    expect(log.length).toBe(1);
    expect(log[0].outcome).toBe("completed");
  });

  it("escalates when a guardrail trips (> $200) and logs it", async () => {
    const r = await runRefund(pool, { order_id: "ORD-2" }); // $350
    expect(r.outcome).toBe("escalated");
    const log = await listExecutions(r.skillId, pool);
    expect(log[0].outcome).toBe("escalated");
  });

  it("escalates for an enterprise customer", async () => {
    const r = await runRefund(pool, { order_id: "ORD-3" }); // enterprise
    expect(r.outcome).toBe("escalated");
  });
});
```

- [ ] **Step 7: Run the loop test (after Task 7 Step 1–2 exist)**

Run: `cd server && npm test -- loop`
Expected: PASS with `TEST_DATABASE_URL` (else SKIPPED). This is the milestone gate.

- [ ] **Step 8: Commit**

```bash
git add server/src/mcp
git commit -m "feat: MCP server, mock business tools, end-to-end execution loop (M3)"
```

---

### Task 7: Execution logging + executions endpoints (M4)

**Files:**
- Create: `server/src/feedback/executions.ts`
- Modify: `server/src/api/app.ts` (add two routes)
- Test: `server/src/feedback/executions.test.ts`

**Interfaces:**
- Produces (from `executions.ts`):
  - `interface NewExecution { skill_id: string | null; skill_version: number | null; task_input: unknown; actions_taken: unknown; outcome: ExecutionOutcome; human_override: unknown }`
  - `logExecution(row: NewExecution, p?): Promise<Execution>`
  - `listExecutions(skillId?: string, p?): Promise<Execution[]>` — recent first; filtered by skill when `skillId` given.
- Adds routes: `GET /api/skills/:id/executions`, `GET /api/executions`.

- [ ] **Step 1: Write `server/src/feedback/executions.ts`**

```ts
import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import type { Execution, ExecutionOutcome } from "../skills/types.js";

export interface NewExecution {
  skill_id: string | null;
  skill_version: number | null;
  task_input: unknown;
  actions_taken: unknown;
  outcome: ExecutionOutcome;
  human_override: unknown;
}

function rowToExecution(r: any): Execution {
  return {
    id: r.id,
    skill_id: r.skill_id,
    skill_version: r.skill_version,
    task_input: r.task_input,
    actions_taken: r.actions_taken,
    outcome: r.outcome,
    human_override: r.human_override,
    created_at: new Date(r.created_at).toISOString(),
  };
}

export async function logExecution(row: NewExecution, p: pg.Pool = defaultPool): Promise<Execution> {
  const { rows } = await p.query(
    `insert into executions (skill_id, skill_version, task_input, actions_taken, outcome, human_override)
     values ($1,$2,$3,$4,$5,$6)
     returning id, skill_id, skill_version, task_input, actions_taken, outcome, human_override, created_at`,
    [
      row.skill_id, row.skill_version, JSON.stringify(row.task_input),
      JSON.stringify(row.actions_taken), row.outcome,
      row.human_override === null ? null : JSON.stringify(row.human_override),
    ]
  );
  return rowToExecution(rows[0]);
}

export async function listExecutions(skillId?: string, p: pg.Pool = defaultPool): Promise<Execution[]> {
  const { rows } = skillId
    ? await p.query(
        `select id, skill_id, skill_version, task_input, actions_taken, outcome, human_override, created_at
         from executions where skill_id = $1 order by created_at desc limit 200`, [skillId])
    : await p.query(
        `select id, skill_id, skill_version, task_input, actions_taken, outcome, human_override, created_at
         from executions order by created_at desc limit 200`);
  return rows.map(rowToExecution);
}
```

- [ ] **Step 2: Write the failing test `server/src/feedback/executions.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { createSkill } from "../skills/repo.js";
import { logExecution, listExecutions } from "./executions.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("executions", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    await pool.query("delete from executions");
    await pool.query("delete from skills");
  });

  it("logs and lists an execution for a skill", async () => {
    const s = await createSkill(
      { name: "X", trigger: "t", inputs: [], procedure: "p", hard_rules: [], tools: [],
        guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    await logExecution(
      { skill_id: s.id, skill_version: 1, task_input: { order_id: "ORD-1" },
        actions_taken: [{ tool: "get_order" }], outcome: "completed", human_override: null }, pool);
    const log = await listExecutions(s.id, pool);
    expect(log.length).toBe(1);
    expect(log[0].outcome).toBe("completed");
    expect((log[0].task_input as any).order_id).toBe("ORD-1");
  });
});
```

- [ ] **Step 3: Add the two routes to `server/src/api/app.ts`**

Add these imports at the top:

```ts
import { listExecutions } from "../feedback/executions.js";
```

Add these routes inside `buildApp`, before `return app;`:

```ts
  app.get("/api/skills/:id/executions", async (req) =>
    listExecutions((req.params as any).id));

  app.get("/api/executions", async () => listExecutions());
```

- [ ] **Step 4: Run the tests**

Run: `cd server && npm test -- executions`
Expected: PASS with `TEST_DATABASE_URL` (else SKIPPED). Re-run `npm test -- loop` and confirm the M3 loop test now passes end-to-end.

- [ ] **Step 5: Commit**

```bash
git add server/src/feedback/executions.ts server/src/feedback/executions.test.ts server/src/api/app.ts
git commit -m "feat: execution logging and executions endpoints (M4)"
```

---

### Task 8: Staleness detection (M4)

**Files:**
- Create: `server/src/feedback/staleness.ts`
- Test: `server/src/feedback/staleness.test.ts`

**Interfaces:**
- Produces (from `staleness.ts`):
  - `markStale(staleDays?: number, p?): Promise<number>` — sets `status='needs_review'` for every `active` skill whose `last_reviewed_at` is older than `staleDays` (default `process.env.STALE_DAYS` or 30) or null; returns the count updated.

- [ ] **Step 1: Write `server/src/feedback/staleness.ts`**

```ts
import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";

export async function markStale(
  staleDays = Number(process.env.STALE_DAYS ?? 30),
  p: pg.Pool = defaultPool
): Promise<number> {
  const { rowCount } = await p.query(
    `update skills
     set status = 'needs_review', updated_at = now()
     where status = 'active'
       and (last_reviewed_at is null or last_reviewed_at < now() - ($1 || ' days')::interval)`,
    [staleDays]
  );
  return rowCount ?? 0;
}
```

- [ ] **Step 2: Write the failing test `server/src/feedback/staleness.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { createSkill, setStatus, getSkill } from "../skills/repo.js";
import { markStale } from "./staleness.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("markStale", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await pool.query("delete from skill_versions"); await pool.query("delete from skills"); });

  it("flags an active skill last reviewed beyond the window", async () => {
    const s = await createSkill(
      { name: "Old", trigger: "t", inputs: [], procedure: "p", hard_rules: [], tools: [],
        guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    await setStatus(s.id, "active", pool);
    // backdate last_reviewed_at 60 days
    await pool.query(`update skills set last_reviewed_at = now() - interval '60 days' where id = $1`, [s.id]);

    const count = await markStale(30, pool);
    expect(count).toBe(1);
    expect((await getSkill(s.id, pool))?.status).toBe("needs_review");
  });

  it("leaves freshly reviewed skills active", async () => {
    const s = await createSkill(
      { name: "Fresh", trigger: "t", inputs: [], procedure: "p", hard_rules: [], tools: [],
        guardrails: [], escalation_target: null, examples: [], owner: null }, pool);
    await setStatus(s.id, "active", pool); // last_reviewed_at = now()
    const count = await markStale(30, pool);
    expect(count).toBe(0);
    expect((await getSkill(s.id, pool))?.status).toBe("active");
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `cd server && npm test -- staleness`
Expected: PASS with `TEST_DATABASE_URL` (else SKIPPED).

- [ ] **Step 4: Commit**

```bash
git add server/src/feedback/staleness.ts server/src/feedback/staleness.test.ts
git commit -m "feat: staleness detection marks stale active skills needs_review (M4)"
```

---

### Task 9: Assisted ingestion — draft-from-text (M5 / Phase 2)

**Files:**
- Create: `server/src/ingestion/draftFromText.ts`
- Modify: `server/src/api/app.ts` (add route)
- Test: `server/src/ingestion/draftFromText.test.ts`

**Interfaces:**
- Consumes: `createSkill`, `parseNewSkill`.
- Produces (from `draftFromText.ts`):
  - `draftFromText(text: string, client?: AnthropicLike): Promise<Skill>` — asks Claude to extract a skill from pasted company text, validates it, stores it as `draft`, returns it. `AnthropicLike` is the minimal interface `{ messages: { create(args): Promise<{ content: Array<{ type: string; text?: string }> }> } }` so tests can inject a fake.
- Adds route: `POST /api/skills/:id/draft-from-text` — body `{ text: string }`. (Per spec contract path; ignores `:id`, returns a new draft.)

> Before writing the Anthropic call, consult the `claude-api` skill. Model: `claude-sonnet-4-6`.

- [ ] **Step 1: Write `server/src/ingestion/draftFromText.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { createSkill } from "../skills/repo.js";
import { parseNewSkill } from "../skills/validation.js";
import type { Skill } from "../skills/types.js";

export interface AnthropicLike {
  messages: {
    create(args: any): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

const SYSTEM = `You convert a company's process documentation into ONE structured skill.
Return ONLY a JSON object with keys: name, trigger, inputs (string[]), procedure,
hard_rules (string[]), tools (string[]), guardrails (string[]), escalation_target
(string|null), examples ({scenario, correct_action}[]), owner (string|null).
No prose, no markdown fences.`;

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("model returned no JSON");
  return JSON.parse(text.slice(start, end + 1));
}

let defaultClient: AnthropicLike | null = null;
function client(): AnthropicLike {
  if (!defaultClient) defaultClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return defaultClient as unknown as AnthropicLike;
}

export async function draftFromText(text: string, c: AnthropicLike = client()): Promise<Skill> {
  const res = await c.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: "user", content: `Draft a skill from this:\n\n${text}` }],
  });
  const textOut = res.content.find((b) => b.type === "text")?.text ?? "";
  const raw = extractJson(textOut);
  const input = parseNewSkill(raw); // throws ValidationError if Claude returned a bad shape
  return createSkill(input); // stored as draft, never auto-active
}
```

- [ ] **Step 2: Write the failing test `server/src/ingestion/draftFromText.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { pool } from "../db/pool.js";
import { draftFromText, type AnthropicLike } from "./draftFromText.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const fakeClient: AnthropicLike = {
  messages: {
    create: async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          name: "Password Reset", trigger: "user locked out", inputs: ["email"],
          procedure: "verify identity then reset", hard_rules: ["never reset without identity check"],
          tools: ["lookup_user"], guardrails: ["if account flagged, escalate"],
          escalation_target: "Security", examples: [], owner: "IT",
        }),
      }],
    }),
  },
};

d("draftFromText", () => {
  beforeAll(async () => { await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await pool.query("delete from skills"); });

  it("drafts a valid skill from text and stores it as draft", async () => {
    const skill = await draftFromText("When a user is locked out...", fakeClient);
    expect(skill.name).toBe("Password Reset");
    expect(skill.status).toBe("draft");
    expect(skill.version).toBe(1);
  });

  it("rejects malformed model output", async () => {
    const bad: AnthropicLike = { messages: { create: async () => ({ content: [{ type: "text", text: "not json" }] }) } };
    await expect(draftFromText("x", bad)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Add the route to `server/src/api/app.ts`**

Add import:

```ts
import { draftFromText } from "../ingestion/draftFromText.js";
```

Add route before `return app;`:

```ts
  app.post("/api/skills/:id/draft-from-text", async (req, reply) => {
    const text = (req.body as any)?.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      return reply.code(400).send({ error: "text is required" });
    }
    const skill = await draftFromText(text);
    return reply.code(201).send(skill);
  });
```

- [ ] **Step 4: Run the tests**

Run: `cd server && npm test -- draftFromText`
Expected: PASS with `TEST_DATABASE_URL` (else SKIPPED).

- [ ] **Step 5: Commit**

```bash
git add server/src/ingestion server/src/api/app.ts
git commit -m "feat: assisted ingestion draft-from-text endpoint (M5/Phase 2)"
```

---

### Task 10: Seed script + full-suite verification

**Files:**
- Create: `server/src/seed.ts`
- Create: `server/README.md`
- Test: (no new test; runs the whole suite)

**Interfaces:**
- Consumes: `runMigrations`, `createSkill`, `setStatus`.
- Produces: `npm run seed` inserts 2 generic active skills (Refund Handling + Support Triage) so retrieval/execution have data.

- [ ] **Step 1: Write `server/src/seed.ts`**

```ts
import { runMigrations } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { createSkill, setStatus } from "./skills/repo.js";
import type { NewSkill } from "./skills/types.js";

const refund: NewSkill = {
  name: "Refund Handling",
  trigger: "A customer requests a refund on a past order.",
  inputs: ["order_id", "customer_email", "reason"],
  procedure:
    "1. Look up the order. 2. Check the order date. 3. If within the refund window and the reason is valid, issue the refund for the order amount. 4. Confirm to the customer. 5. If outside the window or the amount is large, follow the guardrails.",
  hard_rules: [
    "Never refund an order older than 90 days.",
    "Never refund more than $200 without manager approval.",
    "Never issue a refund to an account other than the one that placed the order.",
  ],
  tools: ["get_order", "issue_refund"],
  guardrails: [
    "If refund amount > $200, STOP and escalate.",
    "If the customer is on an enterprise plan, STOP and escalate.",
    "If the order cannot be found, STOP and escalate.",
  ],
  escalation_target: "Support team lead",
  examples: [
    { scenario: "Customer requests refund on a $40 order placed 5 days ago, item defective.", correct_action: "Within window, under threshold, valid reason -> issue $40 refund and confirm." },
    { scenario: "Customer requests refund on a $350 order.", correct_action: "Over $200 threshold -> do NOT refund; escalate to support team lead." },
  ],
  owner: "Support team lead",
};

const triage: NewSkill = {
  name: "Support Ticket Triage",
  trigger: "A new inbound support ticket arrives and must be categorized and routed.",
  inputs: ["ticket_id", "customer_email", "message"],
  procedure:
    "1. Read the ticket. 2. Categorize: billing, bug, how-to, or security. 3. If how-to, answer from docs. 4. If billing or bug, route to the owning team. 5. If security or threat to churn, follow the guardrails.",
  hard_rules: [
    "Never promise a refund or credit in a support reply.",
    "Never share data from another customer's account.",
  ],
  tools: ["get_ticket", "lookup_customer", "post_reply"],
  guardrails: [
    "If the ticket reports a security/data issue, STOP and escalate.",
    "If the customer threatens to cancel, STOP and escalate.",
  ],
  escalation_target: "Support team lead",
  examples: [
    { scenario: "User asks how to export their data.", correct_action: "How-to -> answer from docs and resolve." },
    { scenario: "User reports they can see another account's invoice.", correct_action: "Security issue -> do NOT reply with data; escalate immediately." },
  ],
  owner: "Support team lead",
};

async function main() {
  await runMigrations(pool);
  for (const s of [refund, triage]) {
    const created = await createSkill(s);
    await setStatus(created.id, "active");
    console.log(`seeded + activated: ${created.name} (${created.id})`);
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Write `server/README.md`**

```markdown
# Brian — Company Brain backend

Standalone TypeScript service. See `../CompanyBrain.md` and
`../docs/superpowers/specs/2026-06-29-company-brain-design.md`.

## Setup
1. `cp .env.example .env` and fill in `DATABASE_URL` (Supabase), `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`.
2. `npm install`
3. `npm run migrate`   # create tables + pgvector
4. `npm run seed`      # 2 active example skills

## Run
- `npm run api`  → REST API on :3001 (the React UI's contract)
- `npm run mcp`  → MCP server on stdio (for an agent to execute skills)

## Test
Set `TEST_DATABASE_URL` to a Postgres+pgvector DB, then `npm test`.
DB-backed tests are skipped if it is unset; pure-logic tests always run.
```

- [ ] **Step 3: Run the migrate + seed against the test DB to prove they work**

Run: `cd server && DATABASE_URL=$TEST_DATABASE_URL npm run migrate && DATABASE_URL=$TEST_DATABASE_URL npm run seed`
Expected: prints "migrations applied" then two "seeded + activated" lines.

- [ ] **Step 4: Run the full suite**

Run: `cd server && npm test`
Expected: all tests PASS (DB-backed ones run because `TEST_DATABASE_URL` is set). The M3 loop test passes — the v1 win condition is met.

- [ ] **Step 5: Commit**

```bash
git add server/src/seed.ts server/README.md
git commit -m "feat: seed script with 2 generic skills + backend README"
```

---

## Self-Review

**Spec coverage:**
- Skill schema + Postgres tables → Task 1. ✅
- `Skill` TS type + statuses → Task 2. ✅
- CRUD + version history → Tasks 3, 4. ✅
- `find_skill` / `get_skill` retrieval (pgvector) → Tasks 5, 6. ✅
- MCP server + mock business tools + execution flow respecting hard_rules/guardrails → Task 6. ✅
- Execution log + endpoints → Task 7. ✅
- Staleness → needs_review; version history on edit → Tasks 8, 3. ✅
- Full REST contract (incl. activate/retire/versions/executions/draft-from-text) → Tasks 4, 7, 9. ✅
- Assisted ingestion (Phase 2) with human review (drafts only) → Task 9. ✅
- Seed/hand-author first skill, build inside-out M0→M5 → Tasks 1–10. ✅
- Anti-goals (no connectors, no graph, no auto-activation) → respected; drafts never auto-activate (Task 9), connectors out of scope.

**Placeholder scan:** No TBD/TODO; every code step contains real code; every test has real assertions. ✅

**Type consistency:** `Skill`/`NewSkill`/`SkillVersion`/`Execution` defined in Task 2 and used unchanged in Tasks 3–10. Repo signatures (`createSkill`, `getSkill`, `listSkills`, `updateSkill`, `setStatus`, `listVersions`, `findSkill`) consistent across Tasks 3–10. `logExecution`/`listExecutions` defined in Task 7, consumed in Task 6 (sequencing note flags the one cross-task dependency). `embed` mocked identically everywhere. ✅

**One known ordering note:** Task 6's `loop.test.ts` depends on Task 7's `logExecution`. Implement `feedback/executions.ts` (Task 7 Steps 1–2) before running Task 6 Step 7. Flagged inline in Task 6.
