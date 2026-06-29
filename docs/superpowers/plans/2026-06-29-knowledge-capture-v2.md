# Knowledge Capture & Ingestion v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a second knowledge type (`context`) and a `capture(text)` connector — usable from inside Claude via MCP — that classifies what the user said into skills vs. context, routes each to create-or-update, and applies graduated autonomy (context always active; skills auto-active only when confident and reversible). Plus bulk ingestion.

**Architecture:** Extends the v1 `server/` backend. New `context/` module mirrors `skills/`. New `ingestion/capture.ts` orchestrates classify→route→gate using Claude (mocked in tests). New `mcp/toolRisk.ts` drives the reversibility gate. MCP server and REST API gain capture, find_context, context CRUD, and bulk endpoints.

**Tech Stack:** Same as v1 — Node/TS, Fastify, pg, pgvector, @anthropic-ai/sdk, @modelcontextprotocol/sdk, zod, Vitest. DB tests run against the live `brian` Supabase project via `TEST_DATABASE_URL` in `server/.env`.

## Global Constraints

- All new code under `server/src/`. Follow v1 patterns exactly (default `p: pg.Pool = pool`, `embed()` mocked in tests, `resetDb()` in `beforeEach`, DB-backed `describe` gated on `TEST_DATABASE_URL`).
- `context` entries are **never executable** — no `tools`, no `hard_rules`. They only inform.
- Autonomy gate for skills: auto-activate iff `confidence ≥ CAPTURE_CONFIDENCE_MIN` (default 0.75) AND `skillIsAutoSafe(tools)`. Unknown tools are `destructive`. Context is always `active`.
- Tests mock the Anthropic client (inject `AnthropicLike`) and `embed()`. No live API calls in tests.
- `resetDb()` must also clear the new `context_versions` and `context_entries` tables (FK-safe order).
- Run DB tests with: `set -a && . ./.env && set +a && npm test`.

---

### Task 1: Context schema migration + resetDb update

**Files:**
- Create: `server/src/db/migrations/002_context.sql`
- Modify: `server/src/test/resetDb.ts`
- Test: `server/src/db/migrate002.test.ts`

**Interfaces:**
- Produces: `context_entries`, `context_versions` tables; `resetDb` clears them too.

- [ ] **Step 1: Write `server/src/db/migrations/002_context.sql`**

```sql
create table if not exists context_entries (
  id          uuid primary key default gen_random_uuid(),
  content     text not null,
  summary     text,
  tags        jsonb not null default '[]',
  source      text,
  status      text not null default 'active',
  owner       text,
  version     int  not null default 1,
  embedding   vector(1536),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists context_entries_embedding_idx on context_entries using ivfflat (embedding vector_cosine_ops);

create table if not exists context_versions (
  id          uuid primary key default gen_random_uuid(),
  context_id  uuid not null references context_entries(id),
  version     int not null,
  snapshot    jsonb not null,
  changed_by  text,
  created_at  timestamptz not null default now()
);
```

- [ ] **Step 2: Update `resetDb` to clear context tables (FK-safe)**

Replace the body of `resetDb` in `server/src/test/resetDb.ts`:

```ts
export async function resetDb(pool: pg.Pool): Promise<void> {
  await pool.query("delete from executions");
  await pool.query("delete from skill_versions");
  await pool.query("delete from skill_links");
  await pool.query("delete from skills");
  await pool.query("delete from context_versions");
  await pool.query("delete from context_entries");
}
```

- [ ] **Step 3: Write the failing test `server/src/db/migrate002.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { runMigrations } from "./migrate.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("002 context migration", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });

  it("creates the context tables", async () => {
    const { rows } = await pool.query(
      `select table_name from information_schema.tables
       where table_schema='public' and table_name in ('context_entries','context_versions')`
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(["context_entries", "context_versions"]);
  });
});
```

- [ ] **Step 4: Run**

Run: `set -a && . ./.env && set +a && npm test -- migrate002`
Expected: PASS (`runMigrations` runs all `*.sql` in order, so 002 applies).

- [ ] **Step 5: Commit**

```bash
git add server/src/db/migrations/002_context.sql server/src/test/resetDb.ts server/src/db/migrate002.test.ts
git commit -m "feat: context_entries + context_versions schema (v2)"
```

---

### Task 2: Context types + validation

**Files:**
- Create: `server/src/context/types.ts`
- Create: `server/src/context/validation.ts`
- Test: `server/src/context/validation.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `ContextStatus = "active" | "retired"`
  - `ContextEntry { id; content; summary: string | null; tags: string[]; source: string | null; status: ContextStatus; owner: string | null; version: number; created_at; updated_at }`
  - `NewContext { content; summary: string | null; tags: string[]; source: string | null; owner: string | null }`
  - `ContextVersion { id; context_id; version; snapshot: ContextEntry; changed_by: string | null; created_at }`
- Produces (`validation.ts`): `parseNewContext(body): NewContext`, `parseUpdateContext(body): Partial<NewContext>`, reusing `ValidationError` from `../skills/validation.js`.

- [ ] **Step 1: Write `server/src/context/types.ts`**

```ts
export type ContextStatus = "active" | "retired";

