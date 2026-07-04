// Codex CLI adapter (Tier B — built against OpenAI Codex docs; not installed on
// this machine, so verified by fixture tests only).
//
// Docs (verify against current Codex docs before shipping to a customer):
//   - Config file: ~/.codex/config.toml
//   - MCP servers are TOML tables `[mcp_servers.<name>]` with `command`
//     (string), `args` (array), optional `env` (table). Streamable-HTTP servers
//     use a `url` key instead of command/args.
//   - Global instructions: ~/.codex/AGENTS.md is loaded every session.
// We never parse the TOML — we line-scan for the section and only ever append
// (existing content is never rewritten), so a broken config can't be corrupted.
import { existsSync } from "node:fs";
import path from "node:path";
import {
  readText,
  writeTextFile,
  tomlHasSection,
  appendTomlSection,
  wireMarkerFile,
  hasMarkerBlock,
  CONTRACT,
} from "../lib.mjs";

export const name = "codex";
export const label = "Codex CLI";

function paths(env) {
  const dir = env.codexDir ?? path.join(env.home, ".codex");
  return { dir, configToml: path.join(dir, "config.toml"), agents: path.join(dir, "AGENTS.md") };
}

function tomlSection(opts) {
  if (opts && opts.url) {
    const url = `${opts.url.replace(/\/+$/, "")}/mcp`;
    return (
      `[mcp_servers.brian]\nurl = "${url}"\n` +
      `# Provide the bearer token per Codex HTTP MCP docs (e.g. bearer_token / http_headers).\n`
    );
  }
  const args = JSON.stringify(["--prefix", opts.serverPath, "run", "mcp"]);
  return `[mcp_servers.brian]\ncommand = "npm"\nargs = ${args}\n`;
}

export function detect(env) {
  const { dir } = paths(env);
  const detected = existsSync(dir);
  return { detected, evidence: detected ? `${dir} exists` : `${dir} not found` };
}

export function status(env) {
  const { configToml, agents } = paths(env);
  const toml = readText(configToml);
  const mcp = toml && tomlHasSection(toml, "mcp_servers.brian") ? "wired" : "missing";
  const md = readText(agents);
  return { mcp, alwaysOn: md && hasMarkerBlock(md) ? "wired" : "missing" };
}

export function plan(env, opts) {
  const { configToml, agents } = paths(env);
  return [
    { file: configToml, action: "append [mcp_servers.brian]", layer: "mcp", description: "register Brian MCP server" },
    { file: agents, action: "append Brian contract marker block", layer: "rules", description: "contract loaded every session (tools model-pulled)" },
  ];
}

export async function apply(env, opts) {
  const { configToml, agents } = paths(env);
  const applied = [];
  const skipped = [];

  const current = readText(configToml) ?? "";
  if (tomlHasSection(current, "mcp_servers.brian")) {
    applied.push({ file: configToml, action: "mcp already wired" });
  } else {
    writeTextFile(configToml, appendTomlSection(current, tomlSection(opts)));
    applied.push({ file: configToml, action: "mcp wired" });
  }

  const md = wireMarkerFile(agents, CONTRACT);
  applied.push({ file: agents, action: md.status === "already" ? "contract already present" : "contract written" });

  return { applied, skipped };
}
