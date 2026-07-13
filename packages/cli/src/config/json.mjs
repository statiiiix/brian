import { isDeepStrictEqual } from "node:util";
import { CANONICAL_MCP_URL } from "../constants.mjs";
import { makeChange, readFileState } from "./files.mjs";

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsStaticCredential(value, parentKey = "") {
  if (Array.isArray(value)) return value.some((item) => containsStaticCredential(item, parentKey));
  if (!isObject(value)) {
    if (typeof value !== "string" || value.length === 0) return false;
    const key = parentKey.toLowerCase().replace(/[^a-z0-9]/g, "");
    return (
      key === "authorization" ||
      key.includes("bearertoken") ||
      key.includes("apitoken") ||
      key.includes("apikey") ||
      key.includes("clientsecret") ||
      key.endsWith("token") ||
      key.includes("tokenenvvar") ||
      /^bearer\s+/i.test(value)
    );
  }
  return Object.entries(value).some(([key, item]) => containsStaticCredential(item, key));
}

export function isLegacySupabaseUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.hostname.endsWith(".supabase.co") && /\/functions\/v1\/brian(?:\/|$)/.test(url.pathname);
  } catch {
    return /\.supabase\.co\/functions\/v1\/brian(?:\/|$)/i.test(value);
  }
}

export function desiredHttpEntry({ includeType = true } = {}) {
  return includeType
    ? { type: "http", url: CANONICAL_MCP_URL }
    : { url: CANONICAL_MCP_URL };
}

export function inspectJsonConfig(file, desiredEntry = desiredHttpEntry()) {
  const source = readFileState(file);
  if (source.status === "missing") {
    return {
      file,
      source,
      document: {},
      configState: "missing",
      brianState: "missing",
      warnings: [],
      staticCredential: false,
      legacyEndpoint: false,
    };
  }
  if (source.status !== "ok") {
    return {
      file,
      source,
      configState: source.status,
      brianState: "invalid",
      warnings: [],
      error: `cannot safely read ${source.status} configuration`,
    };
  }

  let document;
  try {
    document = JSON.parse(source.text);
  } catch {
    return {
      file,
      source,
      configState: "malformed",
      brianState: "invalid",
      warnings: [],
      error: "malformed JSON; file was not modified",
    };
  }

  if (!isObject(document) || (document.mcpServers !== undefined && !isObject(document.mcpServers))) {
    return {
      file,
      source,
      configState: "invalid-shape",
      brianState: "invalid",
      warnings: [],
      error: "JSON root and mcpServers must be objects; file was not modified",
    };
  }

  const duplicateBrianKeys = source.text.match(/"brian"\s*:/g)?.length ?? 0;
  if (duplicateBrianKeys > 1) {
    return {
      file,
      source,
      document,
      configState: "duplicate",
      brianState: "invalid",
      warnings: [],
      error: "multiple Brian keys found; resolve the duplicate before retrying",
    };
  }

  const entry = document.mcpServers?.brian;
  if (entry === undefined) {
    return {
      file,
      source,
      document,
      configState: "valid",
      brianState: "missing",
      warnings: [],
      staticCredential: false,
      legacyEndpoint: false,
    };
  }
  if (!isObject(entry)) {
    return {
      file,
      source,
      document,
      configState: "invalid-shape",
      brianState: "invalid",
      warnings: [],
      error: "mcpServers.brian must be an object; file was not modified",
    };
  }

  const staticCredential = containsStaticCredential(entry);
  const legacyEndpoint = isLegacySupabaseUrl(entry.url);
  const exact = isDeepStrictEqual(entry, desiredEntry);
  const warnings = [];
  if (legacyEndpoint) warnings.push("legacy raw Supabase Brian endpoint detected");
  if (staticCredential) {
    warnings.push("legacy static credential detected; its value will never be printed");
  }

  let brianState = "noncanonical";
  if (exact) brianState = "connected";
  else if (legacyEndpoint || staticCredential) brianState = "legacy";
  else if (typeof entry.command === "string") brianState = "local";
  else if (entry.url === CANONICAL_MCP_URL) brianState = "needs-cleanup";
  else if (typeof entry.url === "string") brianState = "other-endpoint";

  return {
    file,
    source,
    document,
    configState: "valid",
    brianState,
    warnings,
    staticCredential,
    legacyEndpoint,
  };
}

export function planJsonConnect(file, desiredEntry = desiredHttpEntry()) {
  const inspection = inspectJsonConfig(file, desiredEntry);
  if (inspection.error) return { inspection, changes: [], errors: [inspection.error] };
  if (inspection.brianState === "connected") return { inspection, changes: [], errors: [] };

  const document = {
    ...inspection.document,
    mcpServers: {
      ...(inspection.document.mcpServers ?? {}),
      brian: desiredEntry,
    },
  };
  const nextText = `${JSON.stringify(document, null, 2)}\n`;
  const action = inspection.brianState === "missing" ? "add Brian OAuth MCP entry" : "replace Brian entry with canonical OAuth MCP URL";
  const change = makeChange(inspection.source, nextText, action, "json");
  return { inspection, changes: change ? [change] : [], errors: [] };
}

export function planJsonDisconnect(file, desiredEntry = desiredHttpEntry()) {
  const inspection = inspectJsonConfig(file, desiredEntry);
  if (inspection.error) return { inspection, changes: [], errors: [inspection.error] };
  if (inspection.brianState === "missing") return { inspection, changes: [], errors: [] };

  const mcpServers = { ...(inspection.document.mcpServers ?? {}) };
  delete mcpServers.brian;
  const document = { ...inspection.document, mcpServers };
  const nextText = `${JSON.stringify(document, null, 2)}\n`;
  const change = makeChange(inspection.source, nextText, "remove only the Brian MCP entry", "json");
  return { inspection, changes: change ? [change] : [], errors: [] };
}

export function safeJsonInspection(inspection) {
  return {
    file: inspection.file,
    configState: inspection.configState,
    brianState: inspection.brianState,
    staticCredential: Boolean(inspection.staticCredential),
    legacyEndpoint: Boolean(inspection.legacyEndpoint),
    warnings: [...(inspection.warnings ?? [])],
    ...(inspection.error ? { error: inspection.error } : {}),
  };
}
