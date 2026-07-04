#!/usr/bin/env node
// Installs Brian's Claude Code hooks (SessionStart + UserPromptSubmit) into a
// .claude/settings.json. Idempotent; preserves unrelated settings and hooks.
//
// Importable API (reused by the onboarder, scripts/onboard/): call
//   installBrianHooks({ settingsPath }) -> { changed }
// It throws Error("unparseable") instead of exiting, so callers can decide.
//
// CLI (only when run directly): node install.mjs [--user] [--settings <path>]
//   default    -> <repo>/.claude/settings.json (this checkout)
//   --user     -> ~/.claude/settings.json (every project on this machine)
//   --settings -> explicit path (e.g. another project's .claude/settings.json)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const hookScript = path.join(here, "brian-hook.mjs");
export const hookCommand = `node "${hookScript}"`;

// Write the SessionStart + UserPromptSubmit hook entries into settingsPath.
// Idempotent (keyed on the exact command string); preserves unrelated config.
// Only rewrites the file when something actually changed (true zero-diff on
// re-run). Throws Error("unparseable") if the existing file isn't valid JSON.
export function installBrianHooks({ settingsPath }) {
  let settings = {};
  const exists = existsSync(settingsPath);
  if (exists) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch {
      throw new Error("unparseable");
    }
  }

  settings.hooks ??= {};
  let changed = false;
  for (const event of ["SessionStart", "UserPromptSubmit"]) {
    const groups = (settings.hooks[event] ??= []);
    const installed = groups.some((g) => (g.hooks ?? []).some((h) => h.command === hookCommand));
    if (!installed) {
      groups.push({ hooks: [{ type: "command", command: hookCommand, timeout: 10 }] });
      changed = true;
    }
  }

  if (changed || !exists) {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  }
  return { changed };
}

function resolveSettingsPath(args) {
  const explicit = args.includes("--settings") ? args[args.indexOf("--settings") + 1] : null;
  return explicit
    ? path.resolve(explicit)
    : args.includes("--user")
      ? path.join(homedir(), ".claude", "settings.json")
      : path.resolve(here, "../../..", ".claude", "settings.json");
}

// CLI entry — only when executed directly (never when imported).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const settingsPath = resolveSettingsPath(process.argv.slice(2));
  try {
    installBrianHooks({ settingsPath });
    console.log(`Brian hooks installed in ${settingsPath}`);
  } catch (err) {
    if (err && err.message === "unparseable") {
      console.error(`Refusing to modify unparseable JSON at ${settingsPath}`);
      process.exit(1);
    }
    throw err;
  }
}
