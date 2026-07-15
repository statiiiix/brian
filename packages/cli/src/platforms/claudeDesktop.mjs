import { existsSync } from "node:fs";
import path from "node:path";
import { CANONICAL_MCP_URL } from "../constants.mjs";
import { inspectJsonConfig, planJsonDisconnect, safeJsonInspection } from "../config/json.mjs";
import { claudeDesktopLoginPlan } from "../login/native.mjs";

const CONNECTORS_URL = "https://claude.ai/customize/connectors";
const CONNECT_STEP = `Open ${CONNECTORS_URL}, choose Add custom connector, name it Brian, and enter ${CANONICAL_MCP_URL}.`;

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

function detect(context) {
  return {
    detected: existsSync(claudeDesktopDirectory(context)),
    evidence: existsSync(claudeDesktopDirectory(context)) ? "configuration directory found" : "not found",
    commandInstalled: false,
    version: null,
  };
}

function localInspection(context) {
  const inspection = inspectJsonConfig(claudeDesktopConfigPath(context));
  if (inspection.brianState === "missing") {
    return { ...inspection, brianState: "external-ui" };
  }
  if (!inspection.error) {
    return {
      ...inspection,
      brianState: "unsupported-local-entry",
      warnings: [
        ...(inspection.warnings ?? []),
        "Claude Desktop remote connectors belong in Claude's account-level Connectors UI",
      ],
    };
  }
  return inspection;
}

function inspect(context) {
  const detection = detect(context);
  return {
    name: "claude-desktop",
    label: "Claude Desktop",
    detected: detection.detected,
    evidence: detection.evidence,
    version: null,
    oauthCapability: "documented-custom-connector-ui",
    config: safeJsonInspection(localInspection(context)),
    instructions: { state: "not-applicable" },
    restartRequired: false,
  };
}

function cleanupPlan(context, nextStep) {
  const cleanup = planJsonDisconnect(claudeDesktopConfigPath(context));
  return {
    name: "claude-desktop",
    label: "Claude Desktop",
    before: inspect(context),
    changes: cleanup.changes,
    errors: cleanup.errors,
    warnings: cleanup.inspection.brianState === "missing"
      ? [...(cleanup.inspection.warnings ?? [])]
      : [
        ...(cleanup.inspection.warnings ?? []),
        "removing the unsupported local Brian entry before account-level connector setup",
      ],
    nextStep,
    restartRequired: false,
  };
}

export const claudeDesktop = {
  name: "claude-desktop",
  label: "Claude Desktop",
  detect,
  inspect,
  connectPlan: (context) => cleanupPlan(context, CONNECT_STEP),
  disconnectPlan: (context) => cleanupPlan(
    context,
    `Remove Brian from ${CONNECTORS_URL}, then revoke its Brian grant if immediate denial is required.`,
  ),
  loginPlan: claudeDesktopLoginPlan,
};
