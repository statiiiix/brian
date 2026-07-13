import path from "node:path";
import { createJsonPlatform } from "./shared.mjs";

export const cursor = createJsonPlatform({
  name: "cursor",
  label: "Cursor",
  oauthCapability: "compatibility-unverified",
  restartRequired: true,
  detectPaths: (context) => [path.join(context.home, ".cursor")],
  configPath: (context) => path.join(context.home, ".cursor", "mcp.json"),
  markerPath: (context) => path.join(context.home, ".cursor", "AGENTS.md"),
  nextStep: "Restart Cursor, open the Brian MCP connection, and complete browser authorization if prompted.",
  disconnectStep: "Restart Cursor. Revoke the server-side grant separately from the Brian dashboard if desired.",
});
