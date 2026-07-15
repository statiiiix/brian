import { existsSync } from "node:fs";
import path from "node:path";
import { codexLoginPlan } from "../login/native.mjs";
import { inspectMarkerFile, planMarkerConnect, planMarkerDisconnect } from "../config/markers.mjs";
import { inspectTomlConfig, planTomlConnect, planTomlDisconnect, safeTomlInspection } from "../config/toml.mjs";

function findProjectConfig(context, globalConfig) {
  let directory = path.resolve(context.cwd);
  const globalPath = path.resolve(globalConfig);
  while (true) {
    const candidate = path.join(directory, ".codex", "config.toml");
    if (path.resolve(candidate) !== globalPath && existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function paths(context) {
  const directory = path.join(context.home, ".codex");
  const config = path.join(directory, "config.toml");
  return {
    directory,
    config,
    agents: path.join(directory, "AGENTS.md"),
    projectConfig: findProjectConfig(context, config),
  };
}

function safeMarker(inspection) {
  return {
    file: inspection.file,
    state: inspection.state,
    ...(inspection.error ? { error: inspection.error } : {}),
  };
}

export const codex = {
  name: "codex",
  label: "Codex CLI/app",
  detect(context) {
    const located = paths(context);
    const command = context.commandInfo("codex");
    const pathDetected = existsSync(located.directory);
    return {
      detected: pathDetected || command.installed,
      evidence: pathDetected ? "configuration directory found" : command.installed ? "codex command found" : "not found",
      commandInstalled: command.installed,
      version: command.version,
    };
  },
  inspect(context) {
    const detection = this.detect(context);
    const located = paths(context);
    return {
      name: this.name,
      label: this.label,
      detected: detection.detected,
      evidence: detection.evidence,
      version: detection.version,
      oauthCapability: "native-command-surface-unverified",
      config: safeTomlInspection(inspectTomlConfig(located.config)),
      instructions: safeMarker(inspectMarkerFile(located.agents)),
      restartRequired: true,
    };
  },
  loginPlan(context) {
    return codexLoginPlan(context);
  },
  connectPlan(context) {
    const located = paths(context);
    const config = planTomlConnect(located.config);
    const marker = planMarkerConnect(located.agents);
    const errors = [...config.errors, ...marker.errors];
    if (located.projectConfig) {
      const project = inspectTomlConfig(located.projectConfig);
      if (project.brianState === "local") {
        errors.push(`project-level Codex config defines Brian as a local server: ${located.projectConfig}`);
      }
    }
    return {
      name: this.name,
      label: this.label,
      before: this.inspect(context),
      changes: [...config.changes, ...marker.changes],
      errors,
      warnings: [...(config.inspection.warnings ?? [])],
      nextStep: 'Run "codex mcp login brian" or open Codex and authenticate Brian.',
      restartRequired: true,
    };
  },
  disconnectPlan(context) {
    const located = paths(context);
    const config = planTomlDisconnect(located.config);
    const marker = planMarkerDisconnect(located.agents);
    return {
      name: this.name,
      label: this.label,
      before: this.inspect(context),
      changes: [...config.changes, ...marker.changes],
      errors: [...config.errors, ...marker.errors],
      warnings: [...(config.inspection.warnings ?? [])],
      nextStep: "Restart Codex. Revoke the server-side grant separately from the Brian dashboard if desired.",
      restartRequired: true,
    };
  },
};
