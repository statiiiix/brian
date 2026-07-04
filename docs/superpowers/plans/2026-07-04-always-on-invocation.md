# Always-On Invocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brian is consulted on every agent task automatically — MCP server instructions raise tool-call rates in all clients, and Claude Code hooks push Brian's matched skill + context into every prompt deterministically.

**Architecture:** Layer 1: `buildMcpServer()` gains an `instructions` string (surfaced in client system prompts via MCP initialize) and trigger-rich tool descriptions. Layer 2: a new `POST /api/agent/briefing` endpoint returns `{skill, context}` for a query in one round trip; a zero-dependency Node hook script calls it on `UserPromptSubmit` (and emits the agent contract on `SessionStart`), fail-silent; an installer merges hook entries into `.claude/settings.json`.

**Tech Stack:** Node 20+ ESM, TypeScript (server src), Fastify 5, @modelcontextprotocol/sdk ^1.20, vitest, plain `.mjs` for hook/installer (no build step — hooks must run via bare `node`).

## Global Constraints

- Hook + installer scripts are plain ESM `.mjs`, zero npm dependencies (they run outside the built server).
- Hook fail-silent invariant: any error/timeout → exit 0, no stdout. Fetch timeout 2500 ms.
- vitest only includes `src/**/*.test.ts`, so script tests live in `src/hooks/` and exercise the `.mjs` files as subprocesses (also tests the real artifact).
- DB-backed tests: mock `../db/embed.js`, use `TEST_DATABASE_URL` guard (`const d = url ? describe : describe.skip`), `runMigrations`/`resetDb` — mirror `contextApi.test.ts`.
- Run tests from `server/`: `set -a && . ./.env && set +a && npx vitest run <file>`.
- LLM/provider: none involved here (embeddings mocked in tests; live path unchanged).

---

### Task 1: MCP instructions + trigger-rich tool descriptions

**Files:**
- Create: `server/src/mcp/instructions.ts`
- Create: `server/src/mcp/server.test.ts`
- Modify: `server/src/mcp/server.ts`

