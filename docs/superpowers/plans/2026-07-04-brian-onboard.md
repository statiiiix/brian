# Brian Onboard (`npm run onboard`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or
> superpowers:subagent-driven-development to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command (`cd server && npm run onboard`) detects every supported AI-agent
platform on the machine, shows exactly what it will change, and wires each one to Brian
(MCP registration + the strongest always-on layer that platform supports), safely and
idempotently.

**Architecture:** A single `onboard.mjs` entry drives a registry of per-platform adapter
modules behind a common `{detect, status, plan, apply}` interface. Shared config-editing
primitives (JSON deep-merge with timestamped backup + refuse-on-unparseable, text
marker-blocks, TOML section append, MCP-entry builders) live in `lib.mjs`. Adapters take an
`env` object (carrying `home`, `platform`, path overrides) so every test runs against a temp
HOME. The Claude Code always-on layer **delegates to** the existing `scripts/hooks/install.mjs`
(refactored to export a function) rather than duplicating hook logic.

**Tech Stack:** Zero-dependency Node ESM (`.mjs`, bare-`node` runnable, no build), same
conventions as `server/scripts/hooks/`. Tests are vitest `.test.ts` files under
`server/src/onboard/` that either import `lib.mjs`/adapters directly (pure functions) or
subprocess `onboard.mjs` via `execFile(process.execPath, ...)` against `mkdtemp` HOMEs — the
exact pattern already used by `src/hooks/install.test.ts`.

## Global Constraints

- Zero runtime dependencies; ESM `.mjs`; runnable by bare `node` (no tsx/build) — matches
  `server/scripts/hooks/` (founder directive: agent-facing scripts are zero-dep ESM).
- **Never destructive:** before the first modification of any existing file, copy it to
  `<file>.bak-brian-<YYYYMMDD-HHmmss>` beside it. Existing keys / unrelated config preserved.
- **Refuse, don't guess:** unparseable JSON/TOML → skip that platform with a clear message and
  set the nonzero-exit summary flag; never rewrite what can't be parsed.
- **Idempotent:** a second run reports "already wired" and writes zero diffs (tested).
- **Confirm by default:** print the full plan (files + actions) before any write; `--yes`
  skips the prompt, `--dry-run` never writes.
- **Honest layer labels** in all output: hooks = *guaranteed per-prompt briefing*;
  bootstrap/rules files (AGENTS.md) = *contract always in context, tools still model-pulled*;
  instructions-only = *contract delivered at connect*.
- Local default MCP entry (stdio): `{ command: "npm", args: ["--prefix", <ABS server dir>,
  "run", "mcp"] }`. Remote (`--url/--token`) MCP entry (HTTP): `{ type: "http", url:
  "<url>/mcp", headers: { Authorization: "Bearer <token>" } }`.
- Tenant-neutral client-machine output: pointers + generic contract only, never company data.
- Tests mock nothing DB-related here (no DB touched); they use temp HOMEs only.

## File Structure

- `server/scripts/hooks/install.mjs` — **modify**: extract `installBrianHooks({ settingsPath })`
  export; keep the CLI behaviour when run directly (`npm run hooks:install`). Existing
  `src/hooks/install.test.ts` must stay green.
- `server/scripts/onboard/lib.mjs` — **create**: shared helpers (JSON, backup, marker-block,
  TOML, MCP-entry builders, CONTRACT text, small format helpers).
- `server/scripts/onboard/adapters/claudeCode.mjs` — **create**.
- `server/scripts/onboard/adapters/claudeDesktop.mjs` — **create**.
- `server/scripts/onboard/adapters/cursor.mjs` — **create**.
- `server/scripts/onboard/adapters/codex.mjs` — **create**.
- `server/scripts/onboard/adapters/openclaw.mjs` — **create**.
- `server/scripts/onboard/onboard.mjs` — **create**: entry point (flags, registry,
  detect→plan→confirm→apply, `--status`, exit codes, rendering).
- `server/src/onboard/lib.test.ts` — **create**: unit tests for lib helpers.
- `server/src/onboard/adapters.test.ts` — **create**: per-adapter detect/status/plan/apply
  against temp-HOME fixtures.
