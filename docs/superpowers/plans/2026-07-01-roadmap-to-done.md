# Brian — Roadmap to Done Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Nextstep.md roadmap: Brian's MCP server wired into Claude Code + Desktop, a draft-review CLI, a real Gmail business tool, and an authenticated HTTP surface with the agent contract — all running locally.

**Architecture:** Everything lives in the existing `server/` package (Node/TS, ESM, Fastify, pg, MCP SDK). New modules: `src/env.ts` (env loading), `src/review/` (review CLI), `src/gmail/` (Gmail client + auth CLI), `src/mcp/adapters.ts` (business-tool registry). The MCP server gains a Streamable HTTP transport mounted in the Fastify app; auth is a static bearer token.

**Tech Stack:** TypeScript 5.9 ESM, Node 24 (built-in `fetch`, `process.loadEnvFile`), Fastify 5, `@modelcontextprotocol/sdk` 1.20, zod 4, vitest 3, tsx.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-01-brian-roadmap-to-done-design.md`.
- TDD; all DB tests use the existing pattern: `const url = process.env.TEST_DATABASE_URL; const d = url ? describe : describe.skip;` + `runMigrations(pool)` + `resetDb(pool)` in `beforeEach` + `vi.mock("../db/embed.js", ...)` for embeddings. Tests never touch live `public` or live Gmail.
- Run tests: `cd server && set -a && . ./.env && set +a && npm test`. All 52 existing tests must keep passing.
- No new npm dependencies. Node built-ins and global `fetch` only.
- All new files are ESM with `.js` import specifiers (matching the codebase).
- Anti-goals still hold (CompanyBrain.md): no graph DB, no schedulers, no auto-live skills, no React UI work.
- Cloud deploy is OUT of scope; HTTP surface runs on localhost.
- Manual steps that need the founder's browser (Google OAuth consent, Claude Desktop restart) are marked **MANUAL**; do everything else autonomously.

---

### Task 1: `loadServerEnv()` — env loading for standalone entry points

**Files:**
- Create: `server/src/env.ts`
- Test: `server/src/env.test.ts`
- Modify: `server/src/mcp/index.ts`, `server/src/api/index.ts`

**Interfaces:**
- Produces: `loadServerEnv(envPath?: string): void` — loads `server/.env` into `process.env` (existing vars win; missing file is a no-op). Later tasks call it at the top of every standalone entry point (review CLI, gmail auth CLI, scripts).

- [ ] **Step 1: Write the failing test**

```ts
// server/src/env.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadServerEnv } from "./env.js";

