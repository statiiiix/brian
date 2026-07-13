function icon(status) {
  if (status === "pass" || status === "connected") return "✓";
  if (status === "warn") return "!";
  if (status === "fail" || status === "invalid") return "✗";
  return "•";
}

function renderClientStatus(client) {
  const lines = [`${client.label}: ${client.detected ? "detected" : "not detected"}`];
  if (client.version) lines.push(`  Version: ${client.version}`);
  lines.push(`  MCP config: ${client.config.brianState} (${client.config.file})`);
  if (client.instructions.state !== "not-applicable") {
    lines.push(`  Instructions: ${client.instructions.state} (${client.instructions.file})`);
  }
  lines.push(`  OAuth capability: ${client.oauthCapability}`);
  for (const warning of client.config.warnings ?? []) lines.push(`  ! ${warning}`);
  if (client.config.error) lines.push(`  ✗ ${client.config.error}`);
  return lines.join("\n");
}

export function renderMutationPlan(result) {
  const lines = [`Brian ${result.command} plan`, `Hosted MCP: ${result.canonicalMcpUrl}`];
  for (const client of result.clients ?? []) {
    lines.push("", client.label);
    if (client.actions.length === 0) lines.push("  • no file changes needed");
    for (const action of client.actions) lines.push(`  • ${action.action}: ${action.file}`);
    for (const warning of client.warnings) lines.push(`  ! ${warning}`);
    for (const error of client.errors) lines.push(`  ✗ ${error}`);
  }
  if (result.command === "connect" && result.clients?.some((client) => client.warnings.some((warning) => /credential/i.test(warning)))) {
    lines.push("", "Legacy credential migration will remove the live config value; the original file is retained in a timestamped backup.");
  }
  return `${lines.join("\n")}\n`;
}

function renderMutation(result) {
  const lines = [`Brian ${result.command}: ${result.status}`, `Hosted MCP: ${result.canonicalMcpUrl}`];
  for (const client of result.clients ?? []) {
    lines.push("", client.label);
    if (client.actions.length === 0) lines.push("  • no file changes needed");
    for (const action of client.actions) lines.push(`  • ${action.action}: ${action.file}`);
    for (const warning of client.warnings) lines.push(`  ! ${warning}`);
    for (const error of client.errors) lines.push(`  ✗ ${error}`);
    if (client.nextStep) lines.push(`  Next: ${client.nextStep}`);
  }
  for (const item of result.applied ?? []) {
    lines.push(``, `✓ ${item.action}: ${item.file}`);
    if (item.backup) lines.push(`  Backup: ${item.backup}`);
  }
  for (const error of result.errors ?? []) {
    const prefix = error.file ? `${error.file}: ` : error.client ? `${error.client}: ` : "";
    lines.push(`✗ ${prefix}${error.reason ?? error}`);
  }
  if (result.revocation) lines.push("", result.revocation);
  if (result.status === "confirmation-required") lines.push("Re-run with --yes to apply non-interactively.");
  return `${lines.join("\n")}\n`;
}

export function renderHuman(result) {
  if (result.command === "signup") return `${result.message}\n${result.url}\n`;
  if (result.command === "status") {
    const lines = [`Brian status: ${result.status}`, `Hosted MCP: ${result.canonicalMcpUrl}`];
    const health = result.lastHealthCheck;
    lines.push(health?.status === "unknown"
      ? "Last health check: unknown (run brian doctor)"
      : `Last health check: ${health.status} at ${health.checkedAt}`);
    for (const client of result.clients) lines.push("", renderClientStatus(client));
    return `${lines.join("\n")}\n`;
  }
  if (result.command === "doctor") {
    const lines = [`Brian doctor: ${result.status}`, `Hosted MCP: ${result.canonicalMcpUrl}`];
    for (const item of result.checks) {
      lines.push(`${icon(item.status)} ${item.name}: ${item.detail}${item.file ? ` (${item.file})` : ""}`);
    }
    return `${lines.join("\n")}\n`;
  }
  return renderMutation(result);
}

export function renderJson(result) {
  return `${JSON.stringify(result, null, 2)}\n`;
}
