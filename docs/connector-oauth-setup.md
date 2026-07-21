# Connector OAuth app registration

One-time registration of Brian's OAuth apps with each provider. Until a
provider's credentials are set, its card in **Sources** shows "Setup required."
After credentials are set, the card shows **Configured · unverified**.

**Configuration is not production verification.** A newly configured provider
must continue to show **Configured · unverified** until a dated production
verification record confirms its read-only scopes, resource selection, token
handling, and evidence ingestion. Authorization and a focused sync are the
verification flow; they must remain available so that record can be created.

Registered by the Brian team once — never per customer workspace.

## How it works

- Every provider redirects back to
  `https://brianthebrain.app/api/connectors/<slug>/callback` — the slug is in
  each section below (shared apps share a slug).
- Credentials are read from the Edge deployment environment as
  `<PREFIX>_CLIENT_ID` / `<PREFIX>_CLIENT_SECRET`.
- After registering an app, store its credentials with:

  ```sh
  server/scripts/set-connector-oauth.sh <PREFIX> <client_id>
  ```

  Enter the client secret at the hidden prompt. For non-interactive use, provide
  it as one protected stdin line; never put it in shell arguments or history.
  The script wraps `supabase secrets set` on project `foydcrwyakpkisxtvzgr`.

## Foundation (do first, once)

```sh
supabase secrets set --project-ref foydcrwyakpkisxtvzgr \
  BRIAN_OAUTH_BASE_URL=https://brianthebrain.app \
  CONNECTOR_ENCRYPTION_KEY=$(openssl rand -hex 32)
```

Keep a copy of the generated `CONNECTOR_ENCRYPTION_KEY` somewhere safe
(e.g. gitignored `server/.env`). Losing it makes stored connector tokens
unreadable; recovery is reconnecting each source.

## Providers

### Google — covers Gmail + Google Drive (prefix `GOOGLE`, slug `google`)
- Console: <https://console.cloud.google.com/apis/credentials> → OAuth client ID (Web application)
- Redirect URI: `https://brianthebrain.app/api/connectors/google/callback`
- Enable APIs: **Gmail API** and **Google Drive API**; configure the consent screen.
- Scopes requested at runtime: `gmail.readonly`, `drive.readonly` (add to consent screen)

### Slack (prefix `SLACK`, slug `slack`)
- Console: <https://api.slack.com/apps> → Create app
- Redirect URL: `https://brianthebrain.app/api/connectors/slack/callback`
- Bot token scopes: `channels:history`, `groups:history`, `users:read`, `users:read.email`

### Notion (prefix `NOTION`, slug `notion`)
- Console: <https://www.notion.so/my-integrations> → New integration, type **Public**
- Redirect URI: `https://brianthebrain.app/api/connectors/notion/callback`
- Capabilities: read content, read user information (no comment/insert needed)

### Atlassian — covers Confluence + Jira (prefix `ATLASSIAN`, slug `atlassian`)
- Console: <https://developer.atlassian.com/console/myapps/> → Create → OAuth 2.0 integration
- Callback URL: `https://brianthebrain.app/api/connectors/atlassian/callback`
- Add BOTH APIs with scopes:
  - Confluence: `read:confluence-content.all`, `read:confluence-space.summary`
  - Jira: `read:jira-work`, `read:jira-user`
  - Plus `read:me` and enable refresh tokens (`offline_access` is requested at runtime)

### Microsoft — covers SharePoint, OneDrive, Teams, Outlook (prefix `MICROSOFT`, slug `microsoft`)
- Console: <https://portal.azure.com> → Microsoft Entra ID → App registrations → New
- Supported account types: **Accounts in any organizational directory and personal accounts** (multitenant)
- Redirect URI (Web): `https://brianthebrain.app/api/connectors/microsoft/callback`
- API permissions (Microsoft Graph, Delegated): `User.Read`, `offline_access`,
  `Sites.Read.All`, `Files.Read.All`, `Team.ReadBasic.All`,
  `Channel.ReadBasic.All`, `ChannelMessage.Read.All`, `Mail.Read`
  (`ChannelMessage.Read.All` needs admin consent in customer tenants)
