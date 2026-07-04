// OpenClaw / Clawdbot adapter (Tier B — conservative). The tool is not on this
// machine and its config format is not stably documented, so we never guess a
// config layout. Always-on layer = the Brian contract marker block in the
// workspace/global AGENTS.md (best-effort). MCP registration is reported as a
// MANUAL step with printed instructions (skip flagged manual:true so it does
// not count as a failed/refused wire in the exit code).
import { existsSync } from "node:fs";
import path from "node:path";
import { wireMarkerFile, readText, hasMarkerBlock, CONTRACT } from "../lib.mjs";

export const name = "openclaw";
export const label = "OpenClaw (Clawdbot)";

function configDir(env) {
  if (env.openclawDir) return env.openclawDir;
  const oc = path.join(env.home, ".openclaw");
  const cb = path.join(env.home, ".clawdbot");
  if (existsSync(oc)) return oc;
  if (existsSync(cb)) return cb;
  return oc; // default target when creating
}

export function detect(env) {
  if (env.openclawDir) {
    const detected = existsSync(env.openclawDir);
    return { detected, evidence: detected ? `${env.openclawDir} exists` : `${env.openclawDir} not found` };
  }
  const oc = path.join(env.home, ".openclaw");
  const cb = path.join(env.home, ".clawdbot");
  const dir = existsSync(oc) ? oc : existsSync(cb) ? cb : null;
  return { detected: dir !== null, evidence: dir ? `${dir} exists` : "no ~/.openclaw or ~/.clawdbot" };
}

export function status(env) {
  const agents = path.join(configDir(env), "AGENTS.md");
  const md = readText(agents);
  return { mcp: "unsupported", alwaysOn: md && hasMarkerBlock(md) ? "wired" : "missing" };
}

export function plan(env, opts) {
  const dir = configDir(env);
  return [
    {
      file: path.join(dir, "AGENTS.md"),
      action: "append Brian contract marker block",
      layer: "rules",
      description: "contract in workspace bootstrap (tools model-pulled)",
    },
    {
      file: "(manual)",
      action: "register MCP server by hand",
      layer: "mcp",
      description: "OpenClaw MCP config format unverified — printed as manual steps",
    },
  ];
}

export async function apply(env, opts) {
  const dir = configDir(env);
  const agents = path.join(dir, "AGENTS.md");
  const applied = [];
  const skipped = [];

  const md = wireMarkerFile(agents, CONTRACT);
  applied.push({ file: agents, action: md.status === "already" ? "contract already present" : "contract written" });

  skipped.push({
    file: "(mcp)",
    reason: "manual — OpenClaw MCP config format unverified; register Brian per OpenClaw docs",
    manual: true,
  });

  return { applied, skipped };
}