- `server/src/onboard/cli.test.ts` — **create**: subprocess tests for onboard.mjs flags/exit codes.
- `server/package.json` — **modify**: add `"onboard": "node scripts/onboard/onboard.mjs"`.
- `docs/onboard.md` — **create**: user-facing usage + what each layer means.
- `Nextstep.md` — **modify**: move step 2 to "done", update conventions if needed.

### Shared interfaces (locked here so tasks agree on names/types)

`lib.mjs` exports:
- `readJsonFile(path) -> { ok: true, value } | { ok: false, reason: "missing"|"unparseable" }`
- `deepMerge(base, patch) -> merged` (objects merged recursively; arrays/scalars from patch win)
- `backupFile(path) -> backupPath|null` (null if file absent; timestamped `.bak-brian-<ts>`)
- `writeJsonFile(path, value, { backup=true })` (mkdir -p, backup-once, 2-space JSON + trailing \n)
- `readText(path) -> string|null`
- `upsertMarkerBlock(text, body) -> { text: newText, changed: boolean }` (block delimited by
  `# >>> brian >>>` / `# <<< brian <<<`; replaces existing block, else appends)
- `hasMarkerBlock(text) -> boolean`
- `tomlHasSection(text, section) -> boolean` (line-scan for `[section]`)
- `appendTomlSection(text, sectionText) -> string` (append with blank-line separation)
- `mcpEntry(opts) -> object` where `opts = { serverPath, url, token }`; returns stdio entry
  when no `url`, HTTP entry when `url` set.
- `CONTRACT: string` — the canonical agent contract (kept in sync with
  `scripts/hooks/brian-hook.mjs`, `src/mcp/instructions.ts`, `docs/agent-contract.md`).
- `stamp() -> string` — `YYYYMMDD-HHmmss` (exported for tests to assert backup naming shape).

Adapter module shape (every file in `adapters/`):
```js
export const name = "claude-code";
export const label = "Claude Code";
export function detect(env)  // -> { detected: boolean, evidence: string }
export function status(env)  // -> { mcp: "wired"|"missing"|"unsupported", alwaysOn: "wired"|"missing"|"unsupported" }
export function plan(env, opts)        // -> [{ file, action, layer, description }]
export async function apply(env, opts) // -> { applied: [{ file, action }], skipped: [{ file, reason }] }
```

`env` shape: `{ home, platform, serverPath }` (+ optional per-adapter path override keys used
only by tests, e.g. `claudeDesktopDir`). `opts` shape: `{ serverPath, url, token, dryRun }`.

---

### Task 1: Refactor `install.mjs` to export `installBrianHooks`

**Files:**
- Modify: `server/scripts/hooks/install.mjs`
- Test: `server/src/hooks/install.test.ts` (existing — must stay green; add one import test)

**Interfaces:**
- Produces: `installBrianHooks({ settingsPath }) -> { changed: boolean }` and
  `hookCommand -> string` (the `node "<abs brian-hook.mjs>"` command), both importable.
  Throws `Error("unparseable")` instead of `process.exit(1)` when called as a function; the
  CLI wrapper catches it and exits 1 (preserving current behaviour).

- [ ] **Step 1: Write the failing test** — append to `src/hooks/install.test.ts`:

```ts
import { installBrianHooks, hookCommand } from "../../scripts/hooks/install.mjs";

it("exposes installBrianHooks() that writes idempotently", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "brian-installfn-"));
  const settings = path.join(dir, "settings.json");
  const first = installBrianHooks({ settingsPath: settings });
  expect(first.changed).toBe(true);
  const after = JSON.parse(await readFile(settings, "utf8"));
  expect(after.hooks.SessionStart[0].hooks[0].command).toBe(hookCommand);
  const second = installBrianHooks({ settingsPath: settings });
  expect(second.changed).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails** — `... npm test -- src/hooks/install.test.ts`
  Expected: FAIL (`installBrianHooks is not a function`).

- [ ] **Step 3: Refactor `install.mjs`** — move the body into an exported function; guard the
  CLI. Keep the absolute-path `command`. Sketch:

```js
export const hookScript = path.join(here, "brian-hook.mjs");
export const hookCommand = `node "${hookScript}"`;

