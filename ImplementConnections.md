# Implement Connections

## Goal

Connect all 19 sources shown in Brian's dashboard, read real company data with
least-privilege access, and turn supported source material into reviewable
skills and context with provenance.

Brian must never mark a connector as working merely because OAuth succeeded.
A connector is complete only after a real account connects, an incremental sync
reads permitted data, evidence is created, a draft can be reviewed, and
disconnect/revocation is verified.

## Current starting point

- Google Workspace and Slack already have the original ingestion pipeline.
- The workspace now contains uncommitted adapters for the other 17 dashboard
  sources, shared OAuth token refresh, provider setup scripts, and dashboard
  changes. Treat this work as unverified until it passes the gates below.
- All sources normalize into `RawThread`, then use the existing pipeline:
  fetch → filter → extract → embed → evidence → aggregate → review.
- Provider OAuth configuration lives in
  `server/src/connectors/oauthProviders.ts`.
- Adapter registration lives in
  `server/src/connectors/adapters/index.ts`.
- The dashboard connection surface lives in
  `src/app/views/Connectors.js`.

## Global rules

- Request read-only scopes only. Brian must not write back to a source.
- Users choose the workspace, site, repository, project, channel, folder,
  mailbox, pipeline, inbox, or call library Brian may read whenever the provider
  offers that control.
- Provider passwords, MFA codes, recovery codes, and client secrets must never
  be written to chat, documentation, terminal output, test fixtures, or git.
- Connector credentials remain encrypted with `CONNECTOR_ENCRYPTION_KEY`.
- A failed provider request must not advance the sync cursor.
- A repeated sync must not create duplicate evidence or duplicate drafts.
- Source content remains minimal: store normalized evidence, a bounded snippet,
  and a permalink—not a mirror of the external system.
- Every generated skill remains a draft until a human approves it.
- Each connector needs a dated production verification record before its
  dashboard status or documentation says it works.

## Chrome-assisted authentication and connection

Codex should control Chrome for provider setup and live connection work whenever
the provider permits it. The operator workflow for every provider is:

1. Open the provider's developer or admin console in Chrome.
2. Create or configure Brian's OAuth application.
3. Enter the exact production callback URL from
   `docs/connector-oauth-setup.md`.
4. Configure only the read scopes encoded in
   `server/src/connectors/oauthProviders.ts`.
5. Copy the generated client ID and secret directly into the protected Supabase
   runtime configuration. Do not expose the secret in chat or save it in a
   workspace file.
6. Open Brian's Sources page and start authorization.
7. Control the provider consent pages and choose the narrowest available data
   boundary.
8. Pause for the user only when the provider requires a password, MFA,
   organization-admin consent, legal acceptance, marketplace submission, or a
   security review that Codex cannot complete safely.
9. Return to Brian, confirm the connector is recorded as connected, enter a
   focused learning goal, and run the first sync.
10. Inspect evidence and its source permalink, confirm a reviewable draft can be
    produced, then test a second incremental sync.
11. Disconnect the source and verify Brian can no longer fetch new data.

Chrome control is an execution tool, not a credential store. Authentication
screens may be automated, but user secrets must remain user-entered and provider
reviews must not be bypassed.

## Connector waves

| Wave | Provider family | Dashboard connectors |
|---|---|---|
| 1 | Existing foundation | Google Workspace, Slack |
| 2 | Microsoft Graph | SharePoint, OneDrive, Microsoft Teams, Outlook |
| 3 | Knowledge and Atlassian | Notion, Confluence, Jira |
| 4 | Work systems | GitHub, Linear, Asana, ClickUp |
| 5 | Customer systems | Zendesk, Intercom, HubSpot, Salesforce, Gong |
| 6 | Meetings | Zoom |

This order finishes the known pipeline first and then reuses one provider
registration across Microsoft and Atlassian instead of repeating setup work.

## Definition of done for each connector

- [ ] OAuth application is registered with the exact production callback.
- [ ] Provider readiness returns `configured: true` without exposing secrets.
- [ ] Chrome completes a real authorization and returns to Brian.
- [ ] Stored credentials decrypt only inside the authenticated server path.
- [ ] Expiring access tokens refresh and rotated refresh tokens are preserved.
- [ ] The adapter paginates within documented limits and uses a stable cursor.
- [ ] The first sync reads only the selected source boundary.
- [ ] The second sync reads only new or changed items.
- [ ] Normalized items retain a stable ID, title, participants/owner, timestamp,
  bounded text, and permalink.
