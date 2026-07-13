import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findSkill, getSkill } from "../skills/repo.js";
import { businessAdapters } from "./adapters.js";
import { capture } from "../ingestion/capture.js";
import { findContextWithDistance } from "../context/repo.js";
import { logExecution } from "../feedback/executions.js";
import { BRIAN_INSTRUCTIONS } from "./instructions.js";
import { FOUNDING_TENANT_ID } from "../db/tenant.js";
import type { AuthPrincipal, SystemPrincipal } from "../auth/principal.js";
import {
  AGENT_PERMISSIONS,
  hasPermission,
  requiredPermissionForTool,
  type AgentPermission,
} from "../auth/permissions.js";
import { markFirstMcpCall, writeAuditEvent } from "../identity/repo.js";

const SYSTEM_PRINCIPAL: SystemPrincipal = {
  kind: "system",
  tenantId: FOUNDING_TENANT_ID,
  userId: null,
  clientId: null,
  connectionId: null,
  role: "owner",
  permissions: [...AGENT_PERMISSIONS],
};

function requirePermission(principal: AuthPrincipal, permission: AgentPermission): void {
  if (!hasPermission(principal.permissions, permission)) {
    throw new Error(`insufficient permission: ${permission}`);
  }
}

export function buildMcpServer(principal: AuthPrincipal = SYSTEM_PRINCIPAL): McpServer {
  const server = new McpServer(
    { name: "brian", version: "0.1.0" },
    { instructions: BRIAN_INSTRUCTIONS }
  );

  if (hasPermission(principal.permissions, "skills:read")) server.registerTool(
    "find_skill",
    {
      description:
        "ALWAYS call this FIRST, before acting on ANY task — even when the user does not mention Brian. Returns the company-approved skill (procedure, hard rules, guardrails) that governs the task. If it returns NO_MATCHING_SKILL for a business process, ask a human instead of improvising.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      requirePermission(principal, "skills:read");
      await markFirstMcpCall();
      const skill = await findSkill(query);
      return {
        content: [{ type: "text", text: skill ? JSON.stringify(skill) : "NO_MATCHING_SKILL" }],
      };
    }
  );

  if (hasPermission(principal.permissions, "skills:read")) server.registerTool(
    "get_skill",
    { description: "Fetch a skill by id.", inputSchema: { id: z.string() } },
    async ({ id }) => {
      requirePermission(principal, "skills:read");
      const skill = await getSkill(id);
      return { content: [{ type: "text", text: skill ? JSON.stringify(skill) : "NOT_FOUND" }] };
    }
  );

  for (const tool of businessAdapters({ tenantCredentials: principal.kind !== "system" })) {
    const permission = requiredPermissionForTool(tool.name);
    if (!hasPermission(principal.permissions, permission)) continue;
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        requirePermission(principal, permission);
        const result = await tool.handler(args);
        return {
          content: [
            { type: "text" as const, text: result == null ? "NOT_FOUND" : JSON.stringify(result) },
          ],
        };
      }
    );
  }

  if (hasPermission(principal.permissions, "knowledge:write")) server.registerTool(
    "capture",
    {
      description:
        "Whenever durable knowledge appears in a conversation (a decision, preference, or process change), call this to file it into the brain: it classifies the text into skills/context and stores each piece. Do not wait to be asked.",
      inputSchema: { text: z.string() },
    },
    async ({ text }) => {
      requirePermission(principal, "knowledge:write");
      const result = await capture(text);
      await writeAuditEvent("mcp.knowledge_captured", {
        targetType: "capture",
        metadata: { itemCount: result.items.length, kinds: result.items.map((item) => item.kind) },
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  if (hasPermission(principal.permissions, "context:read")) server.registerTool(
    "find_context",
    {
      description:
        "Call this at the start of every task, alongside find_skill. Returns the company's most relevant active goals, decisions, and preferences for the task, which override your defaults.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      requirePermission(principal, "context:read");
      const hit = await findContextWithDistance(query);
      return { content: [{ type: "text", text: hit ? JSON.stringify(hit.entry) : "NO_MATCHING_CONTEXT" }] };
    }
  );

  if (hasPermission(principal.permissions, "executions:write")) server.registerTool(
    "log_execution",
    {
      description:
        "REQUIRED after every task that used a skill (finished, escalated, or failed): log what was asked, what you did, and the outcome. This is Brian's feedback loop; skipping it blinds the company.",
      inputSchema: {
        skill_id: z.string().nullable(),
        skill_version: z.number().nullable(),
        task_input: z.string(),
        actions_taken: z.string(),
        outcome: z.enum(["completed", "escalated", "failed"]),
      },
    },
    async ({ skill_id, skill_version, task_input, actions_taken, outcome }) => {
      requirePermission(principal, "executions:write");
      const row = await logExecution({
        skill_id, skill_version, task_input, actions_taken, outcome, human_override: null,
      });
      return { content: [{ type: "text", text: JSON.stringify(row) }] };
    }
  );

  return server;
}
