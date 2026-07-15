function commandPlan(executable, instruction) {
  const args = ["mcp", "login", "brian"];
  return {
    kind: "command",
    executable,
    args,
    retryCommand: `${executable} ${args.join(" ")}`,
    instruction,
  };
}

function nonCommandPlan(kind, instruction) {
  return {
    kind,
    executable: null,
    args: [],
    retryCommand: null,
    instruction,
  };
}

export function codexLoginPlan(runtime) {
  if (runtime?.commandInfo && !runtime.commandInfo("codex").installed) {
    return nonCommandPlan(
      "unavailable",
      "Install or upgrade Codex before authenticating Brian.",
    );
  }
  return commandPlan("codex", "Authenticate Brian now in Codex.");
}

export function claudeCodeLoginPlan(runtime) {
  if (runtime?.commandSupports?.("claude", ["mcp", "login", "--help"])) {
    return commandPlan("claude", "Authenticate Brian now in Claude Code.");
  }
  return nonCommandPlan(
    "unavailable",
    "Upgrade Claude Code or run the Brian connection from Claude's MCP settings.",
  );
}

export function cursorLoginPlan() {
  return nonCommandPlan(
    "manual",
    "Restart Cursor, open MCP settings, select Brian, and choose Connect.",
  );
}

export function claudeDesktopLoginPlan() {
  return nonCommandPlan(
    "manual",
    "Open https://claude.ai/customize/connectors, choose Add custom connector, name it Brian, and enter https://api.brianthebrain.app/mcp.",
  );
}
