// Claude Desktop adapter. MCP registration = merge mcpServers.brian into the
// config file that actually exists under the per-OS Claude support dir
// (claude_desktop_config.json preferred, else mcp.json, else create the former).
// No hook surface: the always-on layer is the MCP `instructions` delivered at
// connect, so it's reported as "unsupported" here (honest label).
import { existsSync } from "node:fs";
import path from "node:path";
import { mcpEntry, mergeMcpServer, readJsonFile } from "../lib.mjs";

export const name = "claude-desktop";
export const label = "Claude Desktop";

function desktopDir(env) {
  if (env.claudeDesktopDir) return env.claudeDesktopDir;
  const home = env.home;
  if (env.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Claude");
  }
  if (env.platform === "linux") return path.join(home, ".config", "Claude");
  // darwin (default)
  return path.join(home, "Library", "Application Support", "Claude");
}

// The live config file: whichever of the two known names exists; else the
// canonical one to create.
function configFile(dir) {
  const primary = path.join(dir, "claude_desktop_config.json");
  const alt = path.join(dir, "mcp.json");
  if (existsSync(primary)) return primary;
  if (existsSync(alt)) return alt;
  return primary;
}

export function detect(env) {
  const dir = desktopDir(env);
  const detected = existsSync(dir);
  return { detected, evidence: detected ? `${dir} exists` : `${dir} not found` };
}

export function status(env) {
  const file = configFile(desktopDir(env));
  const read = readJsonFile(file);
  const mcp = read.ok && read.value && read.value.mcpServers && read.value.mcpServers.brian ? "wired" : "missing";
  return { mcp, alwaysOn: "unsupported" };
}

export function plan(env, opts) {
  const file = configFile(desktopDir(env));
  return [
    {
      file,
      action: "merge mcpServers.brian",
      layer: "instructions",
      description: "register Brian MCP server (contract delivered at connect)",
    },
  ];
}

export async function apply(env, opts) {
  const file = configFile(desktopDir(env));
  const applied = [];
  const skipped = [];
  const mcp = mergeMcpServer(file, mcpEntry(opts));
  if (mcp.status === "unparseable") {
    skipped.push({ file, reason: "unparseable JSON — not modified" });
  } else {
    applied.push({ file, action: mcp.status === "already" ? "mcp already wired" : "mcp wired" });
  }
  return { applied, skipped };
}
