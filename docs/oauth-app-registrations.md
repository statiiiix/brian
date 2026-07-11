# OAuth app registrations for Brian

Brian is the OAuth client. These registrations are company infrastructure,
created once by the Brian team and reused by every customer tenant. A customer
only clicks **Authorize**, signs in to the source, approves access, and returns
to Brian. Customers never see or enter a client ID or client secret.

## Production flow

1. Brian creates a one-time, tenant-bound OAuth state.
2. The browser goes to the provider's own consent screen.
3. The provider sends the authorization code to Brian's Edge callback.
4. Brian exchanges the code server-side and stores the tenant's token encrypted.
5. The browser returns to `BRIAN_APP_URL/app/connectors` with a connected status.

Authorization and ingestion are separate. Completing this flow records a safe,
tenant-owned connection. The provider-specific ingestion adapter can be added
afterward without asking the customer to authorize a second time, provided the
original scopes cover the data being read.

## Shared deployment values

```text
BRIAN_OAUTH_BASE_URL=https://foydcrwyakpkisxtvzgr.supabase.co/functions/v1/brian
BRIAN_APP_URL=https://<the-production-Brian-domain>
CONNECTOR_ENCRYPTION_KEY=<64 random hexadecimal characters>
```

The current development frontend can use `BRIAN_APP_URL=http://localhost:3000`.
The production value must be updated before external users are invited.

## Provider registrations

All callback URLs are under `BRIAN_OAUTH_BASE_URL`:

| Registration owned by Brian | Sources covered | Callback URL | Runtime keys |
|---|---|---|---|
| Google Cloud OAuth client | Google Workspace | `/api/connectors/google/callback` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Slack app | Slack | `/api/connectors/slack/callback` | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` |
| Notion public integration | Notion | `/api/connectors/notion/callback` | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET` |
| Atlassian OAuth 2.0 (3LO) app | Jira, Confluence | `/api/connectors/atlassian/callback` | `ATLASSIAN_CLIENT_ID`, `ATLASSIAN_CLIENT_SECRET` |
| Microsoft Entra multitenant app | SharePoint, OneDrive, Teams, Outlook | `/api/connectors/microsoft/callback` | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` |
| Linear OAuth app | Linear | `/api/connectors/linear/callback` | `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` |
| GitHub OAuth app | GitHub | `/api/connectors/github/callback` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Asana OAuth app | Asana | `/api/connectors/asana/callback` | `ASANA_CLIENT_ID`, `ASANA_CLIENT_SECRET` |
| ClickUp OAuth app | ClickUp | `/api/connectors/clickup/callback` | `CLICKUP_CLIENT_ID`, `CLICKUP_CLIENT_SECRET` |
| Zendesk global OAuth client | Zendesk | `/api/connectors/zendesk/callback` | `ZENDESK_CLIENT_ID`, `ZENDESK_CLIENT_SECRET` |
| Intercom OAuth app | Intercom | `/api/connectors/intercom/callback` | `INTERCOM_CLIENT_ID`, `INTERCOM_CLIENT_SECRET` |
| HubSpot public app | HubSpot | `/api/connectors/hubspot/callback` | `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` |
| Salesforce connected app | Salesforce | `/api/connectors/salesforce/callback` | `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET` |
| Gong app | Gong | `/api/connectors/gong/callback` | `GONG_CLIENT_ID`, `GONG_CLIENT_SECRET` |
| Zoom OAuth app | Zoom | `/api/connectors/zoom/callback` | `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` |

Use the full callback URL when registering, for example:

```text
https://foydcrwyakpkisxtvzgr.supabase.co/functions/v1/brian/api/connectors/google/callback
```

`*_OAUTH_REDIRECT_URI` remains available as an explicit per-provider override,
and `*_OAUTH_SCOPES` can override the default read-only scopes when a provider
review requires a narrower set.

## Launch requirements

- Publish each app for external/multitenant installation. A development-only or
  single-workspace app will work for the founder but fail for customers.
- Complete provider verification or marketplace review where required. Google
  Workspace Gmail access, Slack distribution, Microsoft admin-consent scopes,
  Zendesk global OAuth, Gong, and similar enterprise sources can require review.
- Put client secrets only in the owner-only `app_config` table or the Edge
  runtime secret store; never ship them in React or return them from an API.
- Set `CONNECTOR_ENCRYPTION_KEY` before the first customer connects. Rotating or
  losing it without a migration makes existing encrypted tokens unreadable.
- Test both a normal member and an organization admin. Some sources require an
  admin to consent even though Brian requests read-only access.

## Current boundary

The repository can perform and persist authorization for every source in the
catalog. Only Google Workspace and Slack currently have ingestion adapters.
That is deliberate: connection setup comes first, then Brian's source-specific
selection, sync, normalization, and learning behavior.
