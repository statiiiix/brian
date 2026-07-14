# Guarded Universal MCP Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an existing or invited Brian user connect any standards-compatible remote MCP client with only `https://api.brianthebrain.app/mcp`, while preserving explicit tenant consent, conservative permissions, immediate revocation, and guarded Dynamic Client Registration (DCR).

**Architecture:** Supabase remains Brian's OAuth 2.1 authorization server and owns DCR, PKCE, codes, access tokens, and rotating refresh tokens. Brian publishes fail-closed availability markers, validates every selected permission and current tenant grant, and runs a server-only registry audit/cleanup job. The credential-free CLI writes URL-only client configuration first, then invokes only verified native login command arrays in an interactive TTY. Production DCR is enabled only after audit, cleanup, alert, real-client refresh, and revocation evidence pass.

**Tech Stack:** React 19 / Create React App, Hono, TypeScript 5.9, Vitest, PostgreSQL 17, Supabase Auth and `@supabase/supabase-js` 2.110.2, Node.js ESM CLI, Node test runner, GitHub Actions, Supabase Edge Functions.

## Global Constraints

- Preserve public signup as an independent feature and leave `PUBLIC_SIGNUP_ENABLED=false` throughout this milestone.
- Never store, print, proxy, or test with captured OAuth codes, access tokens, refresh tokens, client secrets, state, or PKCE verifiers.
- Treat DCR registration as untrusted metadata, not authorization. No MCP data access exists until Brian prepares a tenant grant and Supabase activates it.
- Keep `MCP_DCR_ENABLED`, `MCP_OAUTH_APPROVALS_ENABLED`, `MCP_OAUTH_ENABLED`, and the provider-side DCR switch independent.
- Use the supported Supabase OAuth Admin methods `auth.admin.oauth.listClients()` and `deleteClient()`; never delete from `auth.oauth_clients` directly.
- Every cleanup ambiguity retains the client. The cleanup path stops after a provider deletion failure.
- Keep public CLI configuration credential-free and canonical-URL-only. Execute native login with `execFile`/argument arrays, never a shell string.
- Apply test-driven development to every behavior change. Configuration-only workflow steps still require deterministic validation.
- Preserve unrelated worktree changes, especially the existing root `package-lock.json` edit.
- Do not publish the CLI, enable public signup, or make a universal-connect marketing claim until Task 10's external evidence gates pass.

---

### Task 1: Publish independent OAuth availability markers

**Files:**

- Modify: `server/src/api/app.ts`
- Modify: `server/src/api/authLoginConfig.test.ts`
- Modify: `packages/cli/src/doctor/network.mjs`
- Modify: `packages/cli/test/doctor.test.mjs`

- [x] **Step 1: Add failing API tests for the public marker contract**

Change the public-config test to require a fixed, boolean-only shape:

```ts
expect(off.json()).toEqual({
  publicSignup: false,
  mcpOAuth: true,
  mcpOAuthApprovals: false,
  mcpDcr: false,
});

expect(on.json()).toEqual({
  publicSignup: true,
  mcpOAuth: true,
  mcpOAuthApprovals: true,
  mcpDcr: true,
});
```

Construct the enabled app with all four explicit options. Add a case proving that DCR may be true while approvals are false and OAuth token validation remains true.

- [x] **Step 2: Run the focused server test and observe the expected failure**

Run:

```bash
cd server && npm test -- src/api/authLoginConfig.test.ts
```

Expected: failure because `/api/public/config` currently returns only `publicSignup`.

- [x] **Step 3: Implement the minimal public marker response**

Replace the response with:

```ts
app.get("/api/public/config", (c) => c.json({
  publicSignup: publicSignupEnabled,
  mcpOAuth: mcpOAuthEnabled,
  mcpOAuthApprovals: mcpOAuthApprovalsEnabled,
  mcpDcr: mcpDcrEnabled,
}));
```

Do not expose Supabase URLs, keys, client IDs, tenant values, or environment diagnostics.

- [x] **Step 4: Add failing doctor fixtures for registration discovery and public markers**

Extend `goodFetch` so authorization metadata includes:

```js
registration_endpoint: "http://auth.test/oauth/clients/register",
```

and `/api/public/config` returns:

```js
{
  publicSignup: false,
  mcpOAuth: true,
  mcpOAuthApprovals: true,
  mcpDcr: true,
}
```