export interface ContextEntry {
  id: string;
  content: string;
  summary: string | null;
  tags: string[];
  source: string | null;
  status: ContextStatus;
  owner: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface NewContext {
  content: string;
  summary: string | null;
  tags: string[];
  source: string | null;
  owner: string | null;
}

export interface ContextVersion {
  id: string;
  context_id: string;
  version: number;
  snapshot: ContextEntry;
  changed_by: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Write `server/src/context/validation.ts`**

```ts
import { z } from "zod";
import { ValidationError } from "../skills/validation.js";
import type { NewContext } from "./types.js";

export const newContextSchema = z.object({
  content: z.string().min(1),
  summary: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  source: z.string().nullable().default(null),
  owner: z.string().nullable().default(null),
});

export const updateContextSchema = newContextSchema.partial();

function format(err: z.ZodError): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

export function parseNewContext(body: unknown): NewContext {
  const r = newContextSchema.safeParse(body);
  if (!r.success) throw new ValidationError(format(r.error));
  return r.data as NewContext;
}

export function parseUpdateContext(body: unknown): Partial<NewContext> {
  const r = updateContextSchema.safeParse(body);
  if (!r.success) throw new ValidationError(format(r.error));
  return r.data as Partial<NewContext>;
}
```

- [ ] **Step 3: Write the failing test `server/src/context/validation.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseNewContext } from "./validation.js";
import { ValidationError } from "../skills/validation.js";

describe("parseNewContext", () => {
  it("accepts content and fills defaults", () => {
    const c = parseNewContext({ content: "We want to launch in Q3" });
    expect(c.content).toBe("We want to launch in Q3");
    expect(c.tags).toEqual([]);
    expect(c.summary).toBeNull();
  });
  it("rejects empty content", () => {
    expect(() => parseNewContext({ content: "" })).toThrow(ValidationError);
  });
});
```

- [ ] **Step 4: Run**

Run: `npm test -- context/validation`
Expected: PASS (no DB needed).

- [ ] **Step 5: Commit**

```bash
git add server/src/context/types.ts server/src/context/validation.ts server/src/context/validation.test.ts
git commit -m "feat: context types and validation"
```

---

### Task 3: Context repository (CRUD, version history, findContext with distance)

**Files:**
- Create: `server/src/context/repo.ts`
- Test: `server/src/context/repo.test.ts`

**Interfaces:**
- Consumes: `pool`, `embed`, `toVectorLiteral`, `NotFoundError` (from `../skills/repo.js`).
- Produces (all with optional final `p: pg.Pool = pool`):
  - `createContext(input: NewContext, p?): Promise<ContextEntry>`
  - `getContext(id, p?): Promise<ContextEntry | null>`
  - `listContext(status?, p?): Promise<ContextEntry[]>`
  - `updateContext(id, patch: Partial<NewContext>, changedBy: string | null, p?): Promise<ContextEntry>` (snapshots prior, bumps version, re-embeds if content/summary changed)
  - `retireContext(id, p?): Promise<ContextEntry>`
  - `listContextVersions(id, p?): Promise<ContextVersion[]>`
  - `findContextWithDistance(query: string, p?): Promise<{ entry: ContextEntry; distance: number } | null>` (nearest active by cosine; null if none)

- [ ] **Step 1: Write `server/src/context/repo.ts`**

```ts
import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import { embed } from "../db/embed.js";
import { toVectorLiteral } from "../db/vector.js";
import { NotFoundError } from "../skills/repo.js";
import type { ContextEntry, ContextStatus, ContextVersion, NewContext } from "./types.js";

const COLUMNS = `id, content, summary, tags, source, status, owner, version, created_at, updated_at`;

function iso(v: Date | null): string | null { return v ? new Date(v).toISOString() : null; }

function rowToContext(r: any): ContextEntry {
  return {
    id: r.id, content: r.content, summary: r.summary, tags: r.tags, source: r.source,
    status: r.status, owner: r.owner, version: r.version,
    created_at: iso(r.created_at)!, updated_at: iso(r.updated_at)!,
  };
}

function embedText(c: Pick<ContextEntry, "summary" | "content">): string {
  return c.summary && c.summary.length > 0 ? c.summary : c.content;
}

export async function createContext(input: NewContext, p: pg.Pool = defaultPool): Promise<ContextEntry> {
  const vec = toVectorLiteral(await embed(embedText(input)));
  const { rows } = await p.query(
    `insert into context_entries (content, summary, tags, source, status, owner, version, embedding)
     values ($1,$2,$3,$4,'active',$5,1,$6::vector)
     returning ${COLUMNS}`,
    [input.content, input.summary, JSON.stringify(input.tags), input.source, input.owner, vec]
  );
  return rowToContext(rows[0]);
}

export async function getContext(id: string, p: pg.Pool = defaultPool): Promise<ContextEntry | null> {
  const { rows } = await p.query(`select ${COLUMNS} from context_entries where id = $1`, [id]);
  return rows[0] ? rowToContext(rows[0]) : null;
}

export async function listContext(status?: ContextStatus, p: pg.Pool = defaultPool): Promise<ContextEntry[]> {
  const { rows } = status
    ? await p.query(`select ${COLUMNS} from context_entries where status=$1 order by updated_at desc`, [status])
    : await p.query(`select ${COLUMNS} from context_entries order by updated_at desc`);
  return rows.map(rowToContext);
}

export async function listContextVersions(id: string, p: pg.Pool = defaultPool): Promise<ContextVersion[]> {
  const { rows } = await p.query(
    `select id, context_id, version, snapshot, changed_by, created_at
     from context_versions where context_id=$1 order by version desc`, [id]);
  return rows.map((r) => ({
    id: r.id, context_id: r.context_id, version: r.version, snapshot: r.snapshot,
    changed_by: r.changed_by, created_at: iso(r.created_at)!,
  }));
}

export async function updateContext(
  id: string, patch: Partial<NewContext>, changedBy: string | null, p: pg.Pool = defaultPool
): Promise<ContextEntry> {
  const client = await p.connect();
  try {
    await client.query("begin");
    const { rows: curRows } = await client.query(`select ${COLUMNS} from context_entries where id=$1`, [id]);
    if (!curRows[0]) throw new NotFoundError(id);
    const cur = rowToContext(curRows[0]);
    await client.query(
      `insert into context_versions (context_id, version, snapshot, changed_by) values ($1,$2,$3,$4)`,
      [id, cur.version, JSON.stringify(cur), changedBy]);
    const next = { ...cur, ...patch } as ContextEntry;
    const reembed = patch.content !== undefined || patch.summary !== undefined;
    const vec = reembed ? toVectorLiteral(await embed(embedText(next))) : null;
    const { rows } = await client.query(
      `update context_entries set content=$2, summary=$3, tags=$4, source=$5, owner=$6,
         version=version+1, updated_at=now(), embedding = coalesce($7::vector, embedding)
       where id=$1 returning ${COLUMNS}`,
      [id, next.content, next.summary, JSON.stringify(next.tags), next.source, next.owner, vec]);
    await client.query("commit");
    return rowToContext(rows[0]);
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
}

export async function retireContext(id: string, p: pg.Pool = defaultPool): Promise<ContextEntry> {
  const { rows } = await p.query(
    `update context_entries set status='retired', updated_at=now() where id=$1 returning ${COLUMNS}`, [id]);
  if (!rows[0]) throw new NotFoundError(id);
  return rowToContext(rows[0]);
}

export async function findContextWithDistance(
  query: string, p: pg.Pool = defaultPool
): Promise<{ entry: ContextEntry; distance: number } | null> {
  const vec = toVectorLiteral(await embed(query));
  const { rows } = await p.query(
    `select ${COLUMNS}, embedding <=> $1::vector as distance
     from context_entries where status='active'
     order by embedding <=> $1::vector limit 1`, [vec]);
  return rows[0] ? { entry: rowToContext(rows[0]), distance: Number(rows[0].distance) } : null;
}
```

- [ ] **Step 2: Write the failing test `server/src/context/repo.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

function fakeVec(text: string): number[] {
  const v = Array.from({ length: 1536 }, () => 0);
  if (/launch|q3|goal/i.test(text)) v[0] = 1;
  if (/refund|support/i.test(text)) v[1] = 1;
  return v;
}
vi.mock("../db/embed.js", () => ({ EMBED_DIM: 1536, embed: vi.fn(async (t: string) => fakeVec(t)) }));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { createContext, getContext, listContext, updateContext, retireContext, listContextVersions, findContextWithDistance } from "./repo.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("context repo", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  const sample = { content: "We want to launch in Q3", summary: "Q3 launch goal", tags: ["goal"], source: "capture", owner: "me" };

  it("creates an active context entry", async () => {
    const c = await createContext(sample, pool);
    expect(c.status).toBe("active");
    expect(c.version).toBe(1);
    expect(await getContext(c.id, pool)).not.toBeNull();
  });

  it("update snapshots version and bumps", async () => {
    const c = await createContext(sample, pool);
    const u = await updateContext(c.id, { content: "Launch moved to Q4" }, "me", pool);
    expect(u.version).toBe(2);
    expect((await listContextVersions(c.id, pool)).length).toBe(1);
  });

  it("retire hides from active list", async () => {
    const c = await createContext(sample, pool);
    await retireContext(c.id, pool);
    expect((await listContext("active", pool)).length).toBe(0);
  });

  it("findContextWithDistance returns nearest active with a distance", async () => {
    await createContext(sample, pool);
    const hit = await findContextWithDistance("what is our launch goal", pool);
    expect(hit).not.toBeNull();
    expect(hit!.entry.summary).toBe("Q3 launch goal");
    expect(typeof hit!.distance).toBe("number");
  });
});
```

- [ ] **Step 3: Run**

Run: `set -a && . ./.env && set +a && npm test -- context/repo`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/context/repo.ts server/src/context/repo.test.ts
git commit -m "feat: context repository with version history and vector search"
```

---

### Task 4: Tool-risk registry + findSkillWithDistance

**Files:**
- Create: `server/src/mcp/toolRisk.ts`
- Modify: `server/src/skills/repo.ts` (add `findSkillWithDistance`)
- Test: `server/src/mcp/toolRisk.test.ts`

**Interfaces:**
- Produces (`toolRisk.ts`): `ToolRisk = "safe" | "destructive"`, `toolRisk(name): ToolRisk` (unknown→destructive), `skillIsAutoSafe(tools: string[]): boolean`.
- Produces (`repo.ts`): `findSkillWithDistance(query, p?): Promise<{ skill: Skill; distance: number } | null>`.

- [ ] **Step 1: Write `server/src/mcp/toolRisk.ts`**

```ts
export type ToolRisk = "safe" | "destructive";

const REGISTRY: Record<string, ToolRisk> = {
  get_order: "safe",
  lookup_customer: "safe",
  get_ticket: "safe",
  find_skill: "safe",
  get_skill: "safe",
  find_context: "safe",
  issue_refund: "destructive",
  post_reply: "destructive",
  page_oncall: "destructive",
};

export function toolRisk(name: string): ToolRisk {
  return REGISTRY[name] ?? "destructive"; // unknown tools fail safe
}

export function skillIsAutoSafe(tools: string[]): boolean {
  return tools.every((t) => toolRisk(t) === "safe");
}
```

- [ ] **Step 2: Add `findSkillWithDistance` to `server/src/skills/repo.ts`** (append at end)

```ts
export async function findSkillWithDistance(
  query: string, p: pg.Pool = defaultPool
): Promise<{ skill: Skill; distance: number } | null> {
  const vec = toVectorLiteral(await embed(query));
  const { rows } = await p.query(
    `select ${SKILL_COLUMNS}, embedding <=> $1::vector as distance
     from skills order by embedding <=> $1::vector limit 1`, [vec]);
  return rows[0] ? { skill: rowToSkill(rows[0]), distance: Number(rows[0].distance) } : null;
}
```

Note: this searches ALL skills (any status) so capture can match and revise a `draft` or `active` skill.

- [ ] **Step 3: Write the failing test `server/src/mcp/toolRisk.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { toolRisk, skillIsAutoSafe } from "./toolRisk.js";

describe("toolRisk", () => {
  it("classifies known safe and destructive tools", () => {
    expect(toolRisk("get_order")).toBe("safe");
    expect(toolRisk("issue_refund")).toBe("destructive");
  });
  it("defaults unknown tools to destructive", () => {
    expect(toolRisk("delete_everything")).toBe("destructive");
  });
});

describe("skillIsAutoSafe", () => {
  it("true when all tools are safe", () => {
    expect(skillIsAutoSafe(["get_order", "lookup_customer"])).toBe(true);
    expect(skillIsAutoSafe([])).toBe(true);
  });
  it("false when any tool is destructive or unknown", () => {
    expect(skillIsAutoSafe(["get_order", "issue_refund"])).toBe(false);
    expect(skillIsAutoSafe(["mystery_tool"])).toBe(false);
  });
});
```

- [ ] **Step 4: Run**

Run: `npm test -- toolRisk`
Expected: PASS (no DB).

- [ ] **Step 5: Commit**

```bash
git add server/src/mcp/toolRisk.ts server/src/skills/repo.ts server/src/mcp/toolRisk.test.ts
git commit -m "feat: tool-risk registry + findSkillWithDistance for capture routing"
```

---

### Task 5: Capture pipeline (classify → route → autonomy gate)

**Files:**
- Create: `server/src/ingestion/capture.ts`
- Test: `server/src/ingestion/capture.test.ts`

**Interfaces:**
- Consumes: `AnthropicLike` (from `./draftFromText.js`), skill repo (`createSkill`, `setStatus`, `updateSkill`, `findSkillWithDistance`), context repo (`createContext`, `updateContext`, `findContextWithDistance`), `skillIsAutoSafe`, `parseNewSkill`, `parseNewContext`.
- Produces:
  - `type CapturedItem = { kind: "context"; confidence: number; content: string; summary: string; tags: string[] } | { kind: "skill"; confidence: number; skill: NewSkill }`
  - `interface CaptureResult { items: Array<{ kind: "skill" | "context"; action: string; id: string; confidence: number }> }`
  - `capture(text: string, c?: AnthropicLike, p?: pg.Pool): Promise<CaptureResult>`
  - `CONF_MIN` and `SIM_MAX` read from env with defaults 0.75 and 0.2.

- [ ] **Step 1: Write `server/src/ingestion/capture.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import type { AnthropicLike } from "./draftFromText.js";
import { parseNewSkill } from "../skills/validation.js";
import { parseNewContext } from "../context/validation.js";
import { skillIsAutoSafe } from "../mcp/toolRisk.js";
import { createSkill, setStatus, updateSkill, findSkillWithDistance } from "../skills/repo.js";
import { createContext, updateContext, findContextWithDistance } from "../context/repo.js";
import type { NewSkill } from "../skills/types.js";

export type CapturedItem =
  | { kind: "context"; confidence: number; content: string; summary: string; tags: string[] }
  | { kind: "skill"; confidence: number; skill: NewSkill };

export interface CaptureResult {
  items: Array<{ kind: "skill" | "context"; action: string; id: string; confidence: number }>;
}

const CONF_MIN = Number(process.env.CAPTURE_CONFIDENCE_MIN ?? 0.75);
const SIM_MAX = Number(process.env.CAPTURE_SIM_MAX ?? 0.2);

const SYSTEM = `You extract structured knowledge from a work session transcript.
Return ONLY a JSON array. Each element is one of:
{"kind":"context","confidence":0..1,"content":"...","summary":"short","tags":["..."]}
{"kind":"skill","confidence":0..1,"skill":{"name","trigger","inputs":[],"procedure",
  "hard_rules":[],"tools":[],"guardrails":[],"escalation_target":null,"examples":[],"owner":null}}
Use "context" for goals/decisions/preferences/facts. Use "skill" for repeatable
processes with steps. No prose, no markdown fences.`;

function extractArray(text: string): unknown[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("model returned no JSON array");
  const parsed = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("model output is not an array");
  return parsed;
}

let defaultClient: AnthropicLike | null = null;
function client(): AnthropicLike {
  if (!defaultClient) defaultClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) as unknown as AnthropicLike;
  return defaultClient;
}

export async function capture(
  text: string, c: AnthropicLike = client(), p: pg.Pool = defaultPool
): Promise<CaptureResult> {
  const res = await c.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: `Extract from this session:\n\n${text}` }],
  });
  const out = res.content.find((b) => b.type === "text")?.text ?? "";
  const raw = extractArray(out);

  const items: CaptureResult["items"] = [];
  for (const r of raw as CapturedItem[]) {
    if (r.kind === "context") {
      const input = parseNewContext({ content: r.content, summary: r.summary, tags: r.tags, source: "capture", owner: null });
      const match = await findContextWithDistance(input.summary ?? input.content, p);
      if (match && match.distance <= SIM_MAX) {
        const u = await updateContext(match.entry.id, input, "capture", p);
        items.push({ kind: "context", action: "updated_active", id: u.id, confidence: r.confidence });
      } else {
        const cre = await createContext(input, p);
        items.push({ kind: "context", action: "created_active", id: cre.id, confidence: r.confidence });
      }
    } else {
      const skill = parseNewSkill(r.skill);
      const auto = r.confidence >= CONF_MIN && skillIsAutoSafe(skill.tools);
      const match = await findSkillWithDistance(`${skill.name}\n${skill.trigger}`, p);
      const isUpdate = match !== null && match.distance <= SIM_MAX;
      if (isUpdate && auto) {
        const u = await updateSkill(match!.skill.id, skill, "capture", p);
        const a = await setStatus(u.id, "active", p);
        items.push({ kind: "skill", action: "updated_active", id: a.id, confidence: r.confidence });
      } else {
        const cre = await createSkill(skill, p); // draft
        if (!isUpdate && auto) {
          const a = await setStatus(cre.id, "active", p);
          items.push({ kind: "skill", action: "created_active", id: a.id, confidence: r.confidence });
        } else {
          items.push({ kind: "skill", action: isUpdate ? "proposed_draft" : "created_draft", id: cre.id, confidence: r.confidence });
        }
      }
    }
  }
  return { items };
}
```

- [ ] **Step 2: Write the failing test `server/src/ingestion/capture.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

