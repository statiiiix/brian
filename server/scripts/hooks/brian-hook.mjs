#!/usr/bin/env node
// Claude Code hook for Brian. Zero dependencies; must stay runnable via bare
// `node`. Fail-silent invariant: Brian being down must never break the agent.
//
// Events:
//   SessionStart     -> inject the agent contract.
//   UserPromptSubmit -> POST the prompt to /api/agent/briefing and inject the
//                       matched skill + context.
//
// Config (env, falling back to the env file): BRIAN_URL (default
// http://localhost:3001), BRIAN_API_TOKEN, BRIAN_ENV_FILE (default server/.env).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keep in sync with docs/agent-contract.md and src/mcp/instructions.ts.
const CONTRACT = `You are connected to Brian, this company's brain. Follow this contract on every task:
1. BEFORE acting, call find_skill with the task and find_context for relevant goals/decisions/preferences — even if the user does not mention Brian. If no skill matches a business process, ask a human; do not improvise.
2. Follow the skill's procedure within its hard_rules (non-negotiable).
3. If a guardrail triggers, STOP and escalate to the skill's escalation_target.
4. Use only the tools the skill lists for business actions.
5. AFTER finishing or escalating, call log_execution.
6. Call capture when you learn something durable.`;

function loadEnvFile() {
  const file = process.env.BRIAN_ENV_FILE ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env");
  const vars = {};
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // No env file is fine; env vars may carry the config.
  }
  return vars;
}

function emit(eventName, context) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: context },
  }));
}

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const event = JSON.parse(Buffer.concat(chunks).toString("utf8"));

  if (event.hook_event_name === "SessionStart") {
    emit("SessionStart", CONTRACT);
    return;
  }
  if (event.hook_event_name !== "UserPromptSubmit") return;
  const prompt = typeof event.prompt === "string" ? event.prompt.trim() : "";
  if (!prompt) return;

  const fileEnv = loadEnvFile();
  const baseUrl = process.env.BRIAN_URL ?? fileEnv.BRIAN_URL ?? "http://localhost:3001";
  const token = process.env.BRIAN_API_TOKEN ?? fileEnv.BRIAN_API_TOKEN ?? "";

  const res = await fetch(`${baseUrl}/api/agent/briefing`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query: prompt }),
    // Cold-start embedding calls can take >2.5s; unreachable hosts still fail
    // fast, so a generous timeout only costs time when Brian is up but slow.
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return;
  const { skill, context } = await res.json();
  if (!skill && !context) return;

  const parts = ["<brian-briefing>", "Brian (company brain) matched this prompt:"];
  if (skill) {
    parts.push(`SKILL (follow its procedure; hard_rules and guardrails are non-negotiable):\n${JSON.stringify(skill)}`);
  }
  if (context) {
    parts.push(`CONTEXT (company goals/decisions/preferences that override defaults):\n${JSON.stringify(context)}`);
  }
  parts.push(
    "After finishing or escalating, call log_execution. If the skill does not fit the task, call find_skill yourself before improvising.",
    "</brian-briefing>"
  );
  emit("UserPromptSubmit", parts.join("\n"));
}

main().catch(() => {
  // Fail-silent: never surface Brian errors into the user's session.
});