Require separate checks named `dynamic-client-registration-advertised` and `brian-oauth-availability`. Add mismatch cases for missing `registration_endpoint` and `mcpDcr: false`; the former is a failure, while the latter is a warning that registrations are paused.

- [x] **Step 5: Run the focused CLI test and observe the expected failure**

Run:

```bash
cd packages/cli && node --test test/doctor.test.mjs
```

Expected: new checks are absent.

- [x] **Step 6: Implement doctor validation without registering a client**

In `runNetworkDoctor`, retain the authorization document and validate that `registration_endpoint` is a valid HTTPS endpoint (or HTTP only under `allowHttp`). Fetch `${new URL(resourceUrl).origin}/api/public/config` without an Authorization header and validate the exact four booleans. Emit:

```js
check(
  "dynamic-client-registration-advertised",
  registrationValid,
  registrationValid ? "authorization server advertises DCR; no client was created" : "registration endpoint is missing or invalid",
)
```

Return a `warn` status for a valid public marker response with `mcpDcr === false` or `mcpOAuthApprovals === false`; extend `check` to accept an explicit status rather than converting every non-pass to `fail`.

- [x] **Step 7: Re-run focused tests and commit**

Run:

```bash
cd server && npm test -- src/api/authLoginConfig.test.ts
cd ../packages/cli && node --test test/doctor.test.mjs
```

Expected: both pass.

Commit:

```bash
git add server/src/api/app.ts server/src/api/authLoginConfig.test.ts packages/cli/src/doctor/network.mjs packages/cli/test/doctor.test.mjs
git commit -m "feat: publish guarded MCP OAuth availability"
```

---

### Task 2: Make Brian permission selection explicit and server-authoritative

**Files:**

- Modify: `server/src/auth/permissions.ts`
- Add: `server/src/auth/permissions.test.ts`
- Modify: `server/src/api/app.ts`
- Modify: `server/src/api/identityApi.test.ts`
- Add: `server/src/api/oauthGrantPolicy.test.ts`
- Modify: `src/app/permissions.js`
- Modify: `src/pages/OAuthConsent.js`
- Modify: `src/pages/OAuthConsent.css`
- Modify: `src/pages/AuthPages.test.js`

- [x] **Step 1: Add failing unit tests for selected-permission policy**

Define tests for a new function with this signature:

```ts
export function validateSelectedAgentPermissions(
  value: unknown,
  role: HumanRole,
): { ok: true; permissions: AgentPermission[] } | { ok: false; reason: string };
```

The tests must prove:

```ts
validateSelectedAgentPermissions(DEFAULT_AGENT_PERMISSIONS, "expert")
// => ok, exact defaults

validateSelectedAgentPermissions([...DEFAULT_AGENT_PERMISSIONS, "knowledge:write"], "expert")
// => ok

validateSelectedAgentPermissions([...DEFAULT_AGENT_PERMISSIONS, "actions:execute"], "expert")
// => error

validateSelectedAgentPermissions(["skills:read"], "admin")
// => error because defaults are mandatory

validateSelectedAgentPermissions([...DEFAULT_AGENT_PERMISSIONS, "unknown"], "owner")
// => error, never silently filter
```

- [x] **Step 2: Run the permission test and observe the import failure**

Run:

```bash
cd server && npm test -- src/auth/permissions.test.ts
```

Expected: the function does not exist.

- [x] **Step 3: Implement closed permission validation**

Keep output order equal to `AGENT_PERMISSIONS`, reject duplicates and unknown strings, require every `DEFAULT_AGENT_PERMISSIONS` member, and reject `actions:execute` unless role is `owner` or `admin`. Do not derive optional Brian permissions from the OAuth identity scope.

- [x] **Step 4: Add failing identity API tests**

Change the attack-body test: an unknown permission must now return `400`, not be ignored. Add cases proving:

- missing `permissions` returns `400`;
- exact defaults prepare successfully;
- defaults plus `knowledge:write` prepare successfully for an expert;
- defaults plus `actions:execute` prepare successfully for admin/owner;
- expert plus `actions:execute` returns `403`;
- omitted defaults, unknown values, duplicates, and non-arrays return `400`;
- Supabase-verified client ID/name/URI/redirect still override every browser-supplied metadata field.

- [x] **Step 5: Run the identity API tests and observe policy failures**

Run:

```bash
cd server && npm test -- src/api/identityApi.test.ts --maxWorkers=1
```

Expected: current endpoint ignores the browser permission field and derives permissions from OAuth scope.

