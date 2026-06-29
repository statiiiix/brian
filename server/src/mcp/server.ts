import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findSkill, getSkill } from "../skills/repo.js";
import { getOrder, issueRefund } from "./businessTools.js";

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

  server.registerTool(
    "get_order",
    { description: "Look up an order by id.", inputSchema: { order_id: z.string() } },
    async ({ order_id }) => {
      const order = getOrder(order_id);
      return { content: [{ type: "text", text: order ? JSON.stringify(order) : "NOT_FOUND" }] };
    }
  );

  server.registerTool(
    "issue_refund",
    {
      description: "Issue a refund for an order.",
      inputSchema: { order_id: z.string(), amount: z.number() },
    },
    async ({ order_id, amount }) => {
      return { content: [{ type: "text", text: JSON.stringify(issueRefund(order_id, amount)) }] };
    }
  );

  return server;
}