function fakeVec(text: string): number[] {
  const v = Array.from({ length: 1536 }, () => 0);
  if (/launch|goal|q3/i.test(text)) v[0] = 1;
  if (/refund/i.test(text)) v[1] = 1;
  if (/onboard/i.test(text)) v[2] = 1;
  return v;
}
vi.mock("../db/embed.js", () => ({ EMBED_DIM: 1536, embed: vi.fn(async (t: string) => fakeVec(t)) }));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { getSkill } from "../skills/repo.js";
import { capture, type CapturedItem } from "./capture.js";
import type { AnthropicLike } from "./draftFromText.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

function clientReturning(items: CapturedItem[]): AnthropicLike {
  return { messages: { create: async () => ({ content: [{ type: "text", text: JSON.stringify(items) }] }) } };
}

const skillBase = { name: "", trigger: "", inputs: [], procedure: "p", hard_rules: [], tools: [], guardrails: [], escalation_target: null, examples: [], owner: null };

d("capture", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("stores a context item active", async () => {
    const c = clientReturning([{ kind: "context", confidence: 0.9, content: "Launch in Q3", summary: "Q3 launch goal", tags: ["goal"] }]);
    const r = await capture("we want to launch in Q3", c, pool);
    expect(r.items[0]).toMatchObject({ kind: "context", action: "created_active" });
  });

  it("auto-activates a confident skill that uses only safe tools", async () => {
    const c = clientReturning([{ kind: "skill", confidence: 0.95, skill: { ...skillBase, name: "Lookup Order Status", trigger: "customer asks order status", tools: ["get_order"] } }]);
    const r = await capture("when a customer asks status, look up the order", c, pool);
    expect(r.items[0].action).toBe("created_active");
    expect((await getSkill(r.items[0].id, pool))!.status).toBe("active");
  });

  it("keeps a destructive-tool skill as draft even when confident", async () => {
    const c = clientReturning([{ kind: "skill", confidence: 0.99, skill: { ...skillBase, name: "Refund Flow", trigger: "refund request", tools: ["get_order", "issue_refund"] } }]);
    const r = await capture("how we refund", c, pool);
    expect(r.items[0].action).toBe("created_draft");
    expect((await getSkill(r.items[0].id, pool))!.status).toBe("draft");
  });

  it("keeps a low-confidence safe skill as draft", async () => {
    const c = clientReturning([{ kind: "skill", confidence: 0.4, skill: { ...skillBase, name: "Maybe Onboarding", trigger: "onboard new user", tools: ["get_ticket"] } }]);
    const r = await capture("not sure how onboarding works", c, pool);
    expect(r.items[0].action).toBe("created_draft");
  });

  it("updates an existing context instead of duplicating", async () => {
    const c1 = clientReturning([{ kind: "context", confidence: 0.9, content: "Launch in Q3", summary: "launch goal q3", tags: [] }]);
    const first = await capture("launch q3", c1, pool);
    const c2 = clientReturning([{ kind: "context", confidence: 0.9, content: "Launch moved to Q4", summary: "launch goal q3", tags: [] }]);
    const second = await capture("update launch", c2, pool);
    expect(second.items[0].action).toBe("updated_active");
    expect(second.items[0].id).toBe(first.items[0].id);
  });
});
```

- [ ] **Step 3: Run**

Run: `set -a && . ./.env && set +a && npm test -- ingestion/capture`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/ingestion/capture.ts server/src/ingestion/capture.test.ts
git commit -m "feat: capture pipeline — classify, route, graduated autonomy gate"
```

