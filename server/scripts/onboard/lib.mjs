// Shared, zero-dependency helpers for the Brian onboarder (scripts/onboard/).
// Same conventions as scripts/hooks/: ESM, bare-`node` runnable, no build step.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// YYYYMMDD-HHmmss timestamp used for backup filenames.
export function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Read + parse JSON. Distinguishes "missing" (fine — we may create it) from
// "unparseable" (must refuse; never rewrite what we can't understand).
export function readJsonFile(file) {
  if (!existsSync(file)) return { ok: false, reason: "missing" };
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    return { ok: false, reason: "unparseable" };
  }
}

// Recursive merge: plain objects merge key-by-key; arrays and scalars from the
// patch win. Returns a new object; never mutates base or patch.
export function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

// Copy file -> <file>.bak-brian-<ts> before its first modification. Returns the
// backup path, or null if the file doesn't exist yet (nothing to back up).
export function backupFile(file) {
  if (!existsSync(file)) return null;
  const backup = `${file}.bak-brian-${stamp()}`;
  copyFileSync(file, backup);
  return backup;
}

// Write pretty JSON (+ trailing newline), creating parent dirs. Backs up an
// existing file once first (unless backup:false). Callers must only invoke this
// when something actually changed, to keep re-runs zero-diff.
export function writeJsonFile(file, value, { backup = true } = {}) {
  if (backup) backupFile(file);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

// Read a text file, or null if it doesn't exist.
export function readText(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

// Write text (+ backup existing, + mkdir -p). Callers gate on `changed`.
export function writeTextFile(file, content, { backup = true } = {}) {
  if (backup) backupFile(file);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// --- Marker-block editing for text/markdown files (e.g. AGENTS.md) ----------
// A Brian-owned region delimited by these markers; everything outside is left
// untouched, so we never clobber a user's own rules.
const MARK_OPEN = "# >>> brian >>>";
const MARK_CLOSE = "# <<< brian <<<";
const BLOCK_RE = /# >>> brian >>>[\s\S]*?# <<< brian <<</;

export function hasMarkerBlock(text) {
  return BLOCK_RE.test(text ?? "");
}

// Insert or update the Brian marker block. Idempotent: an identical existing
// block yields { changed: false } and the original text byte-for-byte.
export function upsertMarkerBlock(text, body) {
  const source = text ?? "";
  const block = `${MARK_OPEN}\n${body}\n${MARK_CLOSE}`;
  const existing = source.match(BLOCK_RE);
  if (existing) {
    if (existing[0] === block) return { text: source, changed: false };
    return { text: source.replace(BLOCK_RE, block), changed: true };
  }
  if (source.trim() === "") return { text: block + "\n", changed: true };
  const sep = source.endsWith("\n") ? "\n" : "\n\n";
  return { text: source + sep + block + "\n", changed: true };
}

// Build the MCP server entry: stdio (local, default) or Streamable HTTP
// (remote, when a url is supplied). Shape matches the mcpServers JSON used by
// Claude Code / Claude Desktop / Cursor.
export function mcpEntry({ serverPath, url, token } = {}) {
  if (url) {
    return {
      type: "http",
      url: `${url.replace(/\/+$/, "")}/mcp`,
      headers: { Authorization: `Bearer ${token ?? ""}` },
    };
  }
  return { command: "npm", args: ["--prefix", serverPath, "run", "mcp"] };
}

// Canonical Brian agent contract. KEEP IN SYNC with scripts/hooks/brian-hook.mjs,
// src/mcp/instructions.ts, and docs/agent-contract.md.
export const CONTRACT = `You are connected to Brian, this company's brain. Follow this contract on every task:
1. BEFORE acting, call find_skill with the task and find_context for relevant goals/decisions/preferences — even if the user does not mention Brian. If no skill matches a business process, ask a human; do not improvise.
2. Follow the skill's procedure within its hard_rules (non-negotiable).
3. If a guardrail triggers, STOP and escalate to the skill's escalation_target.
4. Use only the tools the skill lists for business actions.
5. AFTER finishing or escalating, call log_execution.
6. Call capture when you learn something durable.`;

// --- TOML section helpers (line-scan; no TOML parser) -----------------------
// Detect `[section]` as a real (non-commented) table header.
export function tomlHasSection(text, section) {
  const target = `[${section}]`;
  return (text ?? "").split("\n").some((line) => line.trim() === target);
}

// Append a section, separated from prior content by exactly one blank line.
export function appendTomlSection(text, sectionText) {
  const source = text ?? "";
  const sep = source === "" ? "" : source.endsWith("\n\n") ? "" : source.endsWith("\n") ? "\n" : "\n\n";
  return source + sep + sectionText;
}

// --- Shared wiring helpers (used by several adapters) -----------------------

// Merge mcpServers.brian into a JSON config. Idempotent: an existing brian
// entry yields { status: "already" } with no write. Refuses unparseable files
// ({ status: "unparseable" }, untouched). Backs up an existing file on write.
export function mergeMcpServer(file, entry) {
  const read = readJsonFile(file);
  if (read.ok === false && read.reason === "unparseable") return { status: "unparseable" };
  const base = read.ok ? read.value : {};
  if (base && base.mcpServers && base.mcpServers.brian) return { status: "already" };
  writeJsonFile(file, deepMerge(base, { mcpServers: { brian: entry } }));
  return { status: "wired" };
}

// Upsert the Brian contract marker block into a text/markdown file (AGENTS.md).
// Idempotent: an identical block already present yields { status: "already" }.
export function wireMarkerFile(file, body) {
  const { text, changed } = upsertMarkerBlock(readText(file) ?? "", body);
  if (!changed) return { status: "already" };
  writeTextFile(file, text);
  return { status: "wired" };
}
