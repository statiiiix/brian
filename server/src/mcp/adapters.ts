import { z } from "zod";
import { getOrder, issueRefund } from "./businessTools.js";

export interface ToolAdapter {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export function businessAdapters(): ToolAdapter[] {
  return [
    {
      name: "get_order",
      description: "Look up an order by id.",
      inputSchema: { order_id: z.string() },
      handler: ({ order_id }) => getOrder(order_id as string),
    },
    {
      name: "issue_refund",
      description: "Issue a refund for an order.",
      inputSchema: { order_id: z.string(), amount: z.number() },
      handler: ({ order_id, amount }) => issueRefund(order_id as string, amount as number),
    },
  ];
}