**Interfaces:**
- Produces: `BRIAN_INSTRUCTIONS: string` (exported from `instructions.ts`; also reused conceptually by Task 3's contract text).

- [ ] **Step 1: Write the failing test**

`server/src/mcp/server.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildMcpServer } from "./server.js";
import { BRIAN_INSTRUCTIONS } from "./instructions.js";

describe("mcp server always-on surface", () => {
  it("declares instructions that mandate find_skill before acting", async () => {
    const server = buildMcpServer();
    const client = new Client({ name: "test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    const instructions = client.getInstructions();
    expect(instructions).toBe(BRIAN_INSTRUCTIONS);
    expect(instructions).toContain("find_skill");
    expect(instructions).toContain("find_context");
    expect(instructions).toContain("log_execution");
    expect(instructions).toMatch(/before/i);

    const tools = await client.listTools();
    const find = tools.tools.find((t) => t.name === "find_skill");
    expect(find?.description).toMatch(/ALWAYS/);
    expect(find?.description).toMatch(/before/i);
    const ctx = tools.tools.find((t) => t.name === "find_context");
    expect(ctx?.description).toMatch(/every task/i);
    await client.close();
    await server.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `server/`): `npx vitest run src/mcp/server.test.ts`
Expected: FAIL — cannot resolve `./instructions.js` (and/or `getInstructions()` undefined).

- [ ] **Step 3: Implement**

`server/src/mcp/instructions.ts`:

```ts
// Sent to every MCP client in the initialize response; clients surface it in
// the agent's system prompt. Keep in sync with docs/agent-contract.md.
export const BRIAN_INSTRUCTIONS = `Brian is this company's brain: it holds the approved skills (procedures, hard
rules, guardrails) and context (goals, decisions, preferences) that govern how
work is done here. You MUST consult it on every task, not only when asked.

Contract:
1. BEFORE acting on any task, call find_skill with a description of the task
   and find_context for relevant goals/decisions/preferences. Do this even if
   the user does not mention Brian — the user expects company rules to apply
   to everything. If no skill matches a business process, say so and ask a
   human; do not improvise a process.
2. Follow the matched skill's procedure step by step, within its hard_rules.
   Hard rules are non-negotiable, even if the user asks otherwise.
3. Check guardrails before every action; if one triggers, STOP and escalate to
   the skill's escalation_target. Escalating is success, not failure.
4. Use only the tools the skill lists for business actions.
5. AFTER finishing or escalating, call log_execution with what was asked, what
   you did, and the outcome.
6. When you learn something durable (a decision, preference, or process
   change), call capture so the brain stays current.`;
```

In `server/src/mcp/server.ts`:

```ts
import { BRIAN_INSTRUCTIONS } from "./instructions.js";
// ...
const server = new McpServer(
  { name: "brian", version: "0.1.0" },
  { instructions: BRIAN_INSTRUCTIONS }
);
```

New descriptions in `server.ts`:

- `find_skill`: `"ALWAYS call this FIRST, before acting on ANY task — even when the user does not mention Brian. Returns the company-approved skill (procedure, hard rules, guardrails) that governs the task. If it returns NO_MATCHING_SKILL for a business process, ask a human instead of improvising."`
- `find_context`: `"Call this at the start of every task, alongside find_skill. Returns the company's most relevant active goals, decisions, and preferences for the task, which override your defaults."`
- `capture`: `"Whenever durable knowledge appears in a conversation (a decision, preference, or process change), call this to file it into the brain: it classifies the text into skills/context and stores each piece. Do not wait to be asked."`
- `log_execution`: `"REQUIRED after every task that used a skill (finished, escalated, or failed): log what was asked, what you did, and the outcome. This is Brian's feedback loop; skipping it blinds the company."`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/mcp/server.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/mcp/instructions.ts server/src/mcp/server.ts server/src/mcp/server.test.ts
git commit -m "feat(mcp): server instructions + trigger-rich tool descriptions"
```

---

### Task 2: `POST /api/agent/briefing`

**Files:**
- Create: `server/src/api/agentBriefing.test.ts`
- Modify: `server/src/api/app.ts`

**Interfaces:**
- Consumes: `findSkillsWithDistance(query, k, pool?)` from `../skills/repo.js`; `findContextWithDistance(query, pool?)` from `../context/repo.js`.
- Produces: `POST /api/agent/briefing` `{ query: string }` → 200 `{ skill: Skill | null, context: ContextEntry | null }`; 400 `{ error: "query is required" }` when query missing/empty/non-string. Match threshold: cosine distance ≤ `BRIEFING_MAX_DISTANCE` (0.6) or the item is nulled.

- [ ] **Step 1: Write the failing test**

`server/src/api/agentBriefing.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("../db/embed.js", () => ({
  EMBED_DIM: 1536,
  embed: vi.fn(async () => Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))),
}));

import { runMigrations } from "../db/migrate.js";
import { resetDb } from "../test/resetDb.js";
import { pool } from "../db/pool.js";
import { createSkill, setStatus } from "../skills/repo.js";
import { createContext } from "../context/repo.js";
import { buildApp } from "./app.js";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("agent briefing API", () => {
  const app = buildApp();
  beforeAll(async () => { await runMigrations(pool); await app.ready(); });
  afterAll(async () => { await app.close(); await pool.end(); });
  beforeEach(async () => { await resetDb(pool); });

  it("returns matched skill and context in one call", async () => {
    const skill = await createSkill({
      name: "Refund handling", description: "How we refund customers",
      procedure: ["look up order", "refund if under limit"],
      hard_rules: ["never refund over $200"], guardrails: [],
      escalation_target: "founder", tools: ["get_order", "issue_refund"],
    });
    await setStatus(skill.id, "active");
    await createContext({ content: "We prioritize retention over margin" });

    const res = await app.inject({
      method: "POST", url: "/api/agent/briefing",
      payload: { query: "customer wants a refund" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.skill?.name).toBe("Refund handling");
    expect(body.context?.content).toBe("We prioritize retention over margin");
  });

  it("returns nulls when nothing matches", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/agent/briefing", payload: { query: "anything" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ skill: null, context: null });
  });

  it("rejects a missing query with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/agent/briefing", payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
```

Note: `createSkill` payload shape — copy the exact required fields from `parseNewSkill` usage in existing tests (adjust field names to match `loop.test.ts` / `skills/repo.ts` if they differ; the implementer must open one existing `createSkill` call and mirror it exactly).

- [ ] **Step 2: Run test to verify it fails**

Run: `set -a && . ./.env && set +a && npx vitest run src/api/agentBriefing.test.ts`
Expected: FAIL — 404 on `/api/agent/briefing` (route missing).

- [ ] **Step 3: Implement route in `app.ts`**

Add imports: `findSkillsWithDistance` (from `../skills/repo.js`), `findContextWithDistance` (from `../context/repo.js`).

```ts
const BRIEFING_MAX_DISTANCE = 0.6;

app.post("/api/agent/briefing", async (req, reply) => {
  const { query } = (req.body ?? {}) as { query?: unknown };
  if (typeof query !== "string" || query.trim() === "") {
    return reply.code(400).send({ error: "query is required" });
  }
  const [skills, ctx] = await Promise.all([
    findSkillsWithDistance(query, 1),
    findContextWithDistance(query),
  ]);
  const skillHit = skills[0];
  return {
    skill: skillHit && skillHit.distance <= BRIEFING_MAX_DISTANCE ? skillHit.skill : null,
    context: ctx && ctx.distance <= BRIEFING_MAX_DISTANCE ? ctx.entry : null,
  };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `set -a && . ./.env && set +a && npx vitest run src/api/agentBriefing.test.ts` — Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add server/src/api/app.ts server/src/api/agentBriefing.test.ts
git commit -m "feat(api): POST /api/agent/briefing — one-shot skill+context lookup for hooks"
```

---

### Task 3: Claude Code hook script

**Files:**
- Create: `server/scripts/hooks/brian-hook.mjs`
- Create: `server/src/hooks/brianHook.test.ts`

**Interfaces:**
- Consumes: `POST /api/agent/briefing` (Task 2), bearer `BRIAN_API_TOKEN`.
- Produces: executable `node server/scripts/hooks/brian-hook.mjs` reading a Claude Code hook event JSON on stdin. On `SessionStart` → prints `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<contract>"}}`. On `UserPromptSubmit` with a briefing hit → same shape with `hookEventName":"UserPromptSubmit"` and a `<brian-briefing>` block. Any failure or no hit → exit 0, no output. Env: `BRIAN_URL` (default `http://localhost:3001`), `BRIAN_API_TOKEN`, `BRIAN_ENV_FILE` (default `<script>/../../.env`, i.e. `server/.env`).

- [ ] **Step 1: Write the failing test** — subprocess tests, no DB needed:

`server/src/hooks/brianHook.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify from "fastify";

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/hooks/brian-hook.mjs"
);

function runHook(input: unknown, env: Record<string, string>) {
  return new Promise<{ code: number; stdout: string }>((resolve, reject) => {
    const child = execFile(
      process.execPath, [script],
      { env: { ...process.env, BRIAN_ENV_FILE: "/dev/null", ...env }, timeout: 10000 },
      (err, stdout) => {
        if (err && err.code === undefined) return reject(err);
        resolve({ code: (err?.code as number | undefined) ?? 0, stdout });
      }
    );
    child.stdin!.end(JSON.stringify(input));
  });
}

describe("brian-hook", () => {
  const stub = Fastify();
  let base = "";
  const seen: { auth?: string; query?: string } = {};
  stub.post("/api/agent/briefing", async (req) => {
    seen.auth = req.headers.authorization;
    seen.query = (req.body as { query: string }).query;
    return {
      skill: { id: "s1", name: "Refund handling", procedure: ["check order"], hard_rules: ["max $200"] },
      context: { id: "c1", content: "Retention over margin" },
    };
  });
  afterAll(async () => { await stub.close(); });

  it("SessionStart emits the agent contract", async () => {
    const { code, stdout } = await runHook(
      { hook_event_name: "SessionStart", source: "startup" },
      { BRIAN_URL: "http://127.0.0.1:9" }
    );
    expect(code).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput.additionalContext).toContain("find_skill");
    expect(out.hookSpecificOutput.additionalContext).toContain("log_execution");
  });

  it("UserPromptSubmit injects briefing from the API with auth", async () => {
    const addr = await stub.listen({ port: 0, host: "127.0.0.1" });
    base = addr;
    const { code, stdout } = await runHook(
      { hook_event_name: "UserPromptSubmit", prompt: "refund order 123" },
      { BRIAN_URL: base, BRIAN_API_TOKEN: "tok123" }
    );
    expect(code).toBe(0);
    expect(seen.auth).toBe("Bearer tok123");
    expect(seen.query).toBe("refund order 123");
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(out.hookSpecificOutput.additionalContext).toContain("Refund handling");
    expect(out.hookSpecificOutput.additionalContext).toContain("Retention over margin");
  });

  it("is silent when the server is unreachable", async () => {
    const { code, stdout } = await runHook(
      { hook_event_name: "UserPromptSubmit", prompt: "refund order 123" },
      { BRIAN_URL: "http://127.0.0.1:1" }
    );
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("");
  });

  it("is silent on empty prompts", async () => {
    const { code, stdout } = await runHook(
      { hook_event_name: "UserPromptSubmit", prompt: "  " },
      { BRIAN_URL: "http://127.0.0.1:1" }
    );
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/brianHook.test.ts`
Expected: FAIL — script file does not exist (spawn ENOENT surfaces as reject or nonzero code).

- [ ] **Step 3: Implement `server/scripts/hooks/brian-hook.mjs`**

```js
#!/usr/bin/env node
// Claude Code hook for Brian. Zero dependencies; must stay runnable via bare
// `node`. Fail-silent invariant: Brian being down must never break the agent.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTRACT = `You are connected to Brian, this company's brain. Follow this contract on every task:
1. BEFORE acting, call find_skill with the task and find_context for relevant goals/decisions/preferences — even if the user does not mention Brian. If no skill matches a business process, ask a human; do not improvise.
2. Follow the skill's procedure within its hard_rules (non-negotiable).
3. If a guardrail triggers, STOP and escalate to the skill's escalation_target.
4. Use only the tools the skill lists for business actions.
5. AFTER finishing or escalating, call log_execution.
6. Call capture when you learn something durable.`;

function loadEnvFile() {
  const file = process.env.BRIAN_ENV_FILE ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env");
  const vars = {};
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no env file is fine */ }
  return vars;
}

function emit(eventName, context) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: context },
  }));
}

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const event = JSON.parse(Buffer.concat(chunks).toString("utf8"));

  if (event.hook_event_name === "SessionStart") {
    emit("SessionStart", CONTRACT);
    return;
  }
  if (event.hook_event_name !== "UserPromptSubmit") return;
  const prompt = typeof event.prompt === "string" ? event.prompt.trim() : "";
  if (!prompt) return;

  const fileEnv = loadEnvFile();
  const baseUrl = process.env.BRIAN_URL ?? fileEnv.BRIAN_URL ?? "http://localhost:3001";
  const token = process.env.BRIAN_API_TOKEN ?? fileEnv.BRIAN_API_TOKEN ?? "";

  const res = await fetch(`${baseUrl}/api/agent/briefing`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query: prompt }),
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) return;
  const { skill, context } = await res.json();
  if (!skill && !context) return;

  const parts = ["<brian-briefing>", "Brian (company brain) matched this prompt:"];
  if (skill) parts.push(`SKILL (follow its procedure; hard_rules and guardrails are non-negotiable):\n${JSON.stringify(skill)}`);
  if (context) parts.push(`CONTEXT (company goals/decisions/preferences that override defaults):\n${JSON.stringify(context)}`);
  parts.push("After finishing or escalating, call log_execution. If the skill does not fit, call find_skill yourself before improvising.", "</brian-briefing>");
  emit("UserPromptSubmit", parts.join("\n"));
}

main().catch(() => {}).finally(() => process.exit(0));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/brianHook.test.ts` — Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add server/scripts/hooks/brian-hook.mjs server/src/hooks/brianHook.test.ts
git commit -m "feat(hooks): Claude Code hook — contract on SessionStart, briefing on every prompt"
```

---

### Task 4: Installer + project settings + npm script

**Files:**
- Create: `server/scripts/hooks/install.mjs`
- Create: `server/src/hooks/install.test.ts`
- Create: `.claude/settings.json` (repo root)
- Modify: `server/package.json` (scripts)

**Interfaces:**
- Consumes: `server/scripts/hooks/brian-hook.mjs` path (Task 3).
- Produces: `node server/scripts/hooks/install.mjs [--user] [--settings <path>]` — merges `SessionStart` + `UserPromptSubmit` command hooks (command: `node <absolute path to brian-hook.mjs>`, timeout 10) into the settings file (`--settings` explicit path wins; `--user` → `~/.claude/settings.json`; default → `<repo>/.claude/settings.json`). Idempotent; preserves unrelated keys/hooks; exits 1 without writing if existing file is unparseable. Prints the settings path it wrote.

- [ ] **Step 1: Write the failing test**

`server/src/hooks/install.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/hooks/install.mjs"
);
const hookScript = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/hooks/brian-hook.mjs"
);