- [x] **Step 6: Enforce selected permissions in `/api/oauth/grants/prepare`**

Replace `permissionsForOAuthScope(details.scope)` in this endpoint with `validateSelectedAgentPermissions(body.permissions, selected.role)`. Return fixed errors only:

```ts
if (!validated.ok) {
  const status = validated.reason === "actions:execute requires an owner or admin" ? 403 : 400;
  return c.json({ error: validated.reason }, status);
}
```

Pass `validated.permissions` to `prepareAgentConnection`. Keep `permissionsForOAuthScope` for token/request compatibility where it is still needed; do not globally redefine OAuth scope semantics.

- [x] **Step 7: Add failing React consent tests**

Tests must require:

- the three defaults displayed as required;
- `Capture knowledge` is an unchecked checkbox;
- `Act through connected tools` is an unchecked checkbox for owner/admin and absent for expert/viewer;
- clicking optional permissions sends the exact ordered `permissions` array in `prepareGrant`;
- unchecked approval sends exactly the defaults;
- client name and URI render only as text, including a `<script>`-shaped fixture;
- the exact redirect hostname and port are shown;
- a loopback redirect shows `This agent will return through a local callback on this device.`;
- an HTTPS remote callback does not show the loopback warning.

- [x] **Step 8: Run the focused React tests and observe failures**

Run:

```bash
CI=true npm test -- --watchAll=false src/pages/AuthPages.test.js
```

Expected: optional controls, request permissions, and loopback warning are missing.

- [x] **Step 9: Implement consent state and safe redirect display**

Add:

```js
const [optionalPermissions, setOptionalPermissions] = useState([]);
const permissions = useMemo(
  () => [...DEFAULT_AGENT_PERMISSIONS, ...optionalPermissions],
  [optionalPermissions]
);
```

Export `DEFAULT_AGENT_PERMISSIONS` from `src/app/permissions.js`. Render optional controls from a fixed Brian-owned array; never from client metadata. Send:

```js
body: {
  authorizationId,
  tenantId: selectedTenantId,
  permissions,
}
```

Replace `redirectOrigin` with a helper returning `{ label, hostname, loopback }`. Treat `localhost`, `127.0.0.1`, and `[::1]` as loopback. Show the exact `host` value (hostname plus port), while keeping all values in React text nodes.

- [x] **Step 10: Run all focused tests and commit**

Run:

```bash
cd server && npm test -- src/auth/permissions.test.ts src/api/identityApi.test.ts --maxWorkers=1
cd .. && CI=true npm test -- --watchAll=false src/pages/AuthPages.test.js
```

Expected: pass.

Commit:

```bash
git add server/src/auth/permissions.ts server/src/auth/permissions.test.ts server/src/api/app.ts server/src/api/identityApi.test.ts src/app/permissions.js src/pages/OAuthConsent.js src/pages/OAuthConsent.css src/pages/AuthPages.test.js
git commit -m "feat: add explicit MCP permission consent"
```

---

### Task 3: Add safe native-login capability adapters

**Files:**

- Modify: `packages/cli/src/runtime.mjs`
- Add: `packages/cli/src/login/native.mjs`
- Add: `packages/cli/test/native-login.test.mjs`
- Add: `packages/cli/test/runtime.test.mjs`
- Modify: `packages/cli/src/platforms/shared.mjs`
- Modify: `packages/cli/src/platforms/claudeCode.mjs`
- Modify: `packages/cli/src/platforms/codex.mjs`
- Modify: `packages/cli/src/platforms/cursor.mjs`
- Modify: `packages/cli/src/platforms/claudeDesktop.mjs`
- Modify: `packages/cli/test/platforms.test.mjs`

- [x] **Step 1: Add failing native-login policy tests**

Define the adapter result:

```js
{
  kind: "command" | "manual" | "unavailable",
  executable: "codex" | "claude" | null,
  args: ["mcp", "login", "brian"],
  retryCommand: "codex mcp login brian",
  instruction: string,
}
```

Tests must prove Codex always returns the fixed command when detected; Claude returns it only when `runtime.commandSupports("claude", ["mcp", "login", "--help"])` succeeds; Cursor and Claude Desktop return manual UI instructions; no client/config value enters `executable` or `args`.

- [x] **Step 2: Run tests and observe the missing module**

Run:

```bash
cd packages/cli && node --test test/native-login.test.mjs test/platforms.test.mjs
```

Expected: native-login policy is absent.