export function installBrianHooks({ settingsPath }) {
  let settings = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); }
    catch { throw new Error("unparseable"); }
  }
  settings.hooks ??= {};
  let changed = false;
  for (const event of ["SessionStart", "UserPromptSubmit"]) {
    const groups = (settings.hooks[event] ??= []);
    const installed = groups.some((g) => (g.hooks ?? []).some((h) => h.command === hookCommand));
    if (!installed) { groups.push({ hooks: [{ type: "command", command: hookCommand, timeout: 10 }] }); changed = true; }
  }
  if (changed || !existsSync(settingsPath)) {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  }
  return { changed };
}

// CLI wrapper — only when run directly:
if (fileURLToPath(import.meta.url) === (process.argv[1] && path.resolve(process.argv[1]))) {
  const settingsPath = /* existing --settings/--user/default resolution */;
  try { installBrianHooks({ settingsPath }); console.log(`Brian hooks installed in ${settingsPath}`); }
  catch { console.error(`Refusing to modify unparseable JSON at ${settingsPath}`); process.exit(1); }
}
```

- [ ] **Step 4: Run the whole hooks suite** — `... npm test -- src/hooks/`
  Expected: PASS (both new import test and the 3 existing CLI tests, incl. unparseable → exit 1).

- [ ] **Step 5: Commit** — `git commit -m "refactor(hooks): export installBrianHooks() for reuse by onboarder"`

---

### Task 2: `lib.mjs` — JSON read / deep-merge / backup / write

**Files:**
- Create: `server/scripts/onboard/lib.mjs`
- Test: `server/src/onboard/lib.test.ts`

**Interfaces:** Produces `readJsonFile`, `deepMerge`, `backupFile`, `writeJsonFile`, `stamp`
(signatures under "Shared interfaces").

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readJsonFile, deepMerge, backupFile, writeJsonFile } from "../../scripts/onboard/lib.mjs";

it("deepMerge preserves siblings and merges nested objects", () => {
  const out = deepMerge({ a: 1, mcpServers: { x: 1 } }, { mcpServers: { brian: { c: "npm" } } });
  expect(out).toEqual({ a: 1, mcpServers: { x: 1, brian: { c: "npm" } } });
});

it("readJsonFile reports missing vs unparseable", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "brian-lib-"));
  expect(readJsonFile(path.join(dir, "no.json"))).toEqual({ ok: false, reason: "missing" });
  const bad = path.join(dir, "bad.json"); await writeFile(bad, "{nope");
  expect(readJsonFile(bad)).toEqual({ ok: false, reason: "unparseable" });
});

it("writeJsonFile backs up an existing file once, then merges", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "brian-lib-"));
  const f = path.join(dir, "c.json"); await writeFile(f, JSON.stringify({ keep: 1 }));
  writeJsonFile(f, deepMerge({ keep: 1 }, { brian: true }));
  const names = await readdir(dir);
  expect(names.some((n) => n.startsWith("c.json.bak-brian-"))).toBe(true);
  expect(JSON.parse(await readFile(f, "utf8"))).toEqual({ keep: 1, brian: true });
});
```

- [ ] **Step 2: Run — verify fail** (`Cannot find module lib.mjs`).
- [ ] **Step 3: Implement** the four helpers + `stamp()` in `lib.mjs` (fs sync API; backup uses
  `copyFileSync`; `stamp()` → `new Date()` → `YYYYMMDD-HHmmss`).
- [ ] **Step 4: Run — verify pass** (`... npm test -- src/onboard/lib.test.ts`).
- [ ] **Step 5: Commit** — `feat(onboard): lib.mjs JSON merge/backup primitives`.

---

### Task 3: `lib.mjs` — marker blocks + TOML section append

**Files:** Modify `server/scripts/onboard/lib.mjs`; extend `src/onboard/lib.test.ts`.

**Interfaces:** Produces `upsertMarkerBlock`, `hasMarkerBlock`, `readText`, `tomlHasSection`,
`appendTomlSection`.

