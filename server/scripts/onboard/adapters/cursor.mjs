// Cursor adapter. MCP registration = merge mcpServers.brian into
// ~/.cursor/mcp.json (global). Always-on layer = the Brian contract in a marker
// block appended to ~/.cursor/AGENTS.md (global rules, in context every session;
// tools are still model-pulled — honest label).
import { existsSync } from "node:fs";
import path from "node:path";
import { mcpEntry, mergeMcpServer, wireMarkerFile, readJsonFile, readText, hasMarkerBlock, CONTRACT } from "../lib.mjs";

export const name = "cursor";
export const label = "Cursor";

function paths(env) {
  const dir = env.cursorDir ?? path.join(env.home, ".cursor");
  return { dir, mcpJson: path.join(dir, "mcp.json"), agents: path.join(dir, "AGENTS.md") };
}

export function detect(env) {
  const { dir } = paths(env);
  const detected = existsSync(dir);
  return { detected, evidence: detected ? `${dir} exists` : `${dir} not found` };
}

export function status(env) {
  const { mcpJson, agents } = paths(env);
  const read = readJsonFile(mcpJson);
  const mcp = read.ok && read.value && read.value.mcpServers && read.value.mcpServers.brian ? "wired" : "missing";
  const md = readText(agents);
  return { mcp, alwaysOn: md && hasMarkerBlock(md) ? "wired" : "missing" };
}

export function plan(env, opts) {
  const { mcpJson, agents } = paths(env);
  return [
    { file: mcpJson, action: "merge mcpServers.brian", layer: "mcp", description: "register Brian MCP server" },
    { file: agents, action: "append Brian contract marker block", layer: "rules", description: "contract always in context (tools model-pulled)" },
  ];
}

export async function apply(env, opts) {
  const { mcpJson, agents } = paths(env);
  const applied = [];
  const skipped = [];

  const mcp = mergeMcpServer(mcpJson, mcpEntry(opts));
  if (mcp.status === "unparseable") {
    skipped.push({ file: mcpJson, reason: "unparseable JSON — not modified" });
  } else {
    applied.push({ file: mcpJson, action: mcp.status === "already" ? "mcp already wired" : "mcp wired" });
  }

  const md = wireMarkerFile(agents, CONTRACT);
  applied.push({ file: agents, action: md.status === "already" ? "contract already present" : "contract written" });

  return { applied, skipped };
}
