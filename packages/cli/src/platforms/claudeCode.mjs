import path from "node:path";
import { claudeCodeLoginPlan } from "../login/native.mjs";
import { createJsonPlatform } from "./shared.mjs";

export const claudeCode = createJsonPlatform({
  name: "claude-code",
  label: "Claude Code",
  command: "claude",
  oauthCapability: "native-command-surface-unverified",
  restartRequired: true,
  detectPaths: (context) => [path.join(context.home, ".claude"), path.join(context.home, ".claude.json")],
  configPath: (context) => path.join(context.home, ".claude.json"),
  loginPlan: claudeCodeLoginPlan,
  nextStep: 'Run "claude mcp login brian" or open Claude Code and authenticate Brian.',
  disconnectStep: "Restart Claude Code. Revoke the server-side grant separately from the Brian dashboard if desired.",
});
