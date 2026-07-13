export const PACKAGE_VERSION = "0.1.0";

export const CANONICAL_MCP_URL = "https://api.brianthebrain.app/mcp";
export const SIGNUP_URL = "https://brianthebrain.app/signup?source=cli";

export const EXIT = Object.freeze({
  OK: 0,
  FAILED: 1,
  USAGE: 2,
  NO_CLIENTS: 3,
  DECLINED: 4,
});

export const PLATFORM_NAMES = Object.freeze([
  "claude-code",
  "claude-desktop",
  "cursor",
  "codex",
]);

export const MARKER_OPEN = "# >>> brian >>>";
export const MARKER_CLOSE = "# <<< brian <<<";

export const AGENT_CONTRACT = `You are connected to Brian, this company's brain. Follow this contract on every task:
1. BEFORE acting, call find_skill with the task and find_context for relevant goals, decisions, and preferences. If no skill matches a business process, ask a human; do not improvise.
2. Follow the skill's procedure within its hard_rules.
3. If a guardrail triggers, stop and escalate to the skill's escalation_target.
4. Use only the tools the skill lists for business actions.
5. After finishing or escalating, call log_execution.
6. Call capture when you learn something durable.`;

export function protectedResourceMetadataUrl(resourceUrl = CANONICAL_MCP_URL) {
  const resource = new URL(resourceUrl);
  return new URL("/.well-known/oauth-protected-resource/mcp", resource.origin).toString();
}

export function rootProtectedResourceMetadataUrl(resourceUrl = CANONICAL_MCP_URL) {
  const resource = new URL(resourceUrl);
  return new URL("/.well-known/oauth-protected-resource", resource.origin).toString();
}
