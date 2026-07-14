# Brian — the company brain for AI agents

Brian gives AI agents company-approved judgment: executable procedures, hard rules, guardrails, durable context, escalation, and an audit trail. One multi-tenant MCP service lets each company expose only its own approved knowledge and permitted actions.

## What is in this repository

- A React dashboard for signup, login/recovery, onboarding, skill/context management, source connectors, OAuth consent, and agent-connection revocation.
- A TypeScript/Hono server and Supabase Edge bundle exposing the dashboard API and Streamable HTTP MCP.
- PostgreSQL/pgvector migrations with explicit tenant predicates and RLS backstops.
- Supabase Auth integration for human sessions and MCP OAuth 2.1 authorization.
- The publishable, zero-runtime-dependency `@brianthebrain/cli` package under `packages/cli`.

The canonical public MCP resource is:

```text
https://api.brianthebrain.app/mcp
```

OAuth-capable clients configure that URL without a static bearer. An unauthenticated request discovers Supabase OAuth, opens Brian's browser login/consent screen, and returns a short-lived tenant-bound credential to the client.

## Public connection quick start

The CLI package is implemented and pack-tested locally, but must be published before the `npx` form works from npm:

```bash
npx @brianthebrain/cli signup
npx @brianthebrain/cli connect
npx @brianthebrain/cli doctor
```

The CLI writes the canonical URL only. It does not accept `--token`, store OAuth credentials, or modify unsafe configuration. See [docs/cli.md](docs/cli.md) and the dated [client compatibility matrix](docs/mcp-client-compatibility.md).

## Local development

Requirements:

- Node.js 22 or newer;
- PostgreSQL with pgvector, using an isolated development/test database;
- a Supabase project for real browser Auth/OAuth flows;
- an OpenAI key for embedding/generative paths that exercise the LLM.

Install each workspace:

```bash
npm install
cd server && npm install
cd ../packages/cli && npm install
```

Run the frontend and API in separate terminals:

```bash
npm start
```

```bash
cd server
npm run api
```

Apply migrations only to the intended database. Database tests must use `TEST_DATABASE_URL` whose effective schema is not `public`:

```bash
cd server
node --env-file=.env ./node_modules/tsx/dist/cli.mjs src/db/migrate.ts
```

Core frontend build variables:

```text
REACT_APP_SUPABASE_URL
REACT_APP_SUPABASE_PUBLISHABLE_KEY
REACT_APP_TURNSTILE_SITE_KEY
REACT_APP_BRIAN_MCP_URL=https://api.brianthebrain.app/mcp
REACT_APP_SITE_URL
```

Core server variables:

```text
DATABASE_URL or SUPABASE_DB_URL
TEST_DATABASE_URL
SUPABASE_URL
SUPABASE_ANON_KEY
BRIAN_APP_URL
MCP_OAUTH_ENABLED
LEGACY_AGENT_TOKENS_ENABLED
MCP_RATE_LIMIT_ENABLED
MCP_PREAUTH_RATE_LIMIT_REQUESTS
MCP_AUTH_RATE_LIMIT_REQUESTS
MCP_RATE_LIMIT_WINDOW_MS
```

`MCP_DCR_ENABLED` and `MCP_OAUTH_APPROVALS_ENABLED` are non-secret,
request-time controls in the owner-only `app_config` table (migration 016), not
Edge environment variables. See [docs/mcp-oauth.md](docs/mcp-oauth.md) for the
fail-closed rollout and kill-switch procedure.

Provider connector variables are documented separately in [docs/connectors.md](docs/connectors.md).

## Verification

```bash
CI=true npm test -- --watchAll=false
npm run build

cd server
npm run build
node --env-file=.env ./node_modules/vitest/vitest.mjs run
npm run edge:build

cd ../packages/cli
npm test
npm run check
npm pack --dry-run
```

The public discovery smoke uses no credential:

```bash
cd server
npm run smoke:mcp-oauth
```

## Architecture and security

- [MCP authentication ADR](docs/architecture/mcp-auth.md)
- [Signup and company lifecycle](docs/signup.md)
- [MCP OAuth protocol and troubleshooting](docs/mcp-oauth.md)
- [Tenant isolation](docs/security/tenant-isolation.md)
- [Token handling](docs/security/token-handling.md)
- [OAuth outage runbook](docs/runbooks/oauth-outage.md)
- [Compromised connection runbook](docs/runbooks/compromised-agent-connection.md)
- [Monitoring and alerts](docs/runbooks/monitoring-alerts.md)
- [Backup and restore drill](docs/runbooks/backup-restore.md)
- [Privacy deletion and retention](docs/runbooks/privacy-deletion-and-retention.md)

## Release status

The application, migrations 010-014, CLI, privacy lifecycle, and automated local/isolation checks are implemented in this repository. Public signup and MCP OAuth are not safe to call generally available until those migrations are applied to staging/production, the runtime uses the non-owner `brian_app` role, Supabase OAuth/asymmetric signing/custom hook and CAPTCHA are configured, the branded domain is live, reviewed legal and operational controls are wired, a dated restore and security review pass, and launch clients complete real end-to-end staging compatibility runs. On 2026-07-13 the live migration list still ended at 009, Supabase OAuth discovery was disabled, and the branded API deployment returned 404. The repository records these gates rather than pretending local code changed external infrastructure.
