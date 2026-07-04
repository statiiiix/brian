import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findSkill, getSkill } from "../skills/repo.js";
import { businessAdapters } from "./adapters.js";
import { capture } from "../ingestion/capture.js";
import { findContextWithDistance } from "../context/repo.js";
import { logExecution } from "../feedback/executions.js";
import { BRIAN_INSTRUCTIONS } from "./instructions.js";

export function buildMcpServer(): McpServer {
  const server = new McpServer(
    { name: "brian", version: "0.1.0" },
    { instructions: BRIAN_INSTRUCTIONS }
  );

  server.registerTool(
    "find_skill",
    {
      description:
        "ALWAYS call this FIRST, before acting on ANY task — even when the user does not mention Brian. Returns the company-approved skill (procedure, hard rules, guardrails) that governs the task. If it returns NO_MATCHING_SKILL for a business process, ask a human instead of improvising.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      const skill = await findSkill(query);
      return {
        content: [{ type: "text", text: skill ? JSON.stringify(skill) : "NO_MATCHING_SKILL" }],
      };
    }
  );

  server.registerTool(
    "get_skill",
    { description: "Fetch a skill by id.", inputSchema: { id: z.string() } },
    async ({ id }) => {
      const skill = await getSkill(id);
      return { content: [{ type: "text", text: skill ? JSON.stringify(skill) : "NOT_FOUND" }] };
    }
  );

  for (const tool of businessAdapters()) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        const result = await tool.handler(args);
        return {
          content: [
            { type: "text" as const, text: result == null ? "NOT_FOUND" : JSON.stringify(result) },
          ],
        };
      }
    );
  }

  server.registerTool(
    "capture",
    {
      description:
        "Whenever durable knowledge appears in a conversation (a decision, preference, or process change), call this to file it into the brain: it classifies the text into skills/context and stores each piece. Do not wait to be asked.",
      inputSchema: { text: z.string() },
    },
    async ({ text }) => {
      const result = await capture(text);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );

  server.registerTool(
    "find_context",
    {
      description:
        "Call this at the start of every task, alongside find_skill. Returns the company's most relevant active goals, decisions, and preferences for the task, which override your defaults.",
      inputSchema: { query: z.string() },
    },
    async ({ query }) => {
      const hit = await findContextWithDistance(query);
      return { content: [{ type: "text", text: hit ? JSON.stringify(hit.entry) : "NO_MATCHING_CONTEXT" }] };
    }
  );

  server.registerTool(
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
      const row = await logExecution({
        skill_id, skill_version, task_input, actions_taken, outcome, human_override: null,
      });
      return { content: [{ type: "text", text: JSON.stringify(row) }] };
    }
  );

  return server;
}