---

### Task 6: Bulk ingestion

**Files:**
- Create: `server/src/ingestion/bulk.ts`
- Test: `server/src/ingestion/bulk.test.ts`

**Interfaces:**
- Produces: `interface BulkDoc { source: string; text: string }`; `interface BulkResult { source: string; ok: boolean; result?: CaptureResult; error?: string }`; `ingestBulk(docs: BulkDoc[], c?: AnthropicLike, p?: pg.Pool): Promise<BulkResult[]>` — runs `capture` per doc; a failing doc yields `{ ok: false, error }` without aborting the batch.

- [ ] **Step 1: Write `server/src/ingestion/bulk.ts`**

```ts
import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import { capture, type CaptureResult } from "./capture.js";
import type { AnthropicLike } from "./draftFromText.js";

export interface BulkDoc { source: string; text: string }
export interface BulkResult { source: string; ok: boolean; result?: CaptureResult; error?: string }

export async function ingestBulk(
  docs: BulkDoc[], c?: AnthropicLike, p: pg.Pool = defaultPool
): Promise<BulkResult[]> {
  const out: BulkResult[] = [];
  for (const doc of docs) {
    try {
      const result = await capture(doc.text, c, p);
      out.push({ source: doc.source, ok: true, result });
    } catch (e) {
      out.push({ source: doc.source, ok: false, error: (e as Error).message });
    }
  }
  return out;
}
```