- [x] **Step 3: Extend the runtime with injectable command probes and execution**

Add runtime methods with fixed-array calling conventions:

```js
runtime.commandSupports = overrides.commandSupports ?? defaultCommandSupports;
runtime.runInteractiveCommand = overrides.runInteractiveCommand ?? defaultRunInteractiveCommand;
runtime.isInteractive = overrides.isInteractive ?? Boolean(overrides.stdin?.isTTY ?? process.stdin.isTTY);
```

Implement `defaultCommandSupports(executable, args)` with `execFileSync(executable, args, { stdio: "ignore", timeout: 2000 })`. Implement native execution with `spawnSync(executable, args, { stdio: "inherit", shell: false, env })`. Return only `{ status, exitCode }`; never include stdout/stderr.

- [x] **Step 4: Add `loginPlan(runtime)` to every platform**

Use exact command arrays:

```js
codex: ["mcp", "login", "brian"]
claude-code: ["mcp", "login", "brian"]
```

Cursor instruction: `Restart Cursor, open MCP settings, select Brian, and choose Connect.`

Claude Desktop instruction: `Restart Claude Desktop, open Brian in Connectors, and choose Connect.`

For an older Claude command surface, return: `Upgrade Claude Code or run the Brian connection from Claude's MCP settings.`

- [x] **Step 5: Re-run tests and commit**

Run:

```bash
cd packages/cli && node --test test/native-login.test.mjs test/platforms.test.mjs
```

Expected: pass.

Commit:

```bash
git add packages/cli/src/runtime.mjs packages/cli/src/login/native.mjs packages/cli/src/platforms packages/cli/test/native-login.test.mjs packages/cli/test/platforms.test.mjs
git commit -m "feat: model native MCP login capabilities"
```

---

### Task 4: Orchestrate authentication only after successful CLI writes

**Files:**

- Modify: `packages/cli/src/args.mjs`
- Modify: `packages/cli/src/index.mjs`
- Modify: `packages/cli/src/commands/clients.mjs`
- Modify: `packages/cli/src/output.mjs`
- Modify: `packages/cli/test/cli.test.mjs`
- Modify: `packages/cli/test/platforms.test.mjs`

- [x] **Step 1: Add failing parser and orchestration tests**

Add `--no-login` to connect only. Require:

- status, doctor, disconnect, and signup reject `--no-login`;
- `--json`, `--dry-run`, non-TTY, and `--no-login` make zero `runInteractiveCommand` calls;
- `--yes` with a TTY may still offer login because it approves file writes only;
- no login runs when preflight, confirmation, or apply fails;
- an unchanged canonical config may still offer login;
- selected native clients run sequentially in `platforms` order;
- a failed native command leaves the written file intact and returns `configured: true`, `authenticated: false`, plus the fixed retry command;
- manual clients report `configured: true`, `authentication: "manual"`;
- the result contains no child stdout/stderr or token-shaped fixture.

- [x] **Step 2: Run tests and observe failures**

Run:

```bash
cd packages/cli && node --test test/cli.test.mjs test/platforms.test.mjs
```

Expected: parser rejects `--no-login` and connect never invokes login.

- [x] **Step 3: Parse and document `--no-login`**

Initialize:

```js
const options = { only: null, dryRun: false, yes: false, json: false, noLogin: false };
```

Add `--no-login` to help and accept it only for `connect`.

- [x] **Step 4: Separate configuration outcome from authentication outcome**

After `applyChanges` succeeds—or when the config is already unchanged—build a login queue from detected platform `loginPlan` values. Skip execution when:

```js
const suppressLogin = options.json || options.dryRun || options.noLogin || !runtime.isInteractive;
```

Use a new `runtime.confirmLogin({ name, label, retryCommand })` prompt with default yes. A blank answer means yes; `n`/`no` skips. Execute one command at a time and append only categorical records:

```js
{
  client: plan.name,
  configured: true,
  authentication: "authenticated" | "failed" | "skipped" | "manual",
  retryCommand: plan.retryCommand,
  instruction: plan.instruction,
}
```

Do not rollback file writes on login failure. Keep the command exit code out of machine output unless it is an ordinary bounded integer.

- [x] **Step 5: Render the two-stage result clearly**

Human output must lead with `Configuration installed` and then print each authentication state. JSON preserves the stable `authentication` array and never prompts or spawns.

- [x] **Step 6: Run the CLI suite and commit**

Run:

