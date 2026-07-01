import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findSkill, getSkill } from "../skills/repo.js";
import { businessAdapters } from "./adapters.js";
import { capture } from "../ingestion/capture.js";
import { findContextWithDistance } from "../context/repo.js";
import { logExecution } from "../feedback/executions.js";

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "brian", version: "0.1.0" });

  server.registerTool(
    "find_skill",
    {
      description: "Find the best-matching active skill for a natural-language task.",
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
      description: "Capture a work session into the brain: classify into skills/context and file each into the right place.",
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
      description: "Find the most relevant active context (goals/decisions/preferences) for a query.",
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
        "Log a skill execution to the feedback loop: what was asked, what was done, and the outcome. Call this after finishing (or escalating) a task.",
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
