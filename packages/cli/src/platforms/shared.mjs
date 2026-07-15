import { existsSync } from "node:fs";
import {
  desiredHttpEntry,
  inspectJsonConfig,
  planJsonConnect,
  planJsonDisconnect,
  safeJsonInspection,
} from "../config/json.mjs";
import { inspectMarkerFile, planMarkerConnect, planMarkerDisconnect } from "../config/markers.mjs";

function safeMarkerInspection(inspection) {
  if (!inspection) return { state: "not-applicable" };
  return {
    file: inspection.file,
    state: inspection.state,
    ...(inspection.error ? { error: inspection.error } : {}),
  };
}

export function createJsonPlatform(spec) {
  const desiredEntry = desiredHttpEntry({ includeType: spec.includeType !== false });

  function detect(context) {
    const evidencePaths = spec.detectPaths(context);
    const pathDetected = evidencePaths.some(existsSync);
    const command = spec.command ? context.commandInfo(spec.command) : { installed: false, version: null };
    return {
      detected: pathDetected || command.installed,
      evidence: pathDetected ? "configuration directory found" : command.installed ? `${spec.command} command found` : "not found",
      commandInstalled: command.installed,
      version: command.version,
    };
  }

  function inspect(context) {
    const detection = detect(context);
    const configPath = spec.configPath(context);
    const config = inspectJsonConfig(configPath, desiredEntry);
    const marker = spec.markerPath ? inspectMarkerFile(spec.markerPath(context)) : null;
    return {
      name: spec.name,
      label: spec.label,
      detected: detection.detected,
      evidence: detection.evidence,
      version: detection.version,
      oauthCapability: spec.oauthCapability,
      config: safeJsonInspection(config),
      instructions: safeMarkerInspection(marker),
      restartRequired: spec.restartRequired,
    };
  }

  function connectPlan(context) {
    const config = planJsonConnect(spec.configPath(context), desiredEntry);
    const marker = spec.markerPath ? planMarkerConnect(spec.markerPath(context)) : null;
    return {
      name: spec.name,
      label: spec.label,
      before: inspect(context),
      changes: [...config.changes, ...(marker?.changes ?? [])],
      errors: [...config.errors, ...(marker?.errors ?? [])],
      warnings: [...(config.inspection.warnings ?? [])],
      nextStep: spec.nextStep,
      restartRequired: spec.restartRequired,
    };
  }

  function disconnectPlan(context) {
    const config = planJsonDisconnect(spec.configPath(context), desiredEntry);
    const marker = spec.markerPath ? planMarkerDisconnect(spec.markerPath(context)) : null;
    return {
      name: spec.name,
      label: spec.label,
      before: inspect(context),
      changes: [...config.changes, ...(marker?.changes ?? [])],
      errors: [...config.errors, ...(marker?.errors ?? [])],
      warnings: [...(config.inspection.warnings ?? [])],
      nextStep: spec.disconnectStep,
      restartRequired: spec.restartRequired,
    };
  }

  function loginPlan(context) {
    return spec.loginPlan(context);
  }

  return { name: spec.name, label: spec.label, detect, inspect, connectPlan, disconnectPlan, loginPlan };
}