```bash
cd packages/cli && npm test && npm run check && npm pack --dry-run
```

Expected: pass; packed file list contains source/README only and no credential file.

Commit:

```bash
git add packages/cli/src packages/cli/test packages/cli/README.md
git commit -m "feat: authenticate Brian after CLI configuration"
```

---

### Task 5: Make doctor report configuration and login readiness without claiming proof

**Files:**

- Modify: `packages/cli/src/commands/doctor.mjs`
- Modify: `packages/cli/src/output.mjs`
- Modify: `packages/cli/test/doctor.test.mjs`
- Modify: `docs/cli.md`

- [x] **Step 1: Add failing readiness/evidence tests**

Require a `native-login` check for each detected client and these categorical OAuth evidence states:

```text
advertised     public DCR metadata and Brian markers pass
ready          local config plus verified native command or documented UI exists
proven         never emitted by doctor
```

Tests must assert `JSON.stringify(result)` never contains `proven`, and an older Claude version yields a warning with its upgrade instruction.

- [x] **Step 2: Run focused tests and observe failure**

Run:

```bash
cd packages/cli && node --test test/doctor.test.mjs
```

- [x] **Step 3: Implement local login readiness checks**

Call each platform's `loginPlan(runtime)` and emit pass for a command or actionable UI, warn for an unavailable old command surface. Add top-level:

```js
oauthEvidence: {
  registration: networkDcrPass ? "advertised" : "unavailable",
  localClient: localReady ? "ready" : "not-ready",
}
```

Do not execute DCR, native login, browser opening, or an authenticated request.

- [x] **Step 4: Document evidence labels and commit**

Run:

```bash
cd packages/cli && npm test
```

Commit:

```bash
git add packages/cli/src/commands/doctor.mjs packages/cli/src/output.mjs packages/cli/test/doctor.test.mjs docs/cli.md
git commit -m "feat: diagnose MCP registration and login readiness"
```

---

### Task 6: Build a credential-redacting DCR registry audit and fail-closed cleanup

**Files:**

- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Add: `server/src/operations/dcrRegistry.ts`
- Add: `server/src/operations/dcrRegistry.test.ts`
- Add: `server/src/operations/dcrMaintenanceCli.ts`
- Add: `server/src/operations/dcrMaintenanceCli.test.ts`

- [x] **Step 1: Pin the supported Supabase server SDK**

Add `@supabase/supabase-js` version `2.110.2` to `server/package.json` and regenerate only `server/package-lock.json`:

```bash
cd server && npm install --save-exact @supabase/supabase-js@2.110.2
```

Verify the installed type exposes `auth.admin.oauth.listClients` and `deleteClient`.

- [x] **Step 2: Add failing domain tests for registry classification**

Define narrow internal types:

```ts
export interface RegistryClient {
  clientId: string;
  registrationType: "dynamic" | "manual";
  createdAt: Date;
}

export interface ClientLifecycleEvidence {
  brianOpenConnections: Set<string>;
  supabaseActiveAuthorizations: Set<string>;
  evidenceComplete: boolean;
}
```

Test `classifyRegistry` at a fixed clock. A stale candidate must be dynamic, older than 24 hours, absent from both sets, absent from `protectedClientIds`, and have `evidenceComplete === true`. Test every predicate independently and assert ambiguity produces `retained_evidence_incomplete`.

- [x] **Step 3: Add failing redaction and stop-on-error tests**

Require output to contain only:

```ts
export interface DcrAuditSummary {
  runId: string;
  mode: "audit" | "cleanup";
  dynamicTotal: number;
  createdLast10Minutes: number;
  createdLast24Hours: number;
  withBrianConnection: number;
  staleEligible: number;
  deleted: number;
  retained: number;
  failed: number;
  markerDrift: boolean | null;
}
```

Deletion records may include only `{ clientIdHash, ageBucket, outcome, runId }`. Feed token/client-name/URI/redirect fixtures and assert none appear in JSON. Make the second deletion fail and prove the third is never attempted.

- [x] **Step 4: Run tests and observe missing implementation**

Run:

```bash
cd server && npm test -- src/operations/dcrRegistry.test.ts src/operations/dcrMaintenanceCli.test.ts
```

- [x] **Step 5: Implement the Supabase OAuth Admin adapter**

Create the admin client server-side:

```ts
const supabase = createClient(supabaseUrl, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
```

