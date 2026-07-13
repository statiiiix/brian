export const MCP_RESOURCE = "https://api.brianthebrain.app/mcp";
export const MCP_RESOURCE_METADATA =
  "https://api.brianthebrain.app/.well-known/oauth-protected-resource/mcp";

// Supabase's OAuth server currently supports the standard identity scopes.
// Brian capabilities live in agent_connections and custom JWT claims until
// custom OAuth scopes are documented as generally available.
export const MCP_OAUTH_SCOPES = ["email"] as const;

export function oauthChallenge(error?: "invalid_token" | "insufficient_scope"): string {
  const parts = [
    `Bearer resource_metadata="${MCP_RESOURCE_METADATA}"`,
    `scope="${MCP_OAUTH_SCOPES.join(" ")}"`,
  ];
  if (error) parts.push(`error="${error}"`);
  return parts.join(", ");
}
