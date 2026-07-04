#!/usr/bin/env node
// Installs Brian's Claude Code hooks (SessionStart + UserPromptSubmit) into a
// .claude/settings.json. Idempotent; preserves unrelated settings and hooks.
//
// Usage: node install.mjs [--user] [--settings <path>]
//   default    -> <repo>/.claude/settings.json (this checkout)
//   --user     -> ~/.claude/settings.json (every project on this machine)
//   --settings -> explicit path (e.g. another project's .claude/settings.json)
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
