import { z } from "zod";
import { getOrder, issueRefund } from "./businessTools.js";
import {
  gmailConfigFromEnv, createDraft, sendEmail,
  type GmailConfig, type EmailInput,
} from "../gmail/client.js";
import { getConnector } from "../connectors/repo.js";

export interface ToolAdapter {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export function businessAdapters(options: { tenantCredentials?: boolean } = {}): ToolAdapter[] {
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
    ...createEmailAdapters(options.tenantCredentials
      ? { config: null, configFn: tenantGmailConfig }
      : { config: gmailConfigFromEnv() }),
  ];
}

interface EmailAdapterDeps {
  config: GmailConfig | null;
  configFn?: () => Promise<GmailConfig | null>;
  createDraftFn?: (cfg: GmailConfig, input: EmailInput) => Promise<{ draft_id: string }>;
  sendEmailFn?: (cfg: GmailConfig, input: EmailInput) => Promise<{ message_id: string }>;
}

export function createEmailAdapters(deps: EmailAdapterDeps): ToolAdapter[] {
  const { config, configFn, createDraftFn = createDraft, sendEmailFn = sendEmail } = deps;
  const requireConfig = async (): Promise<GmailConfig> => {
    const resolved = configFn ? await configFn() : config;
    if (!resolved) {
      throw new Error(
        "Gmail is not configured or connected for this company"
      );
    }
    return resolved;
  };
  const emailSchema = { to: z.string(), subject: z.string(), body: z.string() };
  return [
    {
      name: "create_email_draft",
      description:
        "Create a draft email in the company Gmail. Reversible: a human reviews and sends (or deletes) the draft.",
      inputSchema: emailSchema,
      handler: async (args) => createDraftFn(await requireConfig(), args as unknown as EmailInput),
    },
    {
      name: "send_email",
      description: "Send an email from the company Gmail immediately. Irreversible.",
      inputSchema: emailSchema,
      handler: async (args) => sendEmailFn(await requireConfig(), args as unknown as EmailInput),
    },
  ];
}

async function tenantGmailConfig(): Promise<GmailConfig | null> {
  const connector = await getConnector("gmail");
  if (!connector || connector.status !== "connected") return null;
  const { client_id, client_secret, refresh_token } = connector.credentials;
  return typeof client_id === "string" && typeof client_secret === "string" && typeof refresh_token === "string"
    ? { clientId: client_id, clientSecret: client_secret, refreshToken: refresh_token }
    : null;
}