- [ ] Noise filtering does not discard valid documents, work items, CRM records,
  or transcripts because they are not conversational threads.
- [ ] Evidence is tenant-scoped, deduplicated, and linked to its source.
- [ ] A focused sync can produce a draft skill or context entry.
- [ ] The draft appears in the review queue with provenance.
- [ ] Rate limits, expired tokens, revoked access, malformed responses, and
  partial pagination fail safely without advancing the cursor.
- [ ] Disconnect prevents future syncs; provider-side revocation is tested when
  the provider exposes it.
- [ ] Unit, integration, Edge drift, and production E2E checks pass.

---

## Phase 0 — Stabilize the current connector work

**Files to inspect:**

- `server/src/connectors/adapters/sources/`
- `server/src/connectors/adapters/sources.test.ts`
- `server/src/connectors/tokenRefresh.ts`
- `server/src/connectors/tokenRefresh.test.ts`
- `server/src/connectors/adapters/index.ts`
- `server/src/connectors/sync.ts`
- `server/src/api/app.ts`
- `src/app/views/Connectors.js`
- `docs/connector-oauth-setup.md`
- `server/scripts/set-connector-oauth.sh`
- `server/scripts/set-foundation-secrets.sh`

- [ ] Separate connector changes from unrelated dashboard styling changes and
  review the exact connector diff.
- [ ] Run the focused server tests:

  ```bash
  cd server
  npx vitest run src/connectors/adapters/sources.test.ts src/connectors/tokenRefresh.test.ts src/connectors/sync.test.ts src/api/connectorsApi.test.ts
  ```

  Expected result: all focused tests pass without real provider credentials or
  external network calls.

- [ ] Run the server build:

  ```bash
  cd server
  npm run build
  ```

  Expected result: TypeScript exits successfully.

- [ ] Regenerate and verify the checked-in Edge bundle:

  ```bash
  cd server
  npm run edge:build
  git diff --exit-code -- ../supabase/functions/brian/index.js ../supabase/functions/brian/deno.json
  ```

  Expected result after staging the generated bundle: rebuilding produces no
  further artifact drift.

- [ ] Run the complete CI workflow before any live authorization. The server,
  web, database migrations, Edge drift check, and CLI matrix must all pass.

## Phase 1 — Shared ingestion safety

**Files:**

- Modify: `server/src/connectors/types.ts`
- Modify: `server/src/connectors/junkFilter.ts`
- Modify: `server/src/connectors/extract.ts`
- Modify: `server/src/connectors/sync.ts`
- Modify: `server/src/connectors/repo.ts`
- Test: `server/src/connectors/junkFilter.test.ts`
- Test: `server/src/connectors/extract.test.ts`
- Test: `server/src/connectors/sync.test.ts`

- [ ] Add failing fixtures covering four shapes: conversation, document, work
  item/CRM record, and transcript.
- [ ] Verify the existing filter fails only for the missing non-conversation
  behavior, then extend source-kind handling without weakening newsletter and
  bot filtering.
- [ ] Add a sync test where page two fails and assert the previous cursor is
  retained.
- [ ] Add a resync test proving the same external ID cannot create a second
  evidence row.
- [ ] Add an extraction test proving the learning goal narrows evidence without
  inventing unsupported rules.
- [ ] Run:

  ```bash
  cd server
  npx vitest run src/connectors/junkFilter.test.ts src/connectors/extract.test.ts src/connectors/sync.test.ts
  ```

  Expected result: all shared pipeline tests pass.

## Phase 2 — Selection boundaries in Brian

**Files:**

- Create: `server/src/db/migrations/017_connector_settings.sql`
- Modify: `server/src/connectors/types.ts`
- Modify: `server/src/connectors/repo.ts`
- Modify: `server/src/api/app.ts`
- Modify: `src/app/views/Connectors.js`
- Modify: `src/app/views/Connectors.css`
- Test: `server/src/connectors/repo.test.ts`
- Test: `server/src/api/connectorsApi.test.ts`
- Test: `src/app/views/Connectors.test.js`