- [ ] **Step 2: Write the failing test `server/src/ingestion/bulk.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({ EMBED_DIM: 1536, embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)) }));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { ingestBulk } from "./bulk.js";
import type { AnthropicLike } from "./draftFromText.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

// Returns valid JSON for doc containing "good", invalid otherwise.
const client: AnthropicLike = {
  messages: {
    create: async (args: any) => {
      const userText = args.messages[0].content as string;
      const text = userText.includes("good")
        ? JSON.stringify([{ kind: "context", confidence: 0.9, content: "a goal", summary: "a goal", tags: [] }])
        : "not json";
      return { content: [{ type: "text", text }] };
    },
  },
};

d("ingestBulk", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("processes good docs and isolates a bad one", async () => {
    const results = await ingestBulk(
      [{ source: "a.txt", text: "good doc" }, { source: "b.txt", text: "bad doc" }],
      client, pool);
    expect(results[0].ok).toBe(true);
    expect(results[0].result!.items.length).toBe(1);
    expect(results[1].ok).toBe(false);
    expect(results[1].error).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run**

Run: `set -a && . ./.env && set +a && npm test -- ingestion/bulk`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/ingestion/bulk.ts server/src/ingestion/bulk.test.ts
git commit -m "feat: bulk ingestion runs capture per doc, isolating failures"
```