describe("loadServerEnv", () => {
  it("loads vars from an env file without overriding existing ones", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brian-env-"));
    const file = path.join(dir, ".env");
    fs.writeFileSync(file, "BRIAN_TEST_FRESH=hello\nBRIAN_TEST_EXISTING=from_file\n");
    process.env.BRIAN_TEST_EXISTING = "already_set";
    delete process.env.BRIAN_TEST_FRESH;

    loadServerEnv(file);

    expect(process.env.BRIAN_TEST_FRESH).toBe("hello");
    expect(process.env.BRIAN_TEST_EXISTING).toBe("already_set");
  });

  it("is a no-op when the file does not exist", () => {
    expect(() => loadServerEnv("/nonexistent/path/.env")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/env.test.ts`
Expected: FAIL — cannot find module `./env.js`

- [ ] **Step 3: Write the implementation**

```ts
// server/src/env.ts
import path from "node:path";
import { fileURLToPath } from "node:url";

// Default: server/.env, resolved relative to this file (NOT process.cwd(),
// because Claude Desktop launches MCP servers from "/"). Works from both
// src/ (tsx) and dist/ (compiled): ../.env of either is the server root.
const DEFAULT_ENV_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.env"
);

export function loadServerEnv(envPath: string = DEFAULT_ENV_PATH): void {
  try {
    process.loadEnvFile(envPath); // built-in; never overrides existing vars
  } catch {
    // no .env file — rely on the exported environment
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/env.test.ts`
Expected: 2 PASS

- [ ] **Step 5: Call it from the MCP and API entry points**

```ts
// server/src/mcp/index.ts  (full new content)
import { loadServerEnv } from "../env.js";
loadServerEnv();

const { StdioServerTransport } = await import(
  "@modelcontextprotocol/sdk/server/stdio.js"
);
const { buildMcpServer } = await import("./server.js");

const server = buildMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Brian MCP server running on stdio");
```

(Dynamic imports so env is loaded before any module reads `process.env` at import time.)

```ts
// server/src/api/index.ts  (full new content)
import { loadServerEnv } from "../env.js";
loadServerEnv();

const { buildApp } = await import("./app.js");

const port = Number(process.env.PORT ?? 3001);
buildApp({ authToken: process.env.BRIAN_API_TOKEN ?? null })
  .listen({ port, host: "0.0.0.0" })
  .then((addr) => console.log(`API listening on ${addr}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

NOTE: `buildApp({ authToken })` doesn't exist until Task 10. Until then keep `buildApp()` with no arguments here; Task 10 changes this line. For THIS task write `buildApp()`.

- [ ] **Step 6: Verify the whole suite still passes**

Run: `cd server && set -a && . ./.env && set +a && npm test`
Expected: all tests pass (54 now: 52 + 2 new)

- [ ] **Step 7: Smoke-test the MCP entry without sourced env**

Run: `cd server && env -i HOME="$HOME" PATH="$PATH" sh -c 'echo "" | npx tsx src/mcp/index.ts' 2>&1 | head -2`
Expected: `Brian MCP server running on stdio` (no DATABASE_URL error)

- [ ] **Step 8: Commit**

```bash
git add server/src/env.ts server/src/env.test.ts server/src/mcp/index.ts server/src/api/index.ts
git commit -m "feat: load server/.env in-process for standalone entry points"
```

---

### Task 2: Register the MCP server in Claude Code and Claude Desktop

**Files:**
- Create: `.mcp.json` (repo root)
- Modify: `~/Library/Application Support/Claude/claude_desktop_config.json` (user file, NOT committed)

**Interfaces:**
- Consumes: working stdio entry from Task 1.
- Produces: `brian` MCP server available in both Claude clients.

- [ ] **Step 1: Create the project-scoped config for Claude Code**

```json
{
  "mcpServers": {
    "brian": {
      "command": "npm",
      "args": ["--prefix", "server", "run", "mcp"]
    }
  }
}
```

Save as `.mcp.json` at the repo root.

- [ ] **Step 2: Add the Desktop entry (preserve existing keys!)**

The Desktop config already has `coworkUserFilesPath` and `preferences` — merge, don't overwrite. Desktop launches from `/` with a minimal PATH, so use absolute paths (node binary + tsx CLI entry):

```bash
node -e '
const fs = require("fs");
const p = process.env.HOME + "/Library/Application Support/Claude/claude_desktop_config.json";
const c = JSON.parse(fs.readFileSync(p, "utf8"));
c.mcpServers = { ...(c.mcpServers || {}), brian: {
  command: process.argv[1],
  args: [process.argv[2], process.argv[3]]
}};
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log(JSON.stringify(c.mcpServers, null, 2));
' "$(command -v node)" "/Users/sameh/brian/server/node_modules/tsx/dist/cli.mjs" "/Users/sameh/brian/server/src/mcp/index.ts"
```

Expected output: the `mcpServers.brian` block with absolute paths.

- [ ] **Step 3: Verify the exact Desktop command works from a bare environment**

Run: `env -i sh -c '"$(command -v node)" /Users/sameh/brian/server/node_modules/tsx/dist/cli.mjs /Users/sameh/brian/server/src/mcp/index.ts < /dev/null' 2>&1 | head -2`

(Substitute the same absolute node path used in Step 2.)
Expected: `Brian MCP server running on stdio`

- [ ] **Step 4: MANUAL — smoke test from Claude**

Ask the founder (or do it if you are a Claude Code session in this repo after restart):
1. Claude Code: new session in `/Users/sameh/brian`, approve the `brian` project MCP server, then: call `find_skill` with query "refund" → expect a seeded skill JSON. Call `capture` with "We decided demos happen on Fridays" → expect a filed context item. Call `find_context` with "when do demos happen" → expect it back.
2. Claude Desktop: fully quit + reopen, check the tools icon shows `brian`, run the same three calls.

- [ ] **Step 5: Commit**

```bash
git add .mcp.json
git commit -m "feat: register brian MCP server for Claude Code (.mcp.json) and Desktop"
```

---

### Task 3: Review actions module (list / approve / reject)

**Files:**
- Create: `server/src/review/actions.ts`
- Test: `server/src/review/actions.test.ts`

**Interfaces:**
- Consumes: `listSkills(status?, pool?)`, `setStatus(id, status, pool?)` from `server/src/skills/repo.ts`; `Skill` from `server/src/skills/types.ts`.
- Produces: `listReviewable(p?): Promise<Skill[]>`, `approveSkill(id, p?): Promise<Skill>`, `rejectSkill(id, p?): Promise<Skill>`, `formatSkillLine(s: Skill): string` — used by the CLI in Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// server/src/review/actions.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import pg from "pg";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { createSkill, setStatus, getSkill } from "../skills/repo.js";
import { listReviewable, approveSkill, rejectSkill, formatSkillLine } from "./actions.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const base = {
  trigger: "t", inputs: [], procedure: "p", hard_rules: [], tools: [],
  guardrails: [], escalation_target: null, examples: [], owner: null,
};

d("review actions", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("lists draft and needs_review skills, not active ones", async () => {
    const a = await createSkill({ ...base, name: "Draft one" }, pool);
    const b = await createSkill({ ...base, name: "Flagged one" }, pool);
    await setStatus(b.id, "needs_review", pool);
    const c = await createSkill({ ...base, name: "Live one" }, pool);
    await setStatus(c.id, "active", pool);

    const list = await listReviewable(pool);
    const names = list.map((s) => s.name).sort();
    expect(names).toEqual(["Draft one", "Flagged one"]);
    expect(list.map((s) => s.id)).toContain(a.id);
  });

  it("approve activates and reject retires", async () => {
    const a = await createSkill({ ...base, name: "To approve" }, pool);
    const b = await createSkill({ ...base, name: "To reject" }, pool);

    const approved = await approveSkill(a.id, pool);
    expect(approved.status).toBe("active");
    expect(approved.last_reviewed_at).not.toBeNull();

    const rejected = await rejectSkill(b.id, pool);
    expect(rejected.status).toBe("retired");
    expect((await getSkill(a.id, pool))!.status).toBe("active");
  });

  it("formats a review line with id, status, name, version", () => {
    const line = formatSkillLine({
      id: "abc-123", name: "Refunds", status: "draft", version: 2, owner: "Sam",
    } as any);
    expect(line).toBe("[draft] Refunds (v2, owner: Sam)  id=abc-123");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && set -a && . ./.env && set +a && npx vitest run src/review/actions.test.ts`
Expected: FAIL — cannot find module `./actions.js`

- [ ] **Step 3: Write the implementation**

```ts
// server/src/review/actions.ts
import type pg from "pg";
import { pool as defaultPool } from "../db/pool.js";
import { listSkills, setStatus } from "../skills/repo.js";
import type { Skill } from "../skills/types.js";

// Skills parked by the graduated-autonomy gate (draft) or staleness
// detection (needs_review), oldest-updated last so fresh items surface first.
export async function listReviewable(p: pg.Pool = defaultPool): Promise<Skill[]> {
  const drafts = await listSkills("draft", p);
  const flagged = await listSkills("needs_review", p);
  return [...drafts, ...flagged];
}

export async function approveSkill(id: string, p: pg.Pool = defaultPool): Promise<Skill> {
  return setStatus(id, "active", p);
}

export async function rejectSkill(id: string, p: pg.Pool = defaultPool): Promise<Skill> {
  return setStatus(id, "retired", p);
}

export function formatSkillLine(s: Skill): string {
  return `[${s.status}] ${s.name} (v${s.version}, owner: ${s.owner ?? "unassigned"})  id=${s.id}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && set -a && . ./.env && set +a && npx vitest run src/review/actions.test.ts`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/review/actions.ts server/src/review/actions.test.ts
git commit -m "feat: review actions — list/approve/reject parked skills"
```

---

### Task 4: Review CLI (`npm run review`)

**Files:**
- Create: `server/src/review/cli.ts`
- Modify: `server/package.json` (add script)

**Interfaces:**
- Consumes: `listReviewable`, `approveSkill`, `rejectSkill`, `formatSkillLine` from Task 3; `getSkill` from `skills/repo.ts`; `loadServerEnv` from Task 1.
- Produces: `npm run review [-- <cmd>]` with subcommands `list` (default), `show <id>`, `approve <id>`, `reject <id>`.

- [ ] **Step 1: Write the CLI**

```ts
// server/src/review/cli.ts
import { loadServerEnv } from "../env.js";
loadServerEnv();

const { listReviewable, approveSkill, rejectSkill, formatSkillLine } = await import("./actions.js");
const { getSkill } = await import("../skills/repo.js");
const { pool } = await import("../db/pool.js");

const [cmd = "list", id] = process.argv.slice(2);

function requireId(): string {
  if (!id) {
    console.error(`usage: npm run review -- ${cmd} <skill-id>`);
    process.exit(1);
  }
  return id;
}

switch (cmd) {
  case "list": {
    const skills = await listReviewable();
    if (skills.length === 0) console.log("Review queue is empty. Nothing parked.");
    for (const s of skills) console.log(formatSkillLine(s));
    break;
  }
  case "show": {
    const s = await getSkill(requireId());
    if (!s) { console.error("skill not found"); process.exit(1); }
    console.log(JSON.stringify(s, null, 2));
    break;
  }
  case "approve": {
    const s = await approveSkill(requireId());
    console.log(`approved -> ${formatSkillLine(s)}`);
    break;
  }
  case "reject": {
    const s = await rejectSkill(requireId());
    console.log(`rejected -> ${formatSkillLine(s)}`);
    break;
  }
  default:
    console.error("usage: npm run review -- [list | show <id> | approve <id> | reject <id>]");
    process.exit(1);
}

await pool.end();
```

- [ ] **Step 2: Add the npm script**

In `server/package.json` `scripts`, after `"mcp"`:

```json
    "review": "tsx src/review/cli.ts"
```

- [ ] **Step 3: Verify against the live DB (read-only)**

Run: `cd server && npm run review`
Expected: `Review queue is empty. Nothing parked.` OR lines like `[draft] ... id=...` — either is a pass; it must not error. (Live `public` has 2 seeded ACTIVE skills, which must NOT appear.)

- [ ] **Step 4: Verify the full round trip in the test schema**

Run:
```bash
cd server && set -a && . ./.env && set +a && \
DATABASE_URL="$TEST_DATABASE_URL" sh -c '
  npm run review -- list
'
```
Expected: no error (queue listing from the `test` schema).

- [ ] **Step 5: Run the full suite**

Run: `cd server && set -a && . ./.env && set +a && npm test`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add server/src/review/cli.ts server/package.json
git commit -m "feat: review CLI — npm run review [list|show|approve|reject]"
```

---

### Task 5: Business-tool adapter registry

**Files:**
- Create: `server/src/mcp/adapters.ts`
- Test: `server/src/mcp/adapters.test.ts`
- Modify: `server/src/mcp/server.ts`

**Interfaces:**
- Consumes: `getOrder`, `issueRefund` from `server/src/mcp/businessTools.ts`.
- Produces: `interface ToolAdapter { name: string; description: string; inputSchema: Record<string, z.ZodType>; handler(args: Record<string, unknown>): Promise<unknown> | unknown }` and `businessAdapters(): ToolAdapter[]`. Task 7 appends Gmail adapters here. `null`/`undefined` handler results render as the text `NOT_FOUND` (preserves current MCP behavior).

- [ ] **Step 1: Write the failing test**

```ts
// server/src/mcp/adapters.test.ts
import { describe, it, expect } from "vitest";
import { businessAdapters } from "./adapters.js";

describe("business adapters", () => {
  it("exposes the mock order tools", () => {
    const names = businessAdapters().map((a) => a.name);
    expect(names).toContain("get_order");
    expect(names).toContain("issue_refund");
  });

  it("get_order returns the order or null", async () => {
    const get = businessAdapters().find((a) => a.name === "get_order")!;
    const order = (await get.handler({ order_id: "ORD-1" })) as { amount: number };
    expect(order.amount).toBe(40);
    expect(await get.handler({ order_id: "NOPE" })).toBeNull();
  });

  it("issue_refund echoes a refund receipt", async () => {
    const refund = businessAdapters().find((a) => a.name === "issue_refund")!;
    const r = (await refund.handler({ order_id: "ORD-1", amount: 40 })) as { refunded: boolean };
    expect(r.refunded).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/mcp/adapters.test.ts`
Expected: FAIL — cannot find module `./adapters.js`

- [ ] **Step 3: Write the registry**

```ts
// server/src/mcp/adapters.ts
import { z } from "zod";
import { getOrder, issueRefund } from "./businessTools.js";

export interface ToolAdapter {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export function businessAdapters(): ToolAdapter[] {
  return [
    {
      name: "get_order",
      description: "Look up an order by id.",
      inputSchema: { order_id: z.string() },
      handler: ({ order_id }) => getOrder(order_id as string),
    },
    {
      name: "issue_refund",
      description: "Issue a refund for an order.",
      inputSchema: { order_id: z.string(), amount: z.number() },
      handler: ({ order_id, amount }) => issueRefund(order_id as string, amount as number),
    },
  ];
}
```

- [ ] **Step 4: Register business tools from the registry in `server.ts`**

In `server/src/mcp/server.ts`: delete the two hardcoded `server.registerTool("get_order", ...)` and `server.registerTool("issue_refund", ...)` blocks (lines 34–52) and the `import { getOrder, issueRefund } from "./businessTools.js";` line. Add `import { businessAdapters } from "./adapters.js";` and, in `buildMcpServer()` after the `get_skill` registration:

```ts
  for (const tool of businessAdapters()) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        const result = await tool.handler(args);
        return {
          content: [
            { type: "text" as const, text: result == null ? "NOT_FOUND" : JSON.stringify(result) },
          ],
        };
      }
    );
  }
```

- [ ] **Step 5: Run the adapter test and the whole suite**

Run: `cd server && set -a && . ./.env && set +a && npm test`
Expected: all pass (including existing `loop.test.ts`, which exercises the mock tools through the MCP server)

- [ ] **Step 6: Commit**

```bash
git add server/src/mcp/adapters.ts server/src/mcp/adapters.test.ts server/src/mcp/server.ts
git commit -m "refactor: business tools register through an adapter registry"
```

---

### Task 6: Gmail API client (token exchange, create draft, send)

**Files:**
- Create: `server/src/gmail/client.ts`
- Test: `server/src/gmail/client.test.ts`

**Interfaces:**
- Produces:
  - `interface GmailConfig { clientId: string; clientSecret: string; refreshToken: string }`
  - `gmailConfigFromEnv(env?: NodeJS.ProcessEnv): GmailConfig | null` (reads `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`)
  - `interface EmailInput { to: string; subject: string; body: string }`
  - `createDraft(cfg, input, fetchFn?): Promise<{ draft_id: string }>`
  - `sendEmail(cfg, input, fetchFn?): Promise<{ message_id: string }>`
  - All network calls go through the injectable `fetchFn` (defaults to global `fetch`) so tests never hit Google.

- [ ] **Step 1: Write the failing test**

```ts
// server/src/gmail/client.test.ts
import { describe, it, expect, vi } from "vitest";
import { gmailConfigFromEnv, createDraft, sendEmail, type GmailConfig } from "./client.js";

const cfg: GmailConfig = { clientId: "cid", clientSecret: "sec", refreshToken: "rt" };

function fakeFetch(routes: Record<string, unknown>) {
  return vi.fn(async (url: string | URL) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) return { ok: false, status: 404, text: async () => "no route", json: async () => ({}) } as any;
    return { ok: true, status: 200, json: async () => routes[key], text: async () => "" } as any;
  });
}

describe("gmail client", () => {
  it("reads config from env, null when incomplete", () => {
    expect(
      gmailConfigFromEnv({ GMAIL_CLIENT_ID: "a", GMAIL_CLIENT_SECRET: "b", GMAIL_REFRESH_TOKEN: "c" } as any)
    ).toEqual({ clientId: "a", clientSecret: "b", refreshToken: "c" });
    expect(gmailConfigFromEnv({ GMAIL_CLIENT_ID: "a" } as any)).toBeNull();
  });

  it("createDraft exchanges the refresh token then posts a base64url message", async () => {
    const f = fakeFetch({
      "oauth2.googleapis.com/token": { access_token: "AT" },
      "gmail/v1/users/me/drafts": { id: "draft-9" },
    });
    const res = await createDraft(cfg, { to: "x@y.com", subject: "Hi", body: "Hello" }, f);
    expect(res).toEqual({ draft_id: "draft-9" });

    const draftCall = f.mock.calls.find((c) => String(c[0]).includes("drafts"))!;
    expect((draftCall[1] as any).headers.authorization).toBe("Bearer AT");
    const raw = JSON.parse((draftCall[1] as any).body).message.raw as string;
    const decoded = Buffer.from(raw, "base64url").toString();
    expect(decoded).toContain("To: x@y.com");
    expect(decoded).toContain("Subject: Hi");
    expect(decoded).toContain("Hello");
  });

  it("sendEmail posts to messages/send", async () => {
    const f = fakeFetch({
      "oauth2.googleapis.com/token": { access_token: "AT" },
      "messages/send": { id: "msg-7" },
    });
    const res = await sendEmail(cfg, { to: "x@y.com", subject: "s", body: "b" }, f);
    expect(res).toEqual({ message_id: "msg-7" });
  });

  it("throws a readable error when the token exchange fails", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 400, text: async () => "invalid_grant", json: async () => ({}) })) as any;
    await expect(createDraft(cfg, { to: "a@b.c", subject: "s", body: "b" }, f))
      .rejects.toThrow(/token exchange failed.*invalid_grant/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/gmail/client.test.ts`
Expected: FAIL — cannot find module `./client.js`

- [ ] **Step 3: Write the implementation**

```ts
// server/src/gmail/client.ts
export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface EmailInput {
  to: string;
  subject: string;
  body: string;
}

export type FetchFn = typeof fetch;

export function gmailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GmailConfig | null {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) return null;
  return { clientId: GMAIL_CLIENT_ID, clientSecret: GMAIL_CLIENT_SECRET, refreshToken: GMAIL_REFRESH_TOKEN };
}

async function getAccessToken(cfg: GmailConfig, fetchFn: FetchFn): Promise<string> {
  const res = await fetchFn("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) throw new Error(`gmail token exchange failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

// RFC 2822 message, base64url-encoded as the Gmail API requires.
function toRaw({ to, subject, body }: EmailInput): string {
  const msg = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    body,
  ].join("\r\n");
  return Buffer.from(msg).toString("base64url");
}

async function gmailPost(
  cfg: GmailConfig,
  path: string,
  payload: unknown,
  fetchFn: FetchFn
): Promise<any> {
  const token = await getAccessToken(cfg, fetchFn);
  const res = await fetchFn(`https://gmail.googleapis.com/gmail/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`gmail ${path} failed (${res.status}): ${await res.text()}`);
  return res.json();
}

export async function createDraft(
  cfg: GmailConfig,
  input: EmailInput,
  fetchFn: FetchFn = fetch
): Promise<{ draft_id: string }> {
  const json = await gmailPost(cfg, "users/me/drafts", { message: { raw: toRaw(input) } }, fetchFn);
  return { draft_id: json.id };
}

export async function sendEmail(
  cfg: GmailConfig,
  input: EmailInput,
  fetchFn: FetchFn = fetch
): Promise<{ message_id: string }> {
  const json = await gmailPost(cfg, "users/me/messages/send", { raw: toRaw(input) }, fetchFn);
  return { message_id: json.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/gmail/client.test.ts`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/gmail/client.ts server/src/gmail/client.test.ts
git commit -m "feat: gmail client — refresh-token auth, create draft, send"
```

---

### Task 7: Gmail tools in the adapter + risk registries

**Files:**
- Modify: `server/src/mcp/adapters.ts`, `server/src/mcp/toolRisk.ts`
- Test: modify `server/src/mcp/adapters.test.ts`, `server/src/mcp/toolRisk.test.ts`

**Interfaces:**
- Consumes: `gmailConfigFromEnv`, `createDraft`, `sendEmail` from Task 6; `ToolAdapter` from Task 5.
- Produces: MCP tools `create_email_draft(to, subject, body)` (risk `safe`) and `send_email(to, subject, body)` (risk `destructive`). Unconfigured Gmail → handler throws `"Gmail is not configured..."`.

- [ ] **Step 1: Add failing tests**

Append to `server/src/mcp/adapters.test.ts`:

```ts
import { createEmailAdapters } from "./adapters.js";

describe("gmail adapters", () => {
  it("are exposed as create_email_draft and send_email", () => {
    const names = businessAdapters().map((a) => a.name);
    expect(names).toContain("create_email_draft");
    expect(names).toContain("send_email");
  });

  it("create_email_draft calls the gmail client with the args", async () => {
    const calls: unknown[] = [];
    const [draftAdapter] = createEmailAdapters({
      config: { clientId: "a", clientSecret: "b", refreshToken: "c" },
      createDraftFn: async (_cfg, input) => { calls.push(input); return { draft_id: "d1" }; },
      sendEmailFn: async () => ({ message_id: "m1" }),
    });
    const res = await draftAdapter.handler({ to: "x@y.com", subject: "s", body: "b" });
    expect(res).toEqual({ draft_id: "d1" });
    expect(calls[0]).toEqual({ to: "x@y.com", subject: "s", body: "b" });
  });

  it("throws a clear error when gmail is not configured", async () => {
    const [draftAdapter] = createEmailAdapters({ config: null });
    await expect(draftAdapter.handler({ to: "a", subject: "b", body: "c" }))
      .rejects.toThrow(/Gmail is not configured/);
  });
});
```

Append to `server/src/mcp/toolRisk.test.ts` (inside its existing describe, or as a new one matching its style):

```ts
  it("classifies gmail tools: draft is safe, send is destructive", () => {
    expect(toolRisk("create_email_draft")).toBe("safe");
    expect(toolRisk("send_email")).toBe("destructive");
    expect(skillIsAutoSafe(["create_email_draft"])).toBe(true);
    expect(skillIsAutoSafe(["create_email_draft", "send_email"])).toBe(false);
  });
```

(Match the imports already present in `toolRisk.test.ts`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run src/mcp/adapters.test.ts src/mcp/toolRisk.test.ts`
Expected: FAIL — `createEmailAdapters` not exported; risk entries missing

- [ ] **Step 3: Implement**

In `server/src/mcp/toolRisk.ts`, add to `REGISTRY`:

```ts
  create_email_draft: "safe",   // reversible: a human reviews/sends/deletes the draft
  send_email: "destructive",    // irreversible once sent
```

In `server/src/mcp/adapters.ts`, add:

```ts
import {
  gmailConfigFromEnv, createDraft, sendEmail,
  type GmailConfig, type EmailInput,
} from "../gmail/client.js";

interface EmailAdapterDeps {
  config: GmailConfig | null;
  createDraftFn?: (cfg: GmailConfig, input: EmailInput) => Promise<{ draft_id: string }>;
  sendEmailFn?: (cfg: GmailConfig, input: EmailInput) => Promise<{ message_id: string }>;
}

export function createEmailAdapters(deps: EmailAdapterDeps): ToolAdapter[] {
  const { config, createDraftFn = createDraft, sendEmailFn = sendEmail } = deps;
  const requireConfig = (): GmailConfig => {
    if (!config) {
      throw new Error(
        "Gmail is not configured: set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in server/.env"
      );
    }
    return config;
  };
  const emailSchema = { to: z.string(), subject: z.string(), body: z.string() };
  return [
    {
      name: "create_email_draft",
      description:
        "Create a draft email in the company Gmail. Reversible: a human reviews and sends (or deletes) the draft.",
      inputSchema: emailSchema,
      handler: (args) => createDraftFn(requireConfig(), args as unknown as EmailInput),
    },
    {
      name: "send_email",
      description: "Send an email from the company Gmail immediately. Irreversible.",
      inputSchema: emailSchema,
      handler: (args) => sendEmailFn(requireConfig(), args as unknown as EmailInput),
    },
  ];
}
```

And change `businessAdapters()` to include them:

```ts
export function businessAdapters(): ToolAdapter[] {
  return [
    // ... the two mock adapters unchanged ...
    ...createEmailAdapters({ config: gmailConfigFromEnv() }),
  ];
}
```

- [ ] **Step 4: Run the full suite**

Run: `cd server && set -a && . ./.env && set +a && npm test`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add server/src/mcp/adapters.ts server/src/mcp/adapters.test.ts server/src/mcp/toolRisk.ts server/src/mcp/toolRisk.test.ts
git commit -m "feat: gmail business tools — create_email_draft (safe), send_email (destructive)"
```

---

### Task 8: `npm run gmail:auth` — one-time OAuth helper

**Files:**
- Create: `server/src/gmail/authCli.ts`
- Modify: `server/package.json` (add script)

**Interfaces:**
- Consumes: `loadServerEnv` from Task 1; `GMAIL_CLIENT_ID` + `GMAIL_CLIENT_SECRET` from `server/.env`.
- Produces: prints a `GMAIL_REFRESH_TOKEN=...` line for the founder to paste into `server/.env`.

- [ ] **Step 1: Write the helper**

```ts
// server/src/gmail/authCli.ts
// One-time local OAuth flow: opens a consent URL, catches the redirect on
// 127.0.0.1, exchanges the code, prints the refresh token to paste into .env.
import http from "node:http";
import { loadServerEnv } from "../env.js";

loadServerEnv();

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in server/.env first (see docs/gmail-setup.md).");
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}/callback`;

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/gmail.compose",
  access_type: "offline",
  prompt: "consent",
}).toString();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", redirectUri);
  if (url.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
  const code = url.searchParams.get("code");
  if (!code) { res.writeHead(400); res.end("missing ?code"); return; }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  const json = (await tokenRes.json()) as { refresh_token?: string; error?: string };

  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Done — return to the terminal.");
  server.close();

  if (json.refresh_token) {
    console.log("\nAdd this line to server/.env:\n");
    console.log(`GMAIL_REFRESH_TOKEN=${json.refresh_token}\n`);
  } else {
    console.error("No refresh_token returned:", JSON.stringify(json));
    process.exitCode = 1;
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Open this URL in your browser and approve access:\n");
  console.log(authUrl.toString() + "\n");
});
```

- [ ] **Step 2: Add the npm script**

In `server/package.json` `scripts`:

```json
    "gmail:auth": "tsx src/gmail/authCli.ts"
```

- [ ] **Step 3: Verify the guard path (no creds yet)**

Run: `cd server && GMAIL_CLIENT_ID= GMAIL_CLIENT_SECRET= npx tsx src/gmail/authCli.ts; echo "exit=$?"`
Expected: the "Set GMAIL_CLIENT_ID..." error and `exit=1`

- [ ] **Step 4: Write the founder setup doc**

Create `docs/gmail-setup.md`:

```markdown
# Gmail setup for Brian (one time, ~10 min)

1. Go to https://console.cloud.google.com/ → create (or pick) a project.
2. "APIs & Services" → "Library" → enable **Gmail API**.
3. "APIs & Services" → "OAuth consent screen" → External → fill app name
   ("Brian") + your email → add yourself (a7madinquiries@gmail.com) as a
   **test user**. Scopes can stay empty here.
4. "APIs & Services" → "Credentials" → "Create credentials" → **OAuth client ID**
   → Application type: **Desktop app** (Desktop clients allow loopback
   `http://127.0.0.1` redirects without registering the URI).
5. Copy the client ID + secret into `server/.env`:
   GMAIL_CLIENT_ID=...
   GMAIL_CLIENT_SECRET=...
6. Run `cd server && npm run gmail:auth`, open the printed URL, approve
   (Google will warn the app is unverified — "Continue" is fine, you are the
   only test user), and paste the printed `GMAIL_REFRESH_TOKEN=...` line into
   `server/.env`.
7. Never commit `.env`. The token has only the `gmail.compose` scope
   (create drafts + send); it cannot read mail.
```

- [ ] **Step 5: MANUAL — founder runs the flow**

The founder follows `docs/gmail-setup.md`. Blocked until done; continue with other tasks meanwhile (Task 9's live smoke is the only dependent step).

- [ ] **Step 6: Commit**

```bash
git add server/src/gmail/authCli.ts server/package.json docs/gmail-setup.md
git commit -m "feat: gmail:auth one-time OAuth helper + setup doc"
```

---

### Task 9: Live Gmail smoke test + "Customer inquiry reply" skill

**Files:**
- Create: `server/src/scripts/createInquiryReplySkill.ts`, `server/src/scripts/gmailSmoke.ts`

**Interfaces:**
- Consumes: `createSkill` from `skills/repo.ts`; gmail client from Task 6; review CLI from Task 4.
- Produces: one real skill (`Customer inquiry reply`, tools: `["create_email_draft"]`) active in live `public`; a proven real draft in the founder's Gmail.

- [ ] **Step 1: Write the smoke script (manual-run only, never in tests)**

```ts
// server/src/scripts/gmailSmoke.ts
// Manual smoke test: creates ONE real draft in the configured Gmail account.
import { loadServerEnv } from "../env.js";
loadServerEnv();

const { gmailConfigFromEnv, createDraft } = await import("../gmail/client.js");

const cfg = gmailConfigFromEnv();
if (!cfg) {
  console.error("Gmail not configured. Follow docs/gmail-setup.md first.");
  process.exit(1);
}
const res = await createDraft(cfg, {
  to: "a7madinquiries@gmail.com",
  subject: "Brian smoke test",
  body: "If you can read this in your Drafts folder, the Gmail adapter works. You can delete it.",
});
console.log(`Draft created: ${res.draft_id}. Check the Drafts folder, then delete it.`);
```

- [ ] **Step 2: Write the skill-creation script**

```ts
// server/src/scripts/createInquiryReplySkill.ts
// One-off: hand-author the first Gmail-backed skill (CompanyBrain.md Phase 1).
// Creates it as draft; approve with `npm run review -- approve <id>`.
import { loadServerEnv } from "../env.js";
loadServerEnv();

const { createSkill } = await import("../skills/repo.js");
const { pool } = await import("../db/pool.js");

const skill = await createSkill({
  name: "Customer inquiry reply",
  trigger: "A customer emails a question about the product, pricing, or their account and needs a reply.",
  inputs: ["customer_email", "inquiry_summary"],
  procedure:
    "1. Read the inquiry and identify the actual question. " +
    "2. Call find_context for relevant company decisions or preferences before answering. " +
    "3. Write a concise, friendly reply that answers the question directly; if you don't know, say a human will follow up. " +
    "4. Create the reply as a Gmail draft with create_email_draft, addressed to the customer. " +
    "5. Do NOT send email; a human reviews and sends the draft.",
  hard_rules: [
    "Never send email directly; only create drafts.",
    "Never promise refunds, discounts, or legal terms in a reply.",
    "Never include internal information (credentials, internal URLs, other customers' data) in a draft.",
  ],
  tools: ["create_email_draft"],
  guardrails: [
    "If the inquiry threatens legal action or cancellation, STOP and escalate.",
    "If the inquiry involves billing disputes or refunds, STOP and escalate.",
    "If you are not confident the answer is factually correct, STOP and escalate.",
  ],
  escalation_target: "Founder (a7madinquiries@gmail.com)",
  examples: [
    {
      scenario: "Customer asks whether the product supports exporting data to CSV.",
      correct_action:
        "Check context for the real capability, write a short factual reply, create a Gmail draft to the customer. Human sends.",
    },
    {
      scenario: "Customer says they were double-charged and demands a refund.",
      correct_action: "Billing dispute -> do NOT draft a reply with promises; escalate to the founder.",
    },
  ],
  owner: "Founder",
});

console.log(`created "${skill.name}" as ${skill.status}: id=${skill.id}`);
console.log(`approve with: npm run review -- approve ${skill.id}`);
await pool.end();
```

- [ ] **Step 3: Verify the suite is untouched**

Run: `cd server && set -a && . ./.env && set +a && npm test`
Expected: all pass (scripts are not imported by anything)

- [ ] **Step 4: MANUAL/GATED — run against live (requires Task 8 creds)**

```bash
cd server
npx tsx src/scripts/gmailSmoke.ts            # expect: "Draft created: ..."
npx tsx src/scripts/createInquiryReplySkill.ts
npm run review                                # shows the draft skill
npm run review -- approve <id-from-above>     # -> [active]
```

Then the e2e proof from a Claude session with the `brian` MCP server: say
"A customer (test@example.com) asked whether we support CSV export — handle it."
Expected agent behavior: `find_skill` → gets "Customer inquiry reply" → `find_context` → `create_email_draft` → a real draft appears in Gmail → agent reports done. Verify the draft exists, then delete it.

- [ ] **Step 5: Commit**

```bash
git add server/src/scripts/createInquiryReplySkill.ts server/src/scripts/gmailSmoke.ts
git commit -m "feat: gmail live smoke script + hand-authored Customer inquiry reply skill"
```

---

### Task 10: Bearer-token auth on the REST API

**Files:**
- Modify: `server/src/api/app.ts`, `server/src/api/index.ts`
- Test: modify `server/src/api/app.test.ts` (add a new describe; don't touch existing tests)

**Interfaces:**
- Consumes: existing `buildApp()`.
- Produces: `buildApp(opts?: { authToken?: string | null })` — when `authToken` is set, every route (including `/mcp` from Task 11) requires `Authorization: Bearer <token>`; wrong/missing token → `401 { error: "unauthorized" }`. No token configured → open (current behavior, keeps existing tests green).

- [ ] **Step 1: Write the failing test**

Append to `server/src/api/app.test.ts` (reuse its existing imports/mocks; add `buildApp` import if not present):

```ts
describe("bearer auth", () => {
  it("rejects requests without or with a wrong token, accepts the right one", async () => {
    const app = buildApp({ authToken: "sekret" });

    const noAuth = await app.inject({ method: "GET", url: "/api/skills" });
    expect(noAuth.statusCode).toBe(401);
    expect(noAuth.json()).toEqual({ error: "unauthorized" });

    const badAuth = await app.inject({
      method: "GET", url: "/api/skills", headers: { authorization: "Bearer wrong" },
    });
    expect(badAuth.statusCode).toBe(401);

    const goodAuth = await app.inject({
      method: "GET", url: "/api/skills", headers: { authorization: "Bearer sekret" },
    });
    expect(goodAuth.statusCode).toBe(200);
  });

  it("stays open when no token is configured", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/api/skills" });
    expect(res.statusCode).toBe(200);
  });
});
```

(If `app.test.ts` is DB-gated with `describe.skip`, put this inside the same gating — `listSkills` hits the DB.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && set -a && . ./.env && set +a && npx vitest run src/api/app.test.ts`
Expected: FAIL — `buildApp` takes no options / 401 not returned

- [ ] **Step 3: Implement**

In `server/src/api/app.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

function bearerMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice("Bearer ".length));
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

export interface AppOptions {
  authToken?: string | null;
}

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const authToken = opts.authToken ?? null;

  if (authToken) {
    app.addHook("onRequest", async (req, reply) => {
      if (!bearerMatches(req.headers.authorization, authToken)) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    });
  }
  // ... rest of buildApp unchanged
```

In `server/src/api/index.ts`, change the build line to:

```ts
buildApp({ authToken: process.env.BRIAN_API_TOKEN ?? null })
```

- [ ] **Step 4: Run the full suite**

Run: `cd server && set -a && . ./.env && set +a && npm test`
Expected: all pass (existing API tests call `buildApp()` → open mode)

- [ ] **Step 5: Generate and store a token**

Run: `cd server && echo "BRIAN_API_TOKEN=$(openssl rand -hex 32)" >> .env && grep -c BRIAN_API_TOKEN .env`
Expected: `1`

- [ ] **Step 6: Commit**

```bash
git add server/src/api/app.ts server/src/api/app.test.ts server/src/api/index.ts
git commit -m "feat: optional bearer-token auth on the REST API (BRIAN_API_TOKEN)"
```

---

### Task 11: MCP over Streamable HTTP at `/mcp`

**Files:**
- Create: `server/src/mcp/http.ts`
- Test: `server/src/mcp/http.test.ts`
- Modify: `server/src/api/app.ts` (mount)

**Interfaces:**
- Consumes: `buildMcpServer()` from `server/src/mcp/server.ts`; `buildApp` from Task 10.
- Produces: `registerMcpHttp(app: FastifyInstance): void` — stateless Streamable HTTP endpoint `POST /mcp` (fresh server+transport per request; GET/DELETE → 405). Inherits bearer auth from the app-level hook.

- [ ] **Step 1: Write the failing test**

```ts
// server/src/mcp/http.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { buildApp } from "../api/app.js";

const initReq = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.0" },
  },
};

const mcpHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

describe("MCP over streamable HTTP", () => {
  it("answers initialize on POST /mcp", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/mcp", headers: mcpHeaders, payload: initReq });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"serverInfo"');
    expect(res.body).toContain('"brian"');
  });

  it("rejects GET with 405", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/mcp", headers: { accept: "application/json, text/event-stream" } });
    expect(res.statusCode).toBe(405);
  });

  it("requires the bearer token when auth is on", async () => {
    const app = buildApp({ authToken: "sekret" });
    const res = await app.inject({ method: "POST", url: "/mcp", headers: mcpHeaders, payload: initReq });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/mcp/http.test.ts`
Expected: FAIL — 404 on `/mcp`

- [ ] **Step 3: Implement the transport mount**

```ts
// server/src/mcp/http.ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "./server.js";

// Stateless mode: a fresh server + transport per request. Simple, no session
// bookkeeping, and safe for concurrent clients; fine at this scale.
async function handlePost(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  reply.hijack(); // the transport writes directly to the raw response
  req.raw.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req.raw, reply.raw, req.body);
}

export function registerMcpHttp(app: FastifyInstance): void {
  app.post("/mcp", handlePost);
  const notAllowed = async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.code(405).send({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed. Use POST (stateless mode)." },
      id: null,
    });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
```

In `server/src/api/app.ts`: add `import { registerMcpHttp } from "../mcp/http.js";` and call `registerMcpHttp(app);` right before `return app;`.

- [ ] **Step 4: Run test to verify it passes, then the full suite**

Run: `cd server && set -a && . ./.env && set +a && npm test`
Expected: all pass. If the initialize test hangs: `app.inject` buffers hijacked responses only after the raw response ends — ensure `handlePost` awaits `transport.handleRequest` and nothing keeps the socket open; for a non-streaming JSON-RPC response the transport ends the response itself.

- [ ] **Step 5: Live curl smoke**

```bash
cd server && set -a && . ./.env && set +a && (npm run api &) && sleep 3 && \
curl -s -X POST http://127.0.0.1:3001/mcp \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "authorization: Bearer $BRIAN_API_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' \
  | head -5; kill %1
```
Expected: a response containing `"serverInfo"` and `"brian"`; and without the auth header a `{"error":"unauthorized"}`.

- [ ] **Step 6: Commit**

```bash
git add server/src/mcp/http.ts server/src/mcp/http.test.ts server/src/api/app.ts
git commit -m "feat: MCP Streamable HTTP endpoint at /mcp (stateless, auth-gated)"
```

---

### Task 12: `log_execution` MCP tool

**Files:**
- Modify: `server/src/mcp/server.ts`
- Test: `server/src/mcp/logExecutionTool.test.ts`

**Interfaces:**
- Consumes: `logExecution(row, p?)` from `server/src/feedback/executions.ts` (fields: `skill_id`, `skill_version`, `task_input`, `actions_taken`, `outcome: "completed" | "escalated" | "failed"`, `human_override`).
- Produces: MCP tool `log_execution(skill_id: string | null, skill_version: number | null, task_input: string, actions_taken: string, outcome)` returning the stored execution row as JSON text. This is the remote agent's write path for the feedback loop.

- [ ] **Step 1: Write the failing test**

```ts
// server/src/mcp/logExecutionTool.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { createSkill } from "../skills/repo.js";
import { listExecutions } from "../feedback/executions.js";
import { buildMcpServer } from "./server.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("log_execution MCP tool", () => {
  let pool: pg.Pool;
  beforeAll(async () => { pool = new pg.Pool({ connectionString: url }); await runMigrations(pool); });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("writes an execution row through the MCP surface", async () => {
    const s = await createSkill(
      { name: "X", trigger: "t", inputs: [], procedure: "p", hard_rules: [], tools: [],
        guardrails: [], escalation_target: null, examples: [], owner: null }, pool);

    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = buildMcpServer();
    const client = new Client({ name: "test", version: "0.0.0" });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    const res = await client.callTool({
      name: "log_execution",
      arguments: {
        skill_id: s.id,
        skill_version: 1,
        task_input: "customer asked for CSV export info",
        actions_taken: "find_skill; create_email_draft(draft_id=d1)",
        outcome: "completed",
      },
    });
    expect(JSON.parse((res.content as any)[0].text).outcome).toBe("completed");

    // NOTE: the tool writes via the default pool. Under vitest the default
    // pool also uses TEST_DATABASE_URL (see db/pool.ts), so this is the same DB.
    const log = await listExecutions(s.id, pool);
    expect(log.length).toBe(1);
    expect(log[0].task_input).toBe("customer asked for CSV export info");

    await client.close();
    await server.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && set -a && . ./.env && set +a && npx vitest run src/mcp/logExecutionTool.test.ts`
Expected: FAIL — tool `log_execution` not found

- [ ] **Step 3: Register the tool**

In `server/src/mcp/server.ts`, add `import { logExecution } from "../feedback/executions.js";` and, after the `find_context` registration:

```ts
  server.registerTool(
    "log_execution",
    {
      description:
        "Log a skill execution to the feedback loop: what was asked, what was done, and the outcome. Call this after finishing (or escalating) a task.",
      inputSchema: {
        skill_id: z.string().nullable(),
        skill_version: z.number().nullable(),
        task_input: z.string(),
        actions_taken: z.string(),
        outcome: z.enum(["completed", "escalated", "failed"]),
      },
    },
    async ({ skill_id, skill_version, task_input, actions_taken, outcome }) => {
      const row = await logExecution({
        skill_id, skill_version, task_input, actions_taken, outcome, human_override: null,
      });
      return { content: [{ type: "text", text: JSON.stringify(row) }] };
    }
  );
```

- [ ] **Step 4: Run test to verify it passes, then the full suite**

Run: `cd server && set -a && . ./.env && set +a && npm test`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add server/src/mcp/server.ts server/src/mcp/logExecutionTool.test.ts
git commit -m "feat: log_execution MCP tool — remote agents write the feedback loop"
```

---

### Task 13: Agent contract doc + Nextstep.md update + final verification

**Files:**
- Create: `docs/agent-contract.md`
- Modify: `Nextstep.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the system-prompt contract any agent gets before using Brian; an updated state snapshot.

- [ ] **Step 1: Write the agent contract**

```markdown
# Brian — Agent Contract

Paste this into the system prompt of ANY agent connected to Brian's MCP server
(stdio locally, or `POST /mcp` with `Authorization: Bearer <BRIAN_API_TOKEN>`).

---

You are connected to Brian, this company's brain. Brian supplies judgment and
rules; you execute. Follow this contract on every task:

1. **Before acting**, call `find_skill` with a description of the task, and
   `find_context` for relevant goals/decisions/preferences. If no skill
   matches, say so and ask a human — do not improvise a process.
2. **Follow the skill's `procedure`** step by step, staying strictly within its
   `hard_rules`. Hard rules are non-negotiable, even if the user asks otherwise.
3. **Check `guardrails` before every action.** If any guardrail condition is
   met, STOP immediately and escalate to the skill's `escalation_target` with a
   short summary. Escalating is success, not failure.
4. **Use only the tools the skill lists** for business actions.
5. **After finishing or escalating**, call `log_execution` with the skill id
   and version, what you were asked (`task_input`), what you did
   (`actions_taken`), and the outcome (`completed` | `escalated` | `failed`).
6. **When you learn something durable** (a decision, a preference, a process
   change), call `capture` with it so the brain stays current.
```

- [ ] **Step 2: Update Nextstep.md**

Rewrite the "Next steps (prioritized)" section: mark #1–#4 done with one-line pointers (`.mcp.json`, `npm run review`, `docs/gmail-setup.md`, `POST /mcp` + `docs/agent-contract.md`), note that cloud deploy was deliberately deferred (local-only), and set "Last updated" to today's date. Keep "Environment / infra facts" intact, adding `BRIAN_API_TOKEN` and the three `GMAIL_*` vars to the env list.

- [ ] **Step 3: Final full verification**

Run: `cd server && set -a && . ./.env && set +a && npm test`
Expected: ALL tests pass (expect ~68+, from 52).
Run: `cd server && npm run build`
Expected: tsc exits 0.

- [ ] **Step 4: Commit**

```bash
git add docs/agent-contract.md Nextstep.md
git commit -m "docs: agent system-prompt contract + roadmap status update"
```

- [ ] **Step 5: Remind the founder (message, not code)**

Rotate the OpenAI API key (it was shared in chat) and update `server/.env`.