- Create a client secret under Certificates & secrets.

### Linear (prefix `LINEAR`, slug `linear`)
- Console: <https://linear.app/settings/api/applications> → New application
- Callback URL: `https://brianthebrain.app/api/connectors/linear/callback`
- Scope requested at runtime: `read`

### GitHub (prefix `GITHUB`, slug `github`)
- Console: <https://github.com/settings/developers> → OAuth Apps → New OAuth App
- Authorization callback URL: `https://brianthebrain.app/api/connectors/github/callback`
- Scopes requested at runtime: `read:user`, `read:org`

### Asana (prefix `ASANA`, slug `asana`)
- Console: <https://app.asana.com/0/my-apps> → Create new app
- Redirect URL: `https://brianthebrain.app/api/connectors/asana/callback`
- Scopes: `projects:read`, `tasks:read` only

### ClickUp (prefix `CLICKUP`, slug `clickup`)
- Console: ClickUp → Settings → **ClickUp API** → Create an app
- Redirect URL: `https://brianthebrain.app/api/connectors/clickup/callback`

### Zendesk (prefix `ZENDESK`, slug `zendesk`)
- Registered **inside a Zendesk account**: Admin Center → Apps and integrations →
  APIs → OAuth clients (global OAuth clients for multi-account require a Zendesk
  partner request; per-account works for the demo)
- Redirect URL: `https://brianthebrain.app/api/connectors/zendesk/callback`
- Scopes requested at runtime: `tickets:read`, `users:read`

### Intercom (prefix `INTERCOM`, slug `intercom`)
- Console: <https://app.intercom.com/a/apps/_/developer-hub> → New app → OAuth
- Redirect URL: `https://brianthebrain.app/api/connectors/intercom/callback`
- Permissions: read conversations, read admins/users

### HubSpot (prefix `HUBSPOT`, slug `hubspot`)
- Console: <https://developers.hubspot.com/> → developer account → Create app → Auth
- Redirect URL: `https://brianthebrain.app/api/connectors/hubspot/callback`
- Scopes: `oauth`, `crm.objects.contacts.read`, `crm.objects.companies.read`, `crm.objects.deals.read`

### Salesforce (prefix `SALESFORCE`, slug `salesforce`)
- Console: Salesforce Setup → App Manager → New Connected App (enable OAuth)
- Callback URL: `https://brianthebrain.app/api/connectors/salesforce/callback`
- Brian does not currently enable this connector: Salesforce's broad `api`
  scope cannot substantiate the Phase 0 read-only guarantee. Keep it
  **Configured · unverified** until a read-only boundary is designed and tested.

### Gong (prefix `GONG`, slug `gong`)
- Console: Gong company settings → Ecosystem → API → OAuth apps (may require
  contacting Gong to enable app creation)
- Redirect URL: `https://brianthebrain.app/api/connectors/gong/callback`
- Scopes: `api:calls:read:basic`, **`api:calls:read:transcript`** (transcripts
  power the evidence; without it Gong falls back to call titles only)

### Zoom (prefix `ZOOM`, slug `zoom`)
- Console: <https://marketplace.zoom.us/develop/create> → General app (user-managed OAuth)
- Redirect URL: `https://brianthebrain.app/api/connectors/zoom/callback`
- Scopes: user `user:read:user`, cloud recording read
  (`cloud_recording:read:list_user_recordings` + recording file download)

## After each registration

1. Run `server/scripts/set-connector-oauth.sh <PREFIX> <id>` and enter the
   client secret at the hidden prompt.
2. Reload `/app/connectors` — the card should show **Configured · unverified**.
3. Using an approved verification account, authorize the connector and run a
   focused sync to create its dated production-verification record. Keep the
   dashboard status **Configured · unverified** until that evidence is recorded.