---

### Task 7: MCP tools — capture + find_context

**Files:**
- Modify: `server/src/mcp/server.ts`
- Test: `server/src/mcp/captureTools.test.ts`

**Interfaces:**
- Adds MCP tools `capture(text)` and `find_context(query)` to `buildMcpServer()`.
- For testability, also export the underlying handlers: `captureHandler(text, c?, p?)` returning `CaptureResult` and `findContextHandler(query, p?)` returning the nearest active context entry or null. Register these in the server.

- [ ] **Step 1: Add handlers + tools to `server/src/mcp/server.ts`**

Add imports at top:

```ts
import { capture } from "../ingestion/capture.js";
import { findContextWithDistance } from "../context/repo.js";
```

Inside `buildMcpServer`, before `return server;`, register:

```ts
  server.registerTool(
    "capture",
    { description: "Capture a work session into the brain: classify into skills/context and file them.", inputSchema: { text: z.string() } },
    async ({ text }) => {
      const result = await capture(text);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.registerTool(
    "find_context",
    { description: "Find the most relevant active context (goals/decisions/preferences) for a query.", inputSchema: { query: z.string() } },
    async ({ query }) => {
      const hit = await findContextWithDistance(query);
      return { content: [{ type: "text", text: hit ? JSON.stringify(hit.entry) : "NO_MATCHING_CONTEXT" }] };
    }
  );
```

