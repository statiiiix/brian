import { existsSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";
import { CANONICAL_MCP_URL } from "../constants.mjs";
import { applyChanges, makeChange, readFileState } from "./files.mjs";

const SCHEMA_VERSION = 1;
const HEALTH_STATUSES = new Set(["healthy", "issues-found", "no-clients"]);

export function healthFile(runtime) {
  return path.join(runtime.home, ".brian", "health.json");
}

function unknownHealth() {
  return {
    schemaVersion: SCHEMA_VERSION,
    status: "unknown",
    checkedAt: null,
    resource: CANONICAL_MCP_URL,
  };
}

function safeResource(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function readLastHealth(runtime) {
  const state = readFileState(healthFile(runtime));
  if (state.status !== "ok") return unknownHealth();
  try {
    const parsed = JSON.parse(state.text);
    const resource = safeResource(parsed.resource);
    const checkedAt = new Date(parsed.checkedAt);
    if (
      parsed.schemaVersion !== SCHEMA_VERSION
      || !HEALTH_STATUSES.has(parsed.status)
      || !resource
      || !Number.isFinite(checkedAt.getTime())
    ) return unknownHealth();
    return {
      schemaVersion: SCHEMA_VERSION,
      status: parsed.status,
      checkedAt: checkedAt.toISOString(),
      resource,
    };
  } catch {
    return unknownHealth();
  }
}

export function saveLastHealth(runtime, { status, resource }) {
  if (!HEALTH_STATUSES.has(status)) return false;
  const normalizedResource = safeResource(resource);
  if (!normalizedResource) return false;

  const directory = path.dirname(healthFile(runtime));
  try {
    if (existsSync(directory)) {
      const info = lstatSync(directory);
      if (info.isSymbolicLink() || !info.isDirectory()) return false;
    } else {
      mkdirSync(directory, { mode: 0o700 });
    }

    const state = readFileState(healthFile(runtime));
    if (state.status !== "ok" && state.status !== "missing") return false;
    const record = {
      schemaVersion: SCHEMA_VERSION,
      checkedAt: runtime.now().toISOString(),
      status,
      resource: normalizedResource,
    };
    const change = makeChange(
      state,
      `${JSON.stringify(record, null, 2)}\n`,
      "record last Brian health check",
      "state",
    );
    if (!change) return true;
    change.mode = 0o600;
    return applyChanges([change], { now: runtime.now, backup: false }).errors.length === 0;
  } catch {
    // Health persistence is best effort and must never break diagnostics.
    return false;
  }
}
