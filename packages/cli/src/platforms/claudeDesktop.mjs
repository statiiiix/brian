import { existsSync } from "node:fs";
import path from "node:path";
import { createJsonPlatform } from "./shared.mjs";

export function claudeDesktopDirectory(context) {
  if (context.platform === "win32") {
    return path.join(context.env.APPDATA ?? path.join(context.home, "AppData", "Roaming"), "Claude");
  }
  if (context.platform === "linux") return path.join(context.home, ".config", "Claude");
  return path.join(context.home, "Library", "Application Support", "Claude");
}

export function claudeDesktopConfigPath(context) {
  const directory = claudeDesktopDirectory(context);
  const primary = path.join(directory, "claude_desktop_config.json");
  const alternate = path.join(directory, "mcp.json");
  return existsSync(primary) ? primary : existsSync(alternate) ? alternate : primary;
}

export const claudeDesktop = createJsonPlatform({
  name: "claude-desktop",
  label: "Claude Desktop",
  oauthCapability: "compatibility-unverified",
  restartRequired: true,
  detectPaths: (context) => [claudeDesktopDirectory(context)],
  configPath: claudeDesktopConfigPath,
  nextStep: "Restart Claude Desktop, open the Brian connection, and complete browser authorization if this client version supports remote MCP OAuth.",
  disconnectStep: "Restart Claude Desktop. Revoke the server-side grant separately from the Brian dashboard if desired.",
});