- [ ] Add `settings jsonb not null default '{}'::jsonb` to `connectors` for the
  provider-specific allowlist of folders, repositories, projects, channels,
  mailboxes, pipelines, inboxes, or libraries.
- [ ] Add a tenant-scoped API to read available boundaries and save selected
  boundary IDs. Credentials must remain redacted in every response.
- [ ] Require adapters to apply saved boundary IDs during fetch. An empty
  selection must fail closed for providers where broad organization access is
  possible.
- [ ] Add the post-authorization selection step to the Sources dashboard.
- [ ] Test cross-tenant access, malformed selections, removed provider objects,
  and the empty-selection state.
- [ ] Apply migration 017 to an isolated schema and run all database-backed
  connector tests before applying it to production.

## Wave 1 — Google Workspace and Slack

**Files:**

- `server/src/connectors/adapters/gmail.ts`
- `server/src/connectors/adapters/googleDrive.ts`
- `server/src/connectors/adapters/slack.ts`
- `server/src/connectors/googleOAuth.ts`
- `server/src/connectors/slackOAuth.ts`
- `server/src/connectors/adapters.test.ts`
- `server/src/connectors/adapters/googleDrive.test.ts`

- [ ] Add complete pagination tests for Gmail History, Drive file listing, Slack
  conversations, histories, replies, and users.
- [ ] Apply Gmail label/mailbox, Drive folder, and Slack channel selections.
- [ ] Prove an expired Gmail history cursor performs a bounded recovery rather
  than silently skipping data.
- [ ] Prove Google token refresh and Slack revoked-token errors are safe and
  redacted.
- [ ] Use Chrome to configure the Google and Slack applications, connect the
  founder account, and select a deliberately small test boundary.
- [ ] Run focused syncs against one known SOP and confirm evidence, draft,
  provenance, incremental sync, disconnect, and revocation.

## Wave 2 — Microsoft Graph

**Connectors:** SharePoint, OneDrive, Microsoft Teams, Outlook.

**Files:**

- `server/src/connectors/adapters/sources/microsoft.ts`
- `server/src/connectors/adapters/sources.test.ts`
- `server/src/connectors/oauthProviders.ts`
- `server/src/connectors/tokenRefresh.ts`

- [ ] Add mocked pagination tests for sites, drives, folders, files, teams,
  channels, messages, replies, mail folders, and message conversations.
- [ ] Test Graph throttling with `Retry-After`, expired tokens, admin-consent
  denial, deleted resources, and rotated refresh tokens.
- [ ] Enforce saved site/folder/team/channel/mailbox selections in every Graph
  request.
- [ ] Use Chrome to create one multitenant Entra application with the shared
  Microsoft callback and read-only delegated permissions.
- [ ] Pause for the user when Microsoft requires organization-admin consent.
- [ ] Authorize and verify each of the four dashboard cards separately; sharing
  an OAuth app must not merge their connector rows or cursors.

## Wave 3 — Notion and Atlassian

**Connectors:** Notion, Confluence, Jira.

**Files:**

- `server/src/connectors/adapters/sources/notion.ts`
- `server/src/connectors/adapters/sources/atlassian.ts`
- `server/src/connectors/adapters/sources.test.ts`
- `server/src/connectors/oauthProviders.ts`

- [ ] Test Notion search pagination, block-child pagination, archived pages,
  database pages, rate limits, and page sharing boundaries.
- [ ] Test Atlassian accessible-resources discovery, Confluence pagination and
  page bodies, Jira issue pagination, comments, rich-text conversion, and cloud
  selection.
- [ ] Keep Confluence and Jira in separate connector rows and cursors even though
  they share one Atlassian OAuth application.
- [ ] Use Chrome to create the public Notion integration and Atlassian 3LO app,
  configure callbacks/scopes, and connect real test spaces/projects.
- [ ] Verify document-based SOPs and issue/comment-based workflows both create
  accurate evidence with working permalinks.

## Wave 4 — Work systems

**Connectors:** GitHub, Linear, Asana, ClickUp.

**Files:**

