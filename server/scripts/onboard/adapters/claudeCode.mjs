// Claude Code adapter. MCP registration = merge mcpServers.brian into
// ~/.claude.json (what `claude mcp add --scope user` does under the hood; done
// as a file merge so it's hermetic and CLI-version-independent). Always-on
// layer = delegate to the shipped hooks installer (no duplication).
import { existsSync } from "node:fs";
import path from "node:path";
import { installBrianHooks, hookCommand } from "../../hooks/install.mjs";
import { mcpEntry, mergeMcpServer, readJsonFile } from "../lib.mjs";

export const name = "claude-code";
export const label = "Claude Code";

function paths(env) {
  return {
    dir: env.claudeDir ?? path.join(env.home, ".claude"),
    claudeJson: env.claudeJson ?? path.join(env.home, ".claude.json"),
    settings: env.claudeSettings ?? path.join(env.home, ".claude", "settings.json"),
  };
}

export function detect(env) {
  const { dir } = paths(env);
  const detected = existsSync(dir);
  return { detected, evidence: detected ? `${dir} exists` : `${dir} not found` };
}

export function status(env) {
  const { claudeJson, settings } = paths(env);
  const cj = readJsonFile(claudeJson);
  const mcp = cj.ok && cj.value && cj.value.mcpServers && cj.value.mcpServers.brian ? "wired" : "missing";
  const st = readJsonFile(settings);
  const hooked =
    st.ok &&
    ["SessionStart", "UserPromptSubmit"].every((e) =>
      ((st.value.hooks && st.value.hooks[e]) ?? []).some((g) =>
        (g.hooks ?? []).some((h) => h.command === hookCommand),
      ),
    );
  return { mcp, alwaysOn: hooked ? "wired" : "missing" };
}

export function plan(env, opts) {
  const { claudeJson, settings } = paths(env);
  return [
    {
      file: claudeJson,
      action: "merge mcpServers.brian",
      layer: "mcp",
      description: "register the Brian MCP server",
    },
    {
      file: settings,
      action: "install SessionStart + UserPromptSubmit hooks",
      layer: "hooks",
      description: "guaranteed per-prompt Brian briefing",
    },
  ];
}

export async function apply(env, opts) {
  const { claudeJson, settings } = paths(env);
  const applied = [];
  const skipped = [];

  const mcp = mergeMcpServer(claudeJson, mcpEntry(opts));
  if (mcp.status === "unparseable") {
    skipped.push({ file: claudeJson, reason: "unparseable JSON — not modified" });
  } else {
    applied.push({ file: claudeJson, action: mcp.status === "already" ? "mcp already wired" : "mcp wired" });
  }

  try {
    const res = installBrianHooks({ settingsPath: settings });
    applied.push({ file: settings, action: res.changed ? "hooks installed" : "hooks already installed" });
  } catch {
    skipped.push({ file: settings, reason: "unparseable JSON — not modified" });
  }

  return { applied, skipped };
}
