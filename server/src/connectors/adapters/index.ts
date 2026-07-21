import type { AuthorizedSourceType, Connector, ConnectorType, SourceType } from "../types.js";
import { AUTHORIZED_SOURCE_TYPES } from "../types.js";
import { gmailConnector, realGmailApi } from "./gmail.js";
import { slackConnector, realSlackApi } from "./slack.js";
import { googleDriveConnector, realDriveApi } from "./googleDrive.js";
import { notionConnector } from "./sources/notion.js";
import { confluenceConnector, jiraConnector } from "./sources/atlassian.js";
import { microsoftTeamsConnector, onedriveConnector, outlookConnector, sharepointConnector } from "./sources/microsoft.js";
import { asanaConnector, clickupConnector, githubConnector, linearConnector } from "./sources/workSystems.js";
import { gongConnector, hubspotConnector, intercomConnector, salesforceConnector, zendeskConnector } from "./sources/customerSystems.js";
import { zoomConnector } from "./sources/zoom.js";

export { gmailThreadToRaw, gmailConnector, realGmailApi } from "./gmail.js";
export { slackThreadToRaw, slackConnector, realSlackApi } from "./slack.js";
export { driveFileToRaw, googleDriveConnector, realDriveApi } from "./googleDrive.js";

export const CONNECTOR_TYPES: ConnectorType[] = ["gmail", "slack", "google_drive"];

type SourceBuilder = (creds: Record<string, unknown>) => Connector;

// Every authorized OAuth source has an ingestion adapter keyed here; the
// adapters read the stored OAuth access token (refreshed by sync beforehand).
const SOURCE_BUILDERS: Record<AuthorizedSourceType, SourceBuilder> = {
  notion: notionConnector,
  confluence: confluenceConnector,
  jira: jiraConnector,
  sharepoint: sharepointConnector,
  onedrive: onedriveConnector,
  microsoft_teams: microsoftTeamsConnector,
  outlook: outlookConnector,
  linear: linearConnector,
  github: githubConnector,
  asana: asanaConnector,
  clickup: clickupConnector,
  zendesk: zendeskConnector,
  intercom: intercomConnector,
  hubspot: hubspotConnector,
  salesforce: salesforceConnector,
  gong: gongConnector,
  zoom: zoomConnector,
};

// Every source that can run the full fetch → filter → extract pipeline.
export const SYNCABLE_TYPES: SourceType[] = [...CONNECTOR_TYPES, ...AUTHORIZED_SOURCE_TYPES];

export function isSyncableType(value: string): value is SourceType {
  return (SYNCABLE_TYPES as string[]).includes(value);
}

// Build a live Connector from a connector row's stored credentials. Adding a
// source later = one adapter module + one case here. Gmail creds fall back to
// the founding tenant's GMAIL_* env for the local single-tenant setup.
export function buildConnector(type: SourceType, creds: Record<string, unknown> = {}): Connector {
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
  if (type === "google_drive") {
    return googleDriveConnector(realDriveApi({
      clientId: String(creds.client_id ?? process.env.GOOGLE_CLIENT_ID ?? process.env.GMAIL_CLIENT_ID ?? ""),
      clientSecret: String(creds.client_secret ?? process.env.GOOGLE_CLIENT_SECRET ?? process.env.GMAIL_CLIENT_SECRET ?? ""),
      refreshToken: String(creds.refresh_token ?? process.env.GOOGLE_REFRESH_TOKEN ?? process.env.GMAIL_REFRESH_TOKEN ?? ""),
    }));
  }
  const builder = SOURCE_BUILDERS[type as AuthorizedSourceType];
  if (builder) return builder(creds);
  throw new Error(`unknown connector type: ${type}`);
}