- `server/src/connectors/adapters/sources/workSystems.ts`
- `server/src/connectors/adapters/sources.test.ts`
- `server/src/connectors/oauthProviders.ts`

- [ ] Test pagination and incremental watermarks for every provider.
- [ ] Include comments, state transitions, labels/custom fields, assignees, and
  stable source URLs without storing unnecessary payloads.
- [ ] Exclude bots and system events without discarding human review decisions.
- [ ] Enforce selected repositories, teams/projects, Asana projects, and ClickUp
  spaces/lists.
- [ ] Use Chrome to register each OAuth app, connect a small real dataset, and
  verify one focused workflow per provider.
- [ ] For GitHub, record that an OAuth app cannot enforce repository selection as
  strongly as a GitHub App; do not claim repository-scoped access until Brian
  uses an installation-scoped GitHub App or equivalent provider control.

## Wave 5 — Customer systems

**Connectors:** Zendesk, Intercom, HubSpot, Salesforce, Gong.

**Files:**

- `server/src/connectors/adapters/sources/customerSystems.ts`
- `server/src/connectors/adapters/sources.test.ts`
- `server/src/connectors/oauthProviders.ts`

- [ ] Test tickets/conversations, CRM records/activities, call metadata, and
  transcript pagination using provider-shaped fixtures.
- [ ] Distinguish customers from company agents/owners so customer text alone
  cannot become a company rule.
- [ ] Require a human-supported resolution, outcome, approval, or repeated
  pattern before drafting skill evidence.
- [ ] Enforce selected groups/views, inboxes, pipelines/objects, Salesforce
  objects, and Gong libraries.
- [ ] Use Chrome to configure each provider app and connect a small non-sensitive
  dataset.
- [ ] Pause for the user when Zendesk requires partner approval, Salesforce
  requires an administrator, or Gong requires transcript/API enablement.
- [ ] Verify generated skills preserve limits, promises, exceptions, outcomes,
  and escalation evidence without exposing unnecessary customer data.

## Wave 6 — Zoom

**Files:**

- `server/src/connectors/adapters/sources/zoom.ts`
- `server/src/connectors/adapters/sources.test.ts`
- `server/src/connectors/oauthProviders.ts`

- [ ] Test user/meeting/recording pagination, VTT parsing, missing transcripts,
  deleted recordings, and rate limits.
- [ ] Enforce selected users and recording folders/libraries.
- [ ] Use Chrome to create the user-managed OAuth application and connect a test
  account containing a short non-sensitive transcript.
- [ ] Confirm Brian extracts supported decisions and procedures from the
  transcript and ignores meeting logistics.

## Final release verification

- [ ] Run the frontend suite and build:

  ```bash
  npm test -- --watchAll=false
  npm run build
  ```

- [ ] Run the server build and full isolated-database suite:

  ```bash
  cd server
  npm run build
  npm test -- --maxWorkers=1
  ```

- [ ] Rebuild the Edge artifact and confirm no drift.
- [ ] Run a production E2E row for all 19 dashboard connectors and record:
  provider, date, selected boundary, fetched count, evidence count, draft count,
  incremental result, disconnect result, and revocation result.
- [ ] Confirm the Sources dashboard distinguishes `Setup required`, `Ready to
  connect`, `Connected`, `Syncing`, `Error`, and `Revoked` without claiming data
  access before a successful fetch.
- [ ] Confirm logs and UI errors contain no access tokens, refresh tokens, client
  secrets, raw customer content, or provider diagnostic payloads.
- [ ] Update `Nextstep.md`, `docs/connectors.md`, and the compatibility/release
  documentation only after the dated production matrix passes.

## Recommended execution order

Complete one phase or provider family at a time. Each unit should follow the
same cycle:

1. Write or expose the failing test.
2. Run it and record the expected failure.
3. Make the smallest connector change.
4. Run focused tests, build, and Edge drift verification.
5. Review the diff for secret leakage and overbroad scopes.
6. Commit the unit independently.
7. Use Chrome for the provider registration and production E2E.
8. Record the dated result before moving to the next family.

The first executable unit is **Phase 0**, because the workspace already contains
uncommitted connector code that must be tested and reviewed before any provider
receives access to company data.