Paginate `supabase.auth.admin.oauth.listClients({ page, perPage: 100 })` until `nextPage` is null. Map only `client_id`, `registration_type`, and `created_at`; discard every other field immediately. Delete only through `supabase.auth.admin.oauth.deleteClient(clientId)`. Convert provider errors to fixed categories without including upstream messages.

- [x] **Step 6: Implement read-only lifecycle evidence with schema attestation**

Connect a dedicated `pg.Pool` to `DCR_MAINTENANCE_DATABASE_URL` with `application_name=brian_dcr_audit`, `statement_timeout=10000`, and `default_transaction_read_only=on`. At startup, query `information_schema.columns` for:

```text
public.agent_connections: oauth_client_id, status
auth.sessions: oauth_client_id, not_after
auth.oauth_authorizations: client_id, status, expires_at
```

The production rollout may proceed only if this exact schema attestation passes. If the current Supabase schema uses a different authorization lifecycle table, update this file and its fixture to that dated production schema before enabling cleanup; do not guess or silently omit the check.

Query open Brian rows with `status in ('pending','active')`. Query Supabase evidence where a session is unexpired or an authorization is pending/approved and unexpired. All SQL is `SELECT`; `assertReadOnlyMaintenanceConnection` must verify `current_setting('transaction_read_only') = 'on'` and reject an owner/superuser connection.

- [x] **Step 7: Implement CLI parsing and explicit cleanup confirmation**

Use:

```text
npm run oauth:dcr:audit
npm run oauth:dcr:audit -- --delete-stale --yes
```

`--delete-stale` without `--yes` is a usage error. Audit is default and read-only. Require `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `DCR_MAINTENANCE_DATABASE_URL`; accept protected IDs only from `DCR_PROTECTED_CLIENT_IDS` as a comma-separated server environment variable. Never print environment values.

Add:

```json
"oauth:dcr:audit": "tsx src/operations/dcrMaintenanceCli.ts"
```

- [x] **Step 8: Run tests/build and commit**

Run:

```bash
cd server && npm test -- src/operations/dcrRegistry.test.ts src/operations/dcrMaintenanceCli.test.ts && npm run build
```

Expected: pass.

Commit:

```bash
git add server/package.json server/package-lock.json server/src/operations/dcrRegistry.ts server/src/operations/dcrRegistry.test.ts server/src/operations/dcrMaintenanceCli.ts server/src/operations/dcrMaintenanceCli.test.ts
git commit -m "feat: audit and clean dynamic OAuth clients"
```

---

### Task 7: Schedule registry hygiene and encode the kill-switch runbook

**Files:**

- Add: `.github/workflows/dcr-maintenance.yml`
- Modify: `docs/runbooks/monitoring-alerts.md`
- Modify: `docs/runbooks/oauth-outage.md`
- Modify: `docs/mcp-oauth.md`

- [x] **Step 1: Add the scheduled workflow with least privilege**

Create two jobs under both `workflow_dispatch` and cron:

```yaml
on:
  workflow_dispatch:
    inputs:
      cleanup:
        description: Delete eligible dynamic clients
        required: true
        default: false
        type: boolean
  schedule:
    - cron: "17 * * * *"
    - cron: "41 2 * * *"