- [ ] **Step 1: Failing tests**

```ts
import { upsertMarkerBlock, hasMarkerBlock, tomlHasSection, appendTomlSection } from "../../scripts/onboard/lib.mjs";

it("upsertMarkerBlock appends once and replaces in place", () => {
  const a = upsertMarkerBlock("# rules\n", "CONTRACT v1");
  expect(a.changed).toBe(true);
  expect(hasMarkerBlock(a.text)).toBe(true);
  expect(a.text.startsWith("# rules")).toBe(true);
  const b = upsertMarkerBlock(a.text, "CONTRACT v1");   // identical
  expect(b.changed).toBe(false);
  const c = upsertMarkerBlock(a.text, "CONTRACT v2");   // updated body
  expect(c.changed).toBe(true);
  expect(c.text).toContain("CONTRACT v2");
  expect(c.text.match(/>>> brian >>>/g)).toHaveLength(1); // still exactly one block
});

it("toml section detect + append is line-scan based", () => {
  const base = "[mcp_servers.other]\ncommand = \"x\"\n";
  expect(tomlHasSection(base, "mcp_servers.brian")).toBe(false);
  const out = appendTomlSection(base, "[mcp_servers.brian]\ncommand = \"npm\"\n");
  expect(tomlHasSection(out, "mcp_servers.brian")).toBe(true);
  expect(out).toContain("[mcp_servers.other]"); // preserved
});
```

- [ ] **Step 2: Run — verify fail.**
- [ ] **Step 3: Implement.** Marker delimiters `# >>> brian >>>` / `# <<< brian <<<`;
  `upsertMarkerBlock` uses a regex to find/replace the block, else appends
  `\n<open>\n<body>\n<close>\n`; `changed=false` only when an identical block already exists.
  `tomlHasSection` scans lines for `[<section>]` (trimmed). `appendTomlSection` ensures a
  trailing blank line then appends.
- [ ] **Step 4: Run — verify pass.**
- [ ] **Step 5: Commit** — `feat(onboard): marker-block + TOML section helpers`.

---

### Task 4: `lib.mjs` — MCP-entry builders + CONTRACT

**Files:** Modify `server/scripts/onboard/lib.mjs`; extend `src/onboard/lib.test.ts`.

**Interfaces:** Produces `mcpEntry(opts)` and `CONTRACT`.

- [ ] **Step 1: Failing tests**

```ts
import { mcpEntry, CONTRACT } from "../../scripts/onboard/lib.mjs";

it("mcpEntry builds stdio locally and http when url given", () => {
  expect(mcpEntry({ serverPath: "/abs/server" }))
    .toEqual({ command: "npm", args: ["--prefix", "/abs/server", "run", "mcp"] });
  expect(mcpEntry({ url: "https://b.example.com", token: "T" }))
    .toEqual({ type: "http", url: "https://b.example.com/mcp", headers: { Authorization: "Bearer T" } });
});

it("CONTRACT names the required Brian tools", () => {
  for (const t of ["find_skill", "find_context", "log_execution", "capture"]) {
    expect(CONTRACT).toContain(t);
  }
});
```

- [ ] **Step 2: Run — verify fail.**
- [ ] **Step 3: Implement.** `mcpEntry` strips a trailing slash from `url` before `+ "/mcp"`.
  `CONTRACT` copied verbatim from `brian-hook.mjs` with a `// keep in sync` comment.
- [ ] **Step 4: Run — verify pass.**
- [ ] **Step 5: Commit** — `feat(onboard): MCP-entry builders + canonical contract text`.

---

### Task 5: Claude Code adapter

**Files:**
- Create: `server/scripts/onboard/adapters/claudeCode.mjs`
- Test: `server/src/onboard/adapters.test.ts` (create; Claude Code cases first)

**Interfaces:** Consumes `lib.mjs` + `installBrianHooks`/`hookCommand` from `install.mjs`.
Detect: `<home>/.claude/` exists. MCP: merge `mcpServers.brian = mcpEntry(opts)` into
`<home>/.claude.json` (backup+refuse; if `brian` key already present with any value → wired,
no diff). Always-on: `installBrianHooks({ settingsPath: <home>/.claude/settings.json })`.

