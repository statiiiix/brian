import { z } from "zod";
import { getOrder, issueRefund } from "./businessTools.js";
import {
  gmailConfigFromEnv, createDraft, sendEmail,
  type GmailConfig, type EmailInput,
} from "../gmail/client.js";

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
    ...createEmailAdapters({ config: gmailConfigFromEnv() }),
  ];
}

interface EmailAdapterDeps {
  config: GmailConfig | null;
  createDraftFn?: (cfg: GmailConfig, input: EmailInput) => Promise<{ draft_id: string }>;
  sendEmailFn?: (cfg: GmailConfig, input: EmailInput) => Promise<{ message_id: string }>;
}

export function createEmailAdapters(deps: EmailAdapterDeps): ToolAdapter[] {
  const { config, createDraftFn = createDraft, sendEmailFn = sendEmail } = deps;
  const requireConfig = (): GmailConfig => {
    if (!config) {
      throw new Error(
        "Gmail is not configured: set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN in server/.env"
      );
    }
    return config;
  };
  const emailSchema = { to: z.string(), subject: z.string(), body: z.string() };
  return [
    {
      name: "create_email_draft",
      description:
        "Create a draft email in the company Gmail. Reversible: a human reviews and sends (or deletes) the draft.",
      inputSchema: emailSchema,
      handler: async (args) => createDraftFn(requireConfig(), args as unknown as EmailInput),
    },
    {
      name: "send_email",
      description: "Send an email from the company Gmail immediately. Irreversible.",
      inputSchema: emailSchema,
      handler: async (args) => sendEmailFn(requireConfig(), args as unknown as EmailInput),
    },
  ];
}