function run(args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [script, ...args], (err, stdout, stderr) =>
      resolve({ code: (err?.code as number | undefined) ?? 0, stdout, stderr }));
  });
}

describe("hooks installer", () => {
  it("creates settings with both hooks, idempotently, preserving other keys", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brian-install-"));
    const settings = path.join(dir, "settings.json");
    await writeFile(settings, JSON.stringify({ model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hi" }] }] } }));

    const first = await run(["--settings", settings]);
    expect(first.code).toBe(0);
    const after = JSON.parse(await readFile(settings, "utf8"));
    expect(after.model).toBe("opus");
    expect(after.hooks.Stop).toHaveLength(1);
    for (const evt of ["SessionStart", "UserPromptSubmit"]) {
      const cmds = after.hooks[evt].flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command));
      expect(cmds).toContain(`node "${hookScript}"`);
    }

    const second = await run(["--settings", settings]);
    expect(second.code).toBe(0);
    expect(JSON.parse(await readFile(settings, "utf8"))).toEqual(after);
  });

  it("creates the file (and parent dir) when missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brian-install-"));
    const settings = path.join(dir, ".claude", "settings.json");
    const res = await run(["--settings", settings]);
    expect(res.code).toBe(0);
    const after = JSON.parse(await readFile(settings, "utf8"));
    expect(after.hooks.SessionStart).toHaveLength(1);
    expect(after.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it("refuses to touch an unparseable settings file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "brian-install-"));
    const settings = path.join(dir, "settings.json");
    await writeFile(settings, "{not json");
    const res = await run(["--settings", settings]);
    expect(res.code).toBe(1);
    expect(await readFile(settings, "utf8")).toBe("{not json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/install.test.ts` — Expected: FAIL (script missing).

- [ ] **Step 3: Implement `server/scripts/hooks/install.mjs`**

```js
#!/usr/bin/env node
// Installs Brian's Claude Code hooks into a .claude/settings.json.
// Usage: node install.mjs [--user] [--settings <path>]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hookScript = path.join(here, "brian-hook.mjs");
const command = `node "${hookScript}"`;

const args = process.argv.slice(2);
const explicit = args.includes("--settings") ? args[args.indexOf("--settings") + 1] : null;
const settingsPath = explicit
  ? path.resolve(explicit)
  : args.includes("--user")
    ? path.join(homedir(), ".claude", "settings.json")
    : path.resolve(here, "../../..", ".claude", "settings.json");

let settings = {};
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    console.error(`Refusing to modify unparseable JSON at ${settingsPath}`);
    process.exit(1);
  }
}

settings.hooks ??= {};
for (const event of ["SessionStart", "UserPromptSubmit"]) {
  const groups = (settings.hooks[event] ??= []);
  const installed = groups.some((g) => (g.hooks ?? []).some((h) => h.command === command));
  if (!installed) groups.push({ hooks: [{ type: "command", command, timeout: 10 }] });
}

mkdirSync(path.dirname(settingsPath), { recursive: true });
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log(`Brian hooks installed in ${settingsPath}`);
```

Add to `server/package.json` scripts: `"hooks:install": "node scripts/hooks/install.mjs"`.

Create repo-root `.claude/settings.json` (project-level wiring, uses `$CLAUDE_PROJECT_DIR` so it works for any checkout):

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/server/scripts/hooks/brian-hook.mjs\"", "timeout": 10 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/server/scripts/hooks/brian-hook.mjs\"", "timeout": 10 }] }
    ]
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/install.test.ts` — Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add server/scripts/hooks/install.mjs server/src/hooks/install.test.ts server/package.json .claude/settings.json
git commit -m "feat(hooks): installer + project-level Claude Code hook wiring"
```