- [ ] **Step 2: Write the failing test `server/src/mcp/captureTools.test.ts`**

This tests the building blocks the tools call (capture + findContextWithDistance) against the DB — the registration above is thin glue over them.

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({ EMBED_DIM: 1536, embed: vi.fn(async () => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))) }));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { capture } from "../ingestion/capture.js";
import { findContextWithDistance } from "../context/repo.js";
import type { AnthropicLike } from "../ingestion/draftFromText.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const client: AnthropicLike = {
  messages: { create: async () => ({ content: [{ type: "text", text: JSON.stringify([{ kind: "context", confidence: 0.9, content: "ship weekly", summary: "ship weekly", tags: [] }]) }] }) },
};

d("capture + find_context (MCP building blocks)", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("capture then find_context retrieves it", async () => {
    await capture("we ship weekly", client, pool);
    const hit = await findContextWithDistance("how often do we ship", pool);
    expect(hit!.entry.summary).toBe("ship weekly");
  });
});
```

- [ ] **Step 3: Run + typecheck**

Run: `set -a && . ./.env && set +a && npm test -- captureTools && npx tsc -p tsconfig.json --noEmit`
Expected: test PASS, typecheck exit 0.

- [ ] **Step 4: Commit**

```bash
git add server/src/mcp/server.ts server/src/mcp/captureTools.test.ts
git commit -m "feat: MCP capture + find_context tools (the in-Claude connector)"
```

---

### Task 8: REST endpoints — capture, bulk, context CRUD

**Files:**
- Modify: `server/src/api/app.ts`
- Test: `server/src/api/contextApi.test.ts`

**Interfaces:**
- Adds routes:
  - `POST /api/capture` `{ text }` → `CaptureResult` (400 if text missing)
  - `POST /api/ingest/bulk` `{ docs: [{source,text}] }` → `{ results: BulkResult[] }` (400 if docs not an array)
  - `GET /api/context?status=` · `GET /api/context/:id` (404) · `POST /api/context` (201, validated) · `PUT /api/context/:id` · `POST /api/context/:id/retire` · `GET /api/context/:id/versions`

- [ ] **Step 1: Add to `server/src/api/app.ts`**

Add imports:

```ts
import { createContext, getContext, listContext, updateContext, retireContext, listContextVersions } from "../context/repo.js";
import { parseNewContext, parseUpdateContext } from "../context/validation.js";
import { capture } from "../ingestion/capture.js";
import { ingestBulk } from "../ingestion/bulk.js";
import type { ContextStatus } from "../context/types.js";
```

Add routes before `return app;`:

```ts
  app.post("/api/capture", async (req, reply) => {
    const text = (req.body as any)?.text;
    if (typeof text !== "string" || text.trim().length === 0) return reply.code(400).send({ error: "text is required" });
    return capture(text);
  });

  app.post("/api/ingest/bulk", async (req, reply) => {
    const docs = (req.body as any)?.docs;
    if (!Array.isArray(docs)) return reply.code(400).send({ error: "docs array is required" });
    return { results: await ingestBulk(docs) };
  });

  app.get("/api/context", async (req) => {
    const status = (req.query as any)?.status as ContextStatus | undefined;
    return listContext(status);
  });

  app.get("/api/context/:id", async (req, reply) => {
    const c = await getContext((req.params as any).id);
    if (!c) return reply.code(404).send({ error: "context not found" });
    return c;
  });

  app.post("/api/context", async (req, reply) => {
    const input = parseNewContext(req.body);
    return reply.code(201).send(await createContext(input));
  });

  app.put("/api/context/:id", async (req) =>
    updateContext((req.params as any).id, parseUpdateContext(req.body), "api"));

  app.post("/api/context/:id/retire", async (req) =>
    retireContext((req.params as any).id));

  app.get("/api/context/:id/versions", async (req) =>
    listContextVersions((req.params as any).id));
