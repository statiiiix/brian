import type { HumanRole } from "./principal.js";

export const AGENT_PERMISSIONS = [
  "skills:read",
  "context:read",
  "knowledge:write",
  "executions:write",
  "actions:execute",
] as const;

export type AgentPermission = (typeof AGENT_PERMISSIONS)[number];

export const DEFAULT_AGENT_PERMISSIONS: AgentPermission[] = [
  "skills:read",
  "context:read",
  "executions:write",
];

const TOOL_PERMISSIONS: Record<string, AgentPermission> = {
  find_skill: "skills:read",
  get_skill: "skills:read",
  find_context: "context:read",
  capture: "knowledge:write",
  log_execution: "executions:write",
};

export function isAgentPermission(value: unknown): value is AgentPermission {
  return typeof value === "string" && (AGENT_PERMISSIONS as readonly string[]).includes(value);
}

export function normalizePermissions(value: unknown): AgentPermission[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isAgentPermission))];
}

export function permissionsForOAuthScope(scope: unknown): AgentPermission[] {
  const requested = typeof scope === "string"
    ? normalizePermissions(scope.split(/\s+/).filter(Boolean))
    : [];
  return requested.length > 0 ? requested : [...DEFAULT_AGENT_PERMISSIONS];
}

export function validateSelectedAgentPermissions(
  value: unknown,
  role: HumanRole,
): { ok: true; permissions: AgentPermission[] } | { ok: false; reason: string } {
  if (!Array.isArray(value)
    || value.some((permission) => !isAgentPermission(permission))
    || new Set(value).size !== value.length) {
    return { ok: false, reason: "invalid agent permissions" };
  }
  const permissions = AGENT_PERMISSIONS.filter((permission) => value.includes(permission));
  if (!DEFAULT_AGENT_PERMISSIONS.every((permission) => permissions.includes(permission))) {
    return { ok: false, reason: "default agent permissions are required" };
  }
  if (permissions.includes("actions:execute") && role !== "owner" && role !== "admin") {
    return { ok: false, reason: "actions:execute requires an owner or admin" };
  }
  return { ok: true, permissions };
}

export function requiredPermissionForTool(toolName: string): AgentPermission {
  return TOOL_PERMISSIONS[toolName] ?? "actions:execute";
}

export function hasPermission(
  granted: readonly AgentPermission[],
  required: AgentPermission,
): boolean {
  return granted.includes(required);
}

export function samePermissions(a: readonly AgentPermission[], b: readonly AgentPermission[]): boolean {
  return a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
}