---

### Task 5: Docs, full verification, merge

**Files:**
- Modify: `docs/agent-contract.md` (add "Guaranteed invocation" section)
- Modify: `Nextstep.md`

**Interfaces:** none new.

- [ ] **Step 1: Docs**

Append to `docs/agent-contract.md`:

```markdown
---

## Guaranteed invocation

The contract above relies on the model choosing to call Brian. Two layers make
that automatic:

1. **All MCP clients** — Brian's MCP server now sends this contract as MCP
   `instructions` at initialize, so any connected client (Claude Code, Claude
   Desktop, Cursor…) gets it in the system prompt without pasting anything.
2. **Claude Code (deterministic)** — hooks push Brian into every conversation:
   `SessionStart` injects the contract; `UserPromptSubmit` sends each prompt to
   `POST /api/agent/briefing` and injects the matched skill + context before
   the model acts. The hook is fail-silent: if the Brian API isn't running,
   sessions behave exactly as before.

Install into any project (or user-wide) with:

    cd server
    npm run hooks:install              # this repo (.claude/settings.json)
    npm run hooks:install -- --user    # everywhere: ~/.claude/settings.json
    npm run hooks:install -- --settings /path/to/project/.claude/settings.json

Requirements: the Brian API running locally (`cd server && npm run api`), and
`BRIAN_API_TOKEN` in `server/.env` (the hook reads it from there). To uninstall,
remove the two `brian-hook.mjs` entries from the settings file.
```