```

- [ ] **Step 2: Write the failing test `server/src/api/contextApi.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({ EMBED_DIM: 1536, embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)) }));

import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { pool } from "../db/pool.js";
import { buildApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("context API", () => {
  const app = buildApp();
  beforeAll(async () => { await runMigrations(pool); await app.ready(); });
  afterAll(async () => { await app.close(); await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("creates and fetches a context entry", async () => {
    const created = (await app.inject({ method: "POST", url: "/api/context", payload: { content: "We bill annually" } })).json();
    expect(created.status).toBe("active");
    const got = await app.inject({ method: "GET", url: `/api/context/${created.id}` });
    expect(got.statusCode).toBe(200);
  });

  it("rejects empty content with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/context", payload: { content: "" } });
    expect(res.statusCode).toBe(400);
  });

  it("capture endpoint requires text", async () => {
    const res = await app.inject({ method: "POST", url: "/api/capture", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("bulk endpoint requires a docs array", async () => {
    const res = await app.inject({ method: "POST", url: "/api/ingest/bulk", payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 3: Run + full suite + typecheck**

Run: `set -a && . ./.env && set +a && npm test && npx tsc -p tsconfig.json --noEmit`
Expected: ALL tests pass (v1 + v2), typecheck exit 0.

- [ ] **Step 4: Commit**

```bash
git add server/src/api/app.ts server/src/api/contextApi.test.ts
git commit -m "feat: REST endpoints for capture, bulk ingestion, and context CRUD"
```

---

### Task 9: Docs refresh

**Files:**
- Modify: `server/README.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Append a "Knowledge capture (v2)" section to `server/README.md`**

```markdown
## Knowledge capture (v2)
The brain stores two things: **skills** (executable processes) and **context**
(goals/decisions/preferences that inform the agent).

- `POST /api/capture { text }` — classify a work session into skills/context and file each.
  - context → stored active immediately.
  - skill → active only if confident AND all tools are reversible; else draft for review.
- `POST /api/ingest/bulk { docs: [{source,text}] }` — run capture over many docs.
- Context CRUD: `GET/POST /api/context`, `GET/PUT /api/context/:id`, `POST /api/context/:id/retire`, `GET /api/context/:id/versions`.
- MCP tools `capture` and `find_context` expose the same to an agent inside Claude.

Tunables: `CAPTURE_CONFIDENCE_MIN` (default 0.75), `CAPTURE_SIM_MAX` (default 0.2).
```

- [ ] **Step 2: Commit**

```bash
git add server/README.md
git commit -m "docs: document knowledge capture v2"
```

---

## Self-Review

**Spec coverage:**
- Two knowledge types (`context`) → Tasks 1–3. ✅
- Classify-and-route capture → Task 5. ✅
- Graduated autonomy (context active; skill gated by confidence+reversibility) → Task 5, gate from Task 4. ✅
- Tool-risk registry, unknown→destructive → Task 4. ✅
- Dedup update-vs-create via distance → Tasks 3, 4 (`*WithDistance`), used in Task 5. ✅
- MCP `capture` + `find_context` (the in-Claude connector) → Task 7. ✅
- Bulk ingestion, per-doc failure isolation → Task 6. ✅
- REST: capture, bulk, context CRUD → Task 8. ✅
- Run-time retrieval of both skills and context → `find_context` tool (Task 7) + endpoint. ✅
- Tests across all of the above → each task. ✅

**Placeholder scan:** none — every step has real code and assertions.

**Type consistency:** `CapturedItem`/`CaptureResult` defined in Task 5 and reused in Tasks 6–8. `findSkillWithDistance`/`findContextWithDistance` return `{ skill|entry, distance }` consistently. `AnthropicLike` reused from v1 `draftFromText.ts`. `NotFoundError` reused from skills repo. `resetDb` updated in Task 1 before any context test relies on it.

**Ordering note:** Task 5 (capture) depends on Tasks 3 (context repo) and 4 (toolRisk + findSkillWithDistance). Plan order respects this.
