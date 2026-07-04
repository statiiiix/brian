#!/usr/bin/env node
// Brian onboarder. One command detects the AI-agent platforms installed on this
// machine and wires each one to Brian: MCP registration + the strongest
// always-on layer that platform supports. Safe (timestamped backups, refuses
// unparseable configs), idempotent (re-runs are zero-diff), confirm-by-default.
//
// Usage: node onboard.mjs [--yes] [--dry-run] [--status] [--only a,b]
//                         [--url <https://…> --token <TOKEN>]
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

import * as claudeCode from "./adapters/claudeCode.mjs";
import * as claudeDesktop from "./adapters/claudeDesktop.mjs";
import * as cursor from "./adapters/cursor.mjs";
import * as codex from "./adapters/codex.mjs";
import * as openclaw from "./adapters/openclaw.mjs";

// Adding a platform later = adding one adapter module to this array.
const REGISTRY = [claudeCode, claudeDesktop, cursor, codex, openclaw];

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(here, "../.."); // scripts/onboard -> server

const HELP = `Brian onboarder — wire your AI agents to the company brain.

Usage: npm run onboard [-- <flags>]
  --status        show a table of platform / detected / mcp / always-on
  --dry-run       print the plan; change nothing
  --yes, -y       apply without the confirmation prompt
  --only a,b      limit to named platforms (${REGISTRY.map((a) => a.name).join(", ")})
  --url  <url>    wire a remote/hosted Brian (Streamable HTTP) instead of local stdio
  --token <tok>   bearer token for --url
  --help, -h      show this help
`;

function parseArgs(argv) {
  const flags = { yes: false, dryRun: false, status: false, only: null, url: null, token: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--status") flags.status = true;
    else if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--only") flags.only = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--url") flags.url = argv[++i] ?? null;
    else if (a === "--token") flags.token = argv[++i] ?? null;
  }
  return flags;
}

function makeEnv() {
  return { home: process.env.HOME || homedir(), platform: process.platform, serverPath: SERVER_PATH };
}

function selectedAdapters(flags) {
  if (!flags.only) return REGISTRY;
  const set = new Set(flags.only);
  return REGISTRY.filter((a) => set.has(a.name));
}

function layerLabel(layer) {
  switch (layer) {
    case "hooks": return "guaranteed per-prompt briefing";
    case "rules": return "contract always in context (tools still model-pulled)";
    case "instructions": return "contract delivered at connect";
    case "mcp": return "MCP server registered";
    default: return layer;
  }
}

async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(question, res));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function out(s) {
  process.stdout.write(s);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    out(HELP);
    return 0;
  }
  if (flags.url && !flags.token) {
    process.stderr.write("Remote --url requires --token <bearer>.\n");
    return 2;
  }

  const env = makeEnv();
  const opts = { serverPath: SERVER_PATH, url: flags.url, token: flags.token };
  const adapters = selectedAdapters(flags);
  const rows = adapters.map((a) => ({ a, detected: a.detect(env) }));

  if (flags.status) {
    out("Platform            Detected  MCP         Always-on\n");
    for (const { a, detected } of rows) {
      const s = detected.detected ? a.status(env) : { mcp: "-", alwaysOn: "-" };
      out(
        `${a.label.padEnd(20)}${(detected.detected ? "yes" : "no").padEnd(10)}` +
          `${String(s.mcp).padEnd(12)}${s.alwaysOn}\n`,
      );
    }
    return 0;
  }

  const detectedRows = rows.filter((r) => r.detected.detected);
  const notDetected = rows.filter((r) => !r.detected.detected);

  if (detectedRows.length === 0) {
    out("No supported agent platforms detected on this machine.\n");
    for (const { a, detected } of notDetected) out(`  - ${a.label}: ${detected.evidence}\n`);
    return 0;
  }

  out(`Brian (${flags.url ? `remote ${flags.url}` : `local, ${SERVER_PATH}`}) will wire:\n\n`);
  for (const { a } of detectedRows) {
    out(`${a.label}\n`);
    for (const step of a.plan(env, opts)) {
      out(`  - ${step.file}\n      ${step.action} — ${layerLabel(step.layer)}\n`);
    }
  }

  if (flags.dryRun) {
    out("\n(dry run — nothing written)\n");
    return 0;
  }

  if (!flags.yes) {
    const ok = await confirm("\nProceed? [y/N] ");
    if (!ok) {
      out("Aborted (no changes). Re-run with --yes to skip this prompt.\n");
      return 0;
    }
  }

  let refusals = 0;
  out("\n");
  for (const { a } of detectedRows) {
    const res = await a.apply(env, opts);
    out(`${a.label}:\n`);
    for (const it of res.applied) out(`  ✓ ${it.action} (${it.file})\n`);
    for (const sk of res.skipped) {
      out(`  ${sk.manual ? "•" : "✗"} ${sk.reason} (${sk.file})\n`);
      if (!sk.manual) refusals++;
    }
  }

  out("\nNext steps:\n");
  out("  - Restart each app (Claude Desktop, Cursor, Codex) to load the new MCP server.\n");
  out(`  - Keep the Brian API running for the per-prompt hook: cd ${SERVER_PATH} && npm run api\n`);
  if (notDetected.length) {
    out("  - Not detected (skipped): " + notDetected.map((r) => r.a.label).join(", ") + "\n");
  }
  if (refusals > 0) {
    out(`\n${refusals} item(s) were refused (unparseable config). Fix and re-run.\n`);
  }

  return refusals > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
    process.exit(1);
  });