Update `Nextstep.md`: mark always-on invocation shipped; note the founder-visible bits (hooks installed user-wide if done in Step 3; Brian API must be running for briefings).

- [ ] **Step 2: Full suite + live verification**

```bash
cd server && set -a && . ./.env && set +a && npm test
```
Expected: all suites pass (previous 103 + new ~10).

Live check (real server, real embeddings):
```bash
cd server && set -a && . ./.env && set +a && npm run api &   # wait for "API listening"
echo '{"hook_event_name":"UserPromptSubmit","prompt":"a customer is asking for a discount"}' \
  | node scripts/hooks/brian-hook.mjs
```
Expected: JSON with `additionalContext` containing the discount-approval skill. Then kill the API and re-run — expected: silence, exit 0.

- [ ] **Step 3: (Founder goal) install user-wide**

```bash
cd server && npm run hooks:install -- --user
```
Expected: `Brian hooks installed in /Users/sameh/.claude/settings.json`.

- [ ] **Step 4: Commit docs, merge**

```bash
git add docs/agent-contract.md Nextstep.md docs/superpowers/plans/2026-07-04-always-on-invocation.md
git commit -m "docs: guaranteed-invocation guide + plan"
git checkout main && git merge --no-ff always-on-invocation -m "Merge always-on-invocation: Brian consulted on every task"
```