```

Set `permissions: contents: read`, `timeout-minutes: 10`, Node 24, `working-directory: server`, `npm ci`, and environment values only from repository/environment secrets. Hourly runs execute audit. The daily cron and an explicit cleanup dispatch execute `npm run oauth:dcr:audit -- --delete-stale --yes`.

- [x] **Step 2: Keep GitHub logs count-only**

Do not enable shell tracing or upload raw output as an artifact. Route the single JSON summary and bounded deletion records to the configured log sink. Protect the cleanup job with the `production` GitHub environment so secret access and approvals remain centrally controlled.

- [x] **Step 3: Document warning, stop, and rollback actions**

Add exact thresholds:

```text
warning: >2x trailing seven-day same-hour baseline
release stop: >5x baseline or >=100 registrations in 10 minutes
```

The stop sequence is:

1. Disable Dynamic Client Registration in Supabase Authentication > OAuth Server.
2. Set `MCP_DCR_ENABLED=false` in Brian `app_config`.
3. Leave `MCP_OAUTH_ENABLED=true` so existing token validation continues.
4. Leave `PUBLIC_SIGNUP_ENABLED=false`.
5. Run `npm run oauth:dcr:audit` and record only its summary/run ID.
6. Verify `/api/public/config` and `brian doctor` report registrations paused.

- [x] **Step 4: Validate workflow syntax and commit**

Run:

```bash
npx --yes prettier@3.6.2 --check .github/workflows/dcr-maintenance.yml
rg -n "SUPABASE_SECRET_KEY|DCR_MAINTENANCE_DATABASE_URL" .github/workflows/dcr-maintenance.yml
```

Expected: formatted YAML; both values appear only as `${{ secrets.* }}` references.

Commit:

```bash
git add .github/workflows/dcr-maintenance.yml docs/runbooks/monitoring-alerts.md docs/runbooks/oauth-outage.md docs/mcp-oauth.md
git commit -m "ops: schedule guarded DCR maintenance"
```

---

### Task 8: Extend release smoke and compatibility evidence

**Files:**

- Modify: `server/scripts/smoke-mcp-oauth.mjs`
- Modify: `server/package.json`
- Add: `server/scripts/probe-dcr-registration.mjs`
- Modify: `docs/mcp-client-compatibility.md`
- Modify: `Nextstep.md`

- [x] **Step 1: Add a credential-free public smoke assertion**

Require authorization metadata to advertise a valid `registration_endpoint`, then fetch `/api/public/config` and assert `mcpOAuth`, `mcpOAuthApprovals`, and `mcpDcr` are booleans. The normal smoke must not call the registration endpoint.

- [x] **Step 2: Add an explicit disposable DCR probe**

The probe must be a separate script requiring both `--yes` and `SUPABASE_SECRET_KEY`. It should:

1. fetch discovery;
2. POST one public client registration with a fixed loopback callback and `token_endpoint_auth_method: "none"`;
3. verify the returned client ID exists via the Supabase OAuth Admin SDK;
4. immediately delete it through `deleteClient` in `finally`;
5. print only `{ registration: "proven", cleanup: "deleted", runId }`.

It must never print the registration response, client ID, secret, callback query, or provider error body. Add `smoke:dcr-registration` to `server/package.json`. This probe is controlled-operations evidence, never `brian doctor` behavior.

- [x] **Step 3: Add tests around the probe adapters**

Factor the probe into an injected function and test success, registration failure, verification failure, and cleanup failure with fake fetch/admin adapters. Assert cleanup runs after every post-registration path and output excludes all secret fixtures.

- [ ] **Step 4: Run public smoke locally and update evidence labels**

Run:

```bash
cd server && npm test -- src/operations/dcrRegistry.test.ts && npm run smoke:mcp-oauth
```

Expected before production enablement: public OAuth checks pass; availability may truthfully report DCR/approvals paused.

Update compatibility and next-step documents with separate dated fields for `advertised`, `registered`, `authenticated`, `refreshed`, and `revoked`. Do not mark unperformed fields passed.

- [x] **Step 5: Commit smoke changes**

```bash
git add server/scripts/smoke-mcp-oauth.mjs server/scripts/probe-dcr-registration.mjs server/package.json docs/mcp-client-compatibility.md Nextstep.md
git commit -m "test: add controlled DCR release probes"
```

---

### Task 9: Run complete repository verification and build deployable artifacts

**Files:**

- Modify if generated: `supabase/functions/brian/index.js`
- Modify if generated: `supabase/functions/brian/deno.json`
- Modify only if required by verified behavior: `Nextstep.md`

- [ ] **Step 1: Run the full web suite and build**

```bash
CI=true npm test -- --watchAll=false
npm run build
```

Expected: pass; no React warnings from consent controls.

- [ ] **Step 2: Install server dependencies and run full server verification**

```bash
cd server
npm ci
npm run build
npm test -- --maxWorkers=1
npm run edge:build
git diff --exit-code -- ../supabase/functions/brian/index.js ../supabase/functions/brian/deno.json
```

If the Edge output changed because source changed, include the generated files, rerun `npm run edge:build`, and require a clean second diff.

- [ ] **Step 3: Run the full CLI matrix locally**

```bash
cd ../packages/cli
npm ci
npm test
npm run check
npm pack --dry-run
```

Install the tarball into a temporary prefix and verify `brian --version`, `brian connect --dry-run --json`, and `brian doctor --json` do not spawn login or print credentials.

- [ ] **Step 4: Inspect the complete diff for secret and scope regressions**

```bash
cd ../..
git diff --check
rg -n "client_secret|refresh_token|access_token|authorization_code|code_verifier" packages/cli src server/src .github/workflows/dcr-maintenance.yml
git status --short
```

Every match must be a fixed redaction rule, type/test fixture, or documentation warning—never credential handling in the public CLI/browser.

- [ ] **Step 5: Commit generated artifacts or final verification corrections**

```bash
git add supabase/functions/brian/index.js supabase/functions/brian/deno.json Nextstep.md
git commit -m "build: refresh guarded MCP release artifacts"
```

Skip this commit when those paths are unchanged.

---

### Task 10: Controlled production rollout, real-client proof, and CLI publication

**Files:**

- Modify: `docs/mcp-client-compatibility.md`
- Modify: `Nextstep.md`
- Modify: `packages/cli/package.json`
- Modify: `packages/cli/README.md`

- [ ] **Step 1: Establish DCR maintenance evidence before enablement**

Provision the `DCR_MAINTENANCE_DATABASE_URL` role with `LOGIN`, `default_transaction_read_only=on`, and `SELECT` only on the attested Auth lifecycle tables plus `public.agent_connections` and the DCR marker source. Run:

```bash
cd server && npm run oauth:dcr:audit
```

Record the run ID/count summary and prove the scheduled hourly job delivers to the alert destination. Do not copy the maintenance URL or secret into repository files.

- [ ] **Step 2: Enable the paired controlled-window switches**

In order:

1. confirm `PUBLIC_SIGNUP_ENABLED=false`;
2. enable Supabase Dynamic Client Registration;
3. set `MCP_DCR_ENABLED=true` in `app_config`;
4. set `MCP_OAUTH_APPROVALS_ENABLED=true`;
5. leave `MCP_OAUTH_ENABLED=true`;
6. deploy API/web/Edge artifacts;
7. run `npm run smoke:mcp-oauth` and `npm run smoke:dcr-registration -- --yes`.

If marker/provider behavior disagrees, disable Supabase DCR, set the marker false, and stop the rollout.

- [ ] **Step 3: Prove Codex end to end from URL-only configuration**

Using the installed current Codex in an isolated home:

```bash
npx @brianthebrain/cli connect --only codex
```

Record dated pass/fail for DCR, browser login, verified client/loopback display, company selection, default permissions, Streamable HTTP `initialize`, permission-filtered `tools/list`, and one harmless tenant-scoped `find_skill`. Record no tokens or callback query strings.

- [ ] **Step 4: Prove refresh and immediate revocation**

Allow/force an access-token refresh through the native client and verify a subsequent MCP request succeeds. Revoke the matching Brian connection in the dashboard and prove the very next MCP request fails. Reconnect and prove a new consent flow is required. Record only categorical outcomes and timestamps.

- [ ] **Step 5: Prove a second launch client and document the matrix**

Run the same URL-only journey with the current Claude Code version. If its exact native login surface is unavailable, use Cursor as the second client. A client passes only when registration, consent, initialize, tools, refresh, and revocation all pass on the dated version.

- [ ] **Step 6: Exercise cleanup, alert, and kill switches**

Create a disposable unapproved DCR registration, age only the isolated staging fixture past 24 hours, and prove daily cleanup deletes it while retaining a protected/manual/connected client. Exercise the synthetic volume alert and verify delivery. Disable Supabase DCR plus `MCP_DCR_ENABLED`, prove new registration stops while an existing approved connection still works, then restore both only if alert and rollback evidence are complete.

- [ ] **Step 7: Publish the verified CLI package**

Choose the release version according to the repository's release policy, update `packages/cli/package.json` and README examples, then run:

```bash
cd packages/cli
npm test
npm pack --dry-run
npm publish --access public
npm view @brianthebrain/cli version
```

Install the published version into a clean temporary prefix and rerun one URL-only dry run plus `doctor`. Publication requires npm account authority and 2FA from the owner; do not infer or bypass that authority.

- [ ] **Step 8: Make the release claim only from complete evidence**

Update `docs/mcp-client-compatibility.md` and `Nextstep.md` with exact dates, versions, and categorical results. The accepted claim is:

```text
Connect Brian from any standards-compatible remote MCP agent with one URL.
```

Do not imply that public Brian account signup is open. If any external gate remains incomplete, state the precise remaining gate and keep the claim unreleased.

- [ ] **Step 9: Commit the dated release evidence**

```bash
git add docs/mcp-client-compatibility.md Nextstep.md packages/cli/package.json packages/cli/README.md
git commit -m "release: verify universal MCP connection"
```