- [ ] **Step 1: Failing tests** (temp HOME with `.claude/` dir):

```ts
import * as claudeCode from "../../scripts/onboard/adapters/claudeCode.mjs";
const env = (home: string) => ({ home, platform: "darwin", serverPath: "/abs/server" });

it("claude-code detects ~/.claude and plans mcp + hooks", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cc-")); await mkdir(path.join(home, ".claude"));
  expect(claudeCode.detect(env(home)).detected).toBe(true);
  const plan = claudeCode.plan(env(home), { serverPath: "/abs/server" });
  expect(plan.map((p) => p.file)).toEqual(expect.arrayContaining([
    path.join(home, ".claude.json"), path.join(home, ".claude", "settings.json"),
  ]));
});

it("claude-code apply writes mcp entry + hooks, idempotently", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cc-")); await mkdir(path.join(home, ".claude"));
  await claudeCode.apply(env(home), { serverPath: "/abs/server" });
  const cj = JSON.parse(await readFile(path.join(home, ".claude.json"), "utf8"));
  expect(cj.mcpServers.brian).toEqual({ command: "npm", args: ["--prefix", "/abs/server", "run", "mcp"] });
  const st = JSON.parse(await readFile(path.join(home, ".claude", "settings.json"), "utf8"));
  expect(st.hooks.SessionStart).toBeTruthy();
  expect(claudeCode.status(env(home))).toEqual({ mcp: "wired", alwaysOn: "wired" });
});

it("claude-code refuses unparseable ~/.claude.json", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cc-")); await mkdir(path.join(home, ".claude"));
  await writeFile(path.join(home, ".claude.json"), "{broken");
  const res = await claudeCode.apply(env(home), { serverPath: "/abs/server" });
  expect(res.skipped.some((s) => s.reason === "unparseable")).toBe(true);
  expect(await readFile(path.join(home, ".claude.json"), "utf8")).toBe("{broken"); // untouched
});
```

- [ ] **Step 2: Run — verify fail.**
- [ ] **Step 3: Implement** the adapter. `paths(env)` computes `.claude.json` + settings path
  from `env.home` (override keys allowed). MCP write via `readJsonFile`→refuse/merge→
  `writeJsonFile`. Hooks via imported `installBrianHooks`. `status` derives mcp from presence
  of `mcpServers.brian`, alwaysOn from a hook whose command === `hookCommand`.
- [ ] **Step 4: Run — verify pass.**
- [ ] **Step 5: Commit** — `feat(onboard): claude-code adapter (mcp + delegated hooks)`.

---

### Task 6: Claude Desktop adapter

**Files:** Create `server/scripts/onboard/adapters/claudeDesktop.mjs`; extend `adapters.test.ts`.

