import type { Connector, ConnectorType } from "../types.js";
import { gmailConnector, realGmailApi } from "./gmail.js";
import { slackConnector, realSlackApi } from "./slack.js";

export { gmailThreadToRaw, gmailConnector, realGmailApi } from "./gmail.js";
export { slackThreadToRaw, slackConnector, realSlackApi } from "./slack.js";

export const CONNECTOR_TYPES: ConnectorType[] = ["gmail", "slack"];

// Build a live Connector from a connector row's stored credentials. Adding a
// source later = one adapter module + one case here. Gmail creds fall back to
// the founding tenant's GMAIL_* env for the local single-tenant setup.
export function buildConnector(type: ConnectorType, creds: Record<string, unknown> = {}): Connector {
  if (type === "gmail") {
    return gmailConnector(
      realGmailApi({
        clientId: String(creds.client_id ?? process.env.GMAIL_CLIENT_ID ?? ""),
        clientSecret: String(creds.client_secret ?? process.env.GMAIL_CLIENT_SECRET ?? ""),
        refreshToken: String(creds.refresh_token ?? process.env.GMAIL_REFRESH_TOKEN ?? ""),
      }),
    );
  }
  if (type === "slack") {
    return slackConnector(realSlackApi(String(creds.bot_token ?? "")));
  }
  throw new Error(`unknown connector type: ${type}`);
}