**Interfaces:** Detect: `<home>/Library/Application Support/Claude/` (macOS path table keyed on
`env.platform`). MCP: merge `mcpServers.brian` into the config file that exists there —
prefer `claude_desktop_config.json`, else `mcp.json`, else create `claude_desktop_config.json`;
if `brian` already present → wired. Always-on: `unsupported` (label: "MCP instructions
delivered at connect"). No hook surface.

- [ ] **Step 1: Failing tests**

```ts
import * as desktop from "../../scripts/onboard/adapters/claudeDesktop.mjs";
const cdir = (home: string) => path.join(home, "Library", "Application Support", "Claude");

it("claude-desktop merges brian into existing claude_desktop_config.json, preserving keys", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cd-")); await mkdir(cdir(home), { recursive: true });
  await writeFile(path.join(cdir(home), "claude_desktop_config.json"),
    JSON.stringify({ mcpServers: { other: { command: "x" } }, preferences: { a: 1 } }));
  await desktop.apply(env(home), { serverPath: "/abs/server" });
  const c = JSON.parse(await readFile(path.join(cdir(home), "claude_desktop_config.json"), "utf8"));
  expect(c.mcpServers.other).toBeTruthy();      // preserved
  expect(c.preferences).toEqual({ a: 1 });       // preserved
  expect(c.mcpServers.brian).toBeTruthy();
  expect(desktop.status(env(home))).toEqual({ mcp: "wired", alwaysOn: "unsupported" });
});

it("claude-desktop is not detected without the Claude support dir", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cd-"));
  expect(desktop.detect(env(home)).detected).toBe(false);
});
```

- [ ] **Step 2–4:** run-fail → implement → run-pass.
- [ ] **Step 5: Commit** — `feat(onboard): claude-desktop adapter (config-file mcp merge)`.

---

### Task 7: Cursor adapter

**Files:** Create `server/scripts/onboard/adapters/cursor.mjs`; extend `adapters.test.ts`.

**Interfaces:** Detect: `<home>/.cursor/`. MCP: merge `mcpServers.brian` into
`<home>/.cursor/mcp.json` (create if missing, tolerate `{"mcpServers":{}}`). Always-on:
marker block with `CONTRACT` appended to `<home>/.cursor/AGENTS.md` (create if missing).

- [ ] **Step 1: Failing tests**

```ts
import * as cursor from "../../scripts/onboard/adapters/cursor.mjs";

it("cursor wires empty mcp.json and creates AGENTS.md with contract block", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cur-")); await mkdir(path.join(home, ".cursor"));
  await writeFile(path.join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: {} }));
  await cursor.apply(env(home), { serverPath: "/abs/server" });
  const m = JSON.parse(await readFile(path.join(home, ".cursor", "mcp.json"), "utf8"));
  expect(m.mcpServers.brian).toBeTruthy();
  const agents = await readFile(path.join(home, ".cursor", "AGENTS.md"), "utf8");
  expect(agents).toContain(">>> brian >>>");
  expect(agents).toContain("find_skill");
  expect(cursor.status(env(home))).toEqual({ mcp: "wired", alwaysOn: "wired" });
});

it("cursor preserves existing AGENTS.md content above the block", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cur-")); await mkdir(path.join(home, ".cursor"));
  await writeFile(path.join(home, ".cursor", "AGENTS.md"), "# My rules\nBe nice.\n");
  await cursor.apply(env(home), { serverPath: "/abs/server" });
  const agents = await readFile(path.join(home, ".cursor", "AGENTS.md"), "utf8");
  expect(agents.startsWith("# My rules")).toBe(true);
  expect(agents).toContain(">>> brian >>>");
});
```

- [ ] **Step 2–4:** run-fail → implement → run-pass.
- [ ] **Step 5: Commit** — `feat(onboard): cursor adapter (mcp.json + AGENTS.md contract)`.

---

### Task 8: Codex CLI adapter (Tier B)

**Files:** Create `server/scripts/onboard/adapters/codex.mjs`; extend `adapters.test.ts`.

**Docs check (record at build):** Codex CLI reads `~/.codex/config.toml`; MCP servers are TOML
tables `[mcp_servers.<name>]` with `command`, `args` (array), optional `env` table. Codex also
loads `~/.codex/AGENTS.md` (global) each session. Confirm both against current OpenAI Codex
docs at build time; note findings in the commit body.

**Interfaces:** Detect: `<home>/.codex/`. MCP: if `config.toml` has `[mcp_servers.brian]` →
wired; else append the section (line-scan, no TOML parser; backup first). Always-on: marker
block with `CONTRACT` in `<home>/.codex/AGENTS.md`.

- [ ] **Step 1: Failing tests**

```ts
import * as codex from "../../scripts/onboard/adapters/codex.mjs";

it("codex appends [mcp_servers.brian] and writes AGENTS.md, idempotently", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "cx-")); await mkdir(path.join(home, ".codex"));
  await writeFile(path.join(home, ".codex", "config.toml"), "model = \"gpt-5\"\n");
  await codex.apply(env(home), { serverPath: "/abs/server" });
  const toml = await readFile(path.join(home, ".codex", "config.toml"), "utf8");
  expect(toml).toContain("[mcp_servers.brian]");
  expect(toml).toContain("model = \"gpt-5\""); // preserved
  const before = toml;
  await codex.apply(env(home), { serverPath: "/abs/server" }); // idempotent
  expect(await readFile(path.join(home, ".codex", "config.toml"), "utf8")).toBe(before);
  expect(codex.status(env(home))).toEqual({ mcp: "wired", alwaysOn: "wired" });
});
```

- [ ] **Step 2–4:** run-fail → implement → run-pass. TOML section built from `opts`
  (stdio: `command`/`args`; if `opts.url`, emit `url =`/`bearer_token_env_var` per docs, else
  a commented manual note).
- [ ] **Step 5: Commit** — `feat(onboard): codex adapter (config.toml section + AGENTS.md)`.

---

### Task 9: OpenClaw/Clawdbot adapter (Tier B, conservative)

**Files:** Create `server/scripts/onboard/adapters/openclaw.mjs`; extend `adapters.test.ts`.

**Docs check (record at build):** OpenClaw/Clawdbot config format is not verifiable on this
machine and not stably documented. Conservative implementation: detect `<home>/.openclaw/` or
`<home>/.clawdbot/`; write the `CONTRACT` marker block into `<dir>/AGENTS.md` (best-effort
always-on) and report MCP registration as **manual** with printed instructions (never guess a
config format). Label MCP `unsupported` in status until docs confirm a config path.

- [ ] **Step 1: Failing tests**

```ts
import * as openclaw from "../../scripts/onboard/adapters/openclaw.mjs";

it("openclaw writes contract to AGENTS.md and reports mcp as manual", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "oc-")); await mkdir(path.join(home, ".openclaw"));
  const res = await openclaw.apply(env(home), { serverPath: "/abs/server" });
  const agents = await readFile(path.join(home, ".openclaw", "AGENTS.md"), "utf8");
  expect(agents).toContain(">>> brian >>>");
  expect(res.skipped.some((s) => /manual/i.test(s.reason))).toBe(true);
  expect(openclaw.status(env(home))).toEqual({ mcp: "unsupported", alwaysOn: "wired" });
});

it("openclaw is not detected when neither dir exists", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "oc-"));
  expect(openclaw.detect(env(home)).detected).toBe(false);
});
```

- [ ] **Step 2–4:** run-fail → implement → run-pass.
- [ ] **Step 5: Commit** — `feat(onboard): openclaw adapter (contract file + manual mcp note)`.

---

### Task 10: `onboard.mjs` entry — registry, flags, plan/confirm/apply, `--status`

**Files:**
- Create: `server/scripts/onboard/onboard.mjs`
- Test: `server/src/onboard/cli.test.ts`

**Interfaces:** Consumes all adapters (imported into a `REGISTRY` array). Flags: `--yes`,
`--dry-run`, `--status`, `--only a,b`, `--url <u>`, `--token <t>`. `env.home =
process.env.HOME || homedir()`; `env.serverPath` = abs path to `server/` derived from
`import.meta.url` (`../../..`? no — `scripts/onboard/` → server root is `../..`). Exit codes:
0 = all detected platforms wired (or dry-run/status clean), 1 = any skip/refusal.

- [ ] **Step 1: Failing subprocess tests**

```ts
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/onboard/onboard.mjs");
function run(args: string[], home: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(process.execPath, [script, ...args], { env: { ...process.env, HOME: home } },
      (err, stdout, stderr) => {
        if (err && err.code === undefined) return reject(err);
        resolve({ code: (err?.code as number) ?? 0, stdout, stderr });
      });
  });
}

it("--dry-run detects platforms but writes nothing", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ob-")); await mkdir(path.join(home, ".cursor"));
  await writeFile(path.join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: {} }));
  const { code, stdout } = await run(["--dry-run"], home);
  expect(stdout.toLowerCase()).toContain("cursor");
  const m = JSON.parse(await readFile(path.join(home, ".cursor", "mcp.json"), "utf8"));
  expect(m.mcpServers.brian).toBeUndefined(); // nothing written
  expect(code).toBe(0);
});

it("--yes applies, second --status reports wired", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ob-")); await mkdir(path.join(home, ".cursor"));
  await writeFile(path.join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: {} }));
  const applied = await run(["--yes", "--only", "cursor"], home);
  expect(applied.code).toBe(0);
  const status = await run(["--status", "--only", "cursor"], home);
  expect(status.stdout).toMatch(/cursor.*wired/i);
});

it("exits 1 when a detected platform has broken config", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "ob-")); await mkdir(path.join(home, ".cursor"));
  await writeFile(path.join(home, ".cursor", "mcp.json"), "{broken");
  const { code, stdout } = await run(["--yes", "--only", "cursor"], home);
  expect(code).toBe(1);
  expect(stdout.toLowerCase()).toContain("skip");
});
```

- [ ] **Step 2: Run — verify fail.**
- [ ] **Step 3: Implement** `onboard.mjs`: parse flags; build `env`/`opts`; filter registry by
  `--only`; `--status` → print table and exit; else print plan; if not `--yes` and stdin is a
  TTY, prompt `Proceed? [y/N]` (in `--yes`/non-TTY, proceed only with `--yes`); `--dry-run`
  returns before any `apply`; run `apply`, collect applied/skipped; print per-platform next
  steps + honest layer labels; exit 1 if any skip. Reads `--url/--token`; if `--url` set but no
  token → skip with instructions.
- [ ] **Step 4: Run — verify pass.**
- [ ] **Step 5: Commit** — `feat(onboard): onboard.mjs entry (detect/plan/confirm/apply, --status)`.

---

### Task 11: Wire script, docs, live verify, update Nextstep, merge

**Files:** Modify `server/package.json`; create `docs/onboard.md`; modify `Nextstep.md`.

- [ ] **Step 1:** add `"onboard": "node scripts/onboard/onboard.mjs"` to `server/package.json`.
- [ ] **Step 2:** write `docs/onboard.md` (CLI, flags, per-platform layer table, safety notes).
- [ ] **Step 3: Full suite** — `cd server && set -a && . ./.env && set +a && npm test`
  Expected: all prior tests + new onboard tests pass (was 114/114; must not regress).
- [ ] **Step 4: Live Tier A verification (read-first, then real apply):**
  `npm run onboard -- --status` (table reflects real machine: Claude Code hooks already wired,
  Desktop brian already present, Cursor missing), then `npm run onboard -- --dry-run`, inspect
  the plan, then a real `npm run onboard -- --yes`. Confirm: `~/.cursor/mcp.json` gains brian +
  `~/.cursor/AGENTS.md` gets the contract block; `~/.claude.json` gains `mcpServers.brian` (or
  reports already-wired); Desktop reports already-wired (no clobber); backups exist for any
  modified pre-existing file; a second run shows zero diffs / "already wired".
- [ ] **Step 5:** update `Nextstep.md` — move step 2 into the "done" list with a one-line
  summary + the `npm run onboard` entry point; adjust "Next steps" numbering.
- [ ] **Step 6: Merge** the feature branch to `main` with `--no-ff` (per house workflow).

## Self-Review (spec coverage)

- CLI flags `--yes/--dry-run/--status/--only/--url/--token` → Task 10. ✔
- Adapter interface `detect/status/plan/apply` + `env` overrides → Tasks 5–9 + interfaces block. ✔
- Tier A platforms (Claude Code delegating to hooks install; Desktop config-file; Cursor
  mcp.json+AGENTS.md) → Tasks 5–7, live-verified in Task 11. ✔
- Tier B (Codex config.toml + AGENTS.md; OpenClaw conservative) → Tasks 8–9, fixture tests. ✔
- Safety: backup-once, refuse-unparseable, idempotent, confirm-by-default, honest labels →
  Global Constraints + Tasks 2/5/8/10 tests. ✔
- lib helpers unit-tested incl. backup/refusal/idempotency → Tasks 2–4. ✔
- `npm run onboard` script + docs + Nextstep update → Task 11. ✔
- Deviation recorded: Claude Code MCP registration writes `~/.claude.json` directly (what
  `claude mcp add --scope user` does under the hood) instead of shelling out — hermetic,
  version-independent, and the spec's named fallback. `claude` CLI presence is still reported
  as detection evidence.
