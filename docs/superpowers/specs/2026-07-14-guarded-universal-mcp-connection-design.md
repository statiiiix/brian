# Guarded Universal MCP Connection and CLI Design

> Date: 2026-07-14
> Status: Approved for implementation
> Scope: Dynamic OAuth client registration, one-command CLI connection, registration hygiene, and real-client release verification

## 1. Outcome

An existing or invited Brian user can connect any standards-compatible remote
HTTP MCP client by supplying only Brian's canonical MCP URL or by running one
CLI command. The client registers itself through Supabase Dynamic Client
Registration (DCR), opens Brian's browser login and consent flow, receives a
tenant-bound OAuth credential, and can use only the tools the user approved.

The canonical resource remains:

```text
https://api.brianthebrain.app/mcp
```

The target CLI journey is:

```text
npx @brianthebrain/cli connect --only codex
  -> validates and backs up local configuration
  -> writes the canonical URL and exact OAuth resource
  -> invokes the client's native Brian OAuth login when supported
  -> browser opens to Brian login and consent
  -> user approves one company and an explicit permission set
  -> client stores its own rotating OAuth credentials
  -> CLI reports connection verification, without reading or printing tokens
```

"Any AI agent" means any client that implements remote Streamable HTTP MCP and
the MCP OAuth discovery/authorization flow. Clients without remote MCP OAuth
remain compatibility cases; Brian does not publish static bearer credentials to
make them appear supported.

## 2. Product decisions

1. **Guarded Supabase DCR is the default registration path.** Manual OAuth app
   registration is retained only for incompatible or controlled enterprise
   clients.
2. **Existing and invited accounts only for this milestone.** Public self-signup
   remains disabled until its independent CAPTCHA, email, legal, and abuse gates
   pass.
3. **Registration is not authorization.** A dynamically registered client gets
   no Brian access until a logged-in user with an active tenant membership
   explicitly approves a Brian connection grant.
4. **Supabase owns OAuth protocol state and credentials.** Brian never receives,
   stores, proxies, or logs client refresh tokens, authorization codes, PKCE
   verifiers, or client registration secrets.
5. **The CLI remains credential-free.** It edits configuration, invokes native
   client login commands, and diagnoses public protocol behavior. The MCP client
   owns token storage.
6. **Default grants stay conservative.** Identity-only OAuth scope resolves to
   `skills:read`, `context:read`, and `executions:write`. On Brian's consent
   page, the user may explicitly add `knowledge:write`; an owner/admin may also
   add `actions:execute`. Both optional permissions start unchecked, and the
   server validates the selection independently of the browser body. Experts
   cannot approve `actions:execute`.
7. **DCR, new approvals, existing-token validation, and public signup remain
   separate switches.** An incident response can stop registrations or new
   grants without breaking already-approved short-lived sessions.
8. **Permanent DCR requires registry monitoring and cleanup.** A short controlled
   production proof may enable DCR temporarily, but the always-on state is not a
   release until registration-volume alerting and supported cleanup are wired.
9. **Client ID Metadata Documents are a future migration, not a parallel v1
   implementation.** Adopt them when Supabase and the launch-client matrix expose
   verified support.

## 3. Alternatives considered

### 3.1 Custom registration and authorization gateway

A Brian-owned OAuth proxy could rate-limit registrations before forwarding them
to Supabase and could eventually implement Client ID Metadata Documents. It was
rejected for this milestone because it would make Brian responsible for a much
larger OAuth security surface, issuer behavior, protocol compatibility, and
incident response.

### 3.2 Manual client allowlist

Pre-registering Claude, Codex, Cursor, and every future agent gives strong
registration control. It was rejected as the default because callback shapes
and versions vary, new clients require Brian-team intervention, and the user
cannot connect by URL alone.

### 3.3 Guarded native DCR

Supabase DCR supplies the standards-based zero-registration experience while
Brian's existing consent, tenant membership, grant, permission, RLS, and
revocation checks remain authoritative for data access. This is the selected
architecture.

## 4. System boundaries

### 4.1 Supabase Auth

Supabase Auth owns:

- OAuth server discovery and DCR;
- exact redirect URI registration and validation;
- authorization code + PKCE S256;
- access-token issuance and rotating refresh tokens;
- provider-side OAuth grants and revocation;
- OAuth client registry administration through the supported OAuth Admin API.

### 4.2 Brian web and server

Brian owns:

- human login continuation into `/oauth/consent`;
- verified client, redirect, company, and permission display;
- active membership and role checks;
- pending/active/denied/revoked `agent_connections`;
- custom access-token claims for tenant, connection, resource, role, and
  permissions;
- exact issuer, signature, lifetime, resource/audience, grant, membership, and
  tenant validation on every MCP request;
- permission-filtered `tools/list` and `tools/call`;
- immediate Brian-side revocation;
- bounded operational metrics and DCR registry hygiene.

### 4.3 Brian CLI

The CLI owns:

- client detection and version evidence;
- safe, atomic, URL-only configuration changes and private backups;
- native-login capability detection;
- interactive login orchestration after configuration;
- public discovery/DCR-advertisement diagnostics;
- categorical local health state without credentials.

## 5. Release controls

The following controls are independent:

| Control | Owner | Effect when false |
|---|---|---|
| Supabase OAuth Server enabled | Supabase | No OAuth authorization server. |
| Supabase Dynamic Client Registration | Supabase | Unknown clients cannot self-register. |
| `MCP_DCR_ENABLED` | Brian `app_config` | Brian and CLI report registrations paused; it mirrors the external enforcement state. |
| `MCP_OAUTH_APPROVALS_ENABLED` | Brian `app_config` | Consent may be denied but cannot prepare a new grant. |
| `MCP_OAUTH_ENABLED` | Brian `app_config` | Existing MCP OAuth tokens are rejected; hard-stop only. |
| `PUBLIC_SIGNUP_ENABLED` | Brian DB/API | New public company provisioning remains unavailable. |

Rollout and rollback procedures must change the Supabase DCR setting and
`MCP_DCR_ENABLED` together. If either side disagrees, `brian doctor`, the owner
operations view, and the release smoke report configuration drift. Brian must
never claim universal registration based only on its marker.

## 6. CLI experience

### 6.1 Interactive `connect`

`brian connect` retains its existing validate-all, preview, confirm, backup, and
atomic-write sequence. Only after all writes succeed may it offer native login.

- With one selected native-login client, the CLI asks whether to authenticate
  now; the default is yes.
- With multiple selected native-login clients, it asks once per client in a
  stable platform order and runs at most one interactive login process at a
  time.
- Claude Code uses `claude mcp login brian` only when that exact subcommand is
  detected. Older Claude versions receive an upgrade/manual-UI instruction.
- Codex uses `codex mcp login brian`.
- Cursor and Claude Desktop receive precise restart and connection-UI
  instructions until their installed versions expose a verified callable login
  command.
- A native command failure does not roll back valid configuration. The result
  reports `configured` separately from `authenticated` and prints the exact safe
  retry command.

### 6.2 Non-interactive behavior

`--json`, `--dry-run`, non-TTY input, or `--no-login` never starts a browser or
native login process. Machine output includes only categorical states and safe
commands. `--yes` approves configuration writes; it does not override the
non-interactive browser rule.

### 6.3 Login command execution safety

Login commands are fixed platform adapter arrays, never shell strings. Client
names, URLs, configuration contents, or server responses are never interpolated
into a shell. The CLI inherits the user's terminal for the child process so the
native client can display its authorization URL and callback status. Timeouts do
not kill a browser callback mid-exchange; the user can interrupt with Ctrl-C and
retry through the reported command.

### 6.4 Doctor and status

`brian doctor` remains credential-free. It verifies:

- both RFC 9728 resource metadata locations;
- authorization-server discovery;
- PKCE S256 and the exact canonical resource;
- presence of a DCR registration endpoint;
- the unauthenticated MCP challenge;
- Brian's public DCR/approval availability markers;
- safe local configuration and native-login command availability.

It labels DCR as `advertised`, not `proven`, because doctor must not create a
registry row. A real authenticated compatibility run is the only `proven`
evidence.

## 7. Consent and authorization

Every DCR client is untrusted until consent completes. The consent page:

- obtains details only from Supabase's verified authorization request;
- treats client name, website, logo, and descriptive metadata as untrusted
  display strings;
- shows the exact redirect hostname and a stronger warning for loopback
  callbacks;
- shows the selected Brian company and current user role;
- shows each Brian permission in plain language;
- keeps the three default read/log permissions selected and shows unchecked
  options for `knowledge:write` and, for owners/admins, `actions:execute`;
- never infers permission from client display metadata;
- refuses approval for viewers, inactive memberships, inaccessible tenants,
  paused approvals, invalid/expired requests, unsafe redirects, or an expert
  requesting `actions:execute`;
- sends the user's selected Brian permissions to the prepare endpoint, which
  rejects unknown permissions, requires the default permission subset, and
  enforces role rules before treating the selection as authoritative;
- prepares the Brian grant before Supabase approval and denies the pending grant
  if provider approval fails.

Permission expansion on an existing connection always requires a fresh consent
flow. Permission reduction may remain an authenticated dashboard operation.

The access-token hook activates exactly one matching pending grant. MCP access
continues to fail closed when the token claims and current server-side grant do
not match exactly.

## 8. DCR registry monitoring and cleanup

### 8.1 Observation

Brian adds a credential-redacting operations command:

```text
npm run oauth:dcr:audit
```

Audit reads only `id`, `registration_type`, `created_at`, and `deleted_at` from
`auth.oauth_clients`, and reads OAuth authorization/consent existence through a read-only maintenance database
connection, and compares public client IDs with Brian `agent_connections`. It
emits counts only:

- active dynamic registrations;
- registrations created in the last 10 minutes and 24 hours;
- registrations with active Brian connections;
- stale registrations with no Brian connection;
- registration-to-approved-connection conversion;
- DCR/Brian marker drift.

Audit requires `SUPABASE_URL` and `DCR_MAINTENANCE_DATABASE_URL`; it never
receives a Supabase secret key. Cleanup additionally requires
`SUPABASE_SECRET_KEY`. The maintenance connection is available only to
the scheduled operations runner and may read the required `auth` lifecycle
tables and Brian connection rows; the command never writes directly to the
`auth` schema. The secret key and maintenance URL are never accepted by the
public CLI, printed, placed in React, or returned from an API.

### 8.2 Cleanup

Audit is the default and is read-only. Cleanup requires both:

```text
npm run oauth:dcr:audit -- --delete-stale --yes
```

A client is eligible only when all of the following are true:

1. Supabase labels it as dynamically registered.
2. It is older than 24 hours.
3. It has no pending or active Brian `agent_connections` row.
4. The read-only maintenance query finds no active Supabase OAuth
   authorization/consent for the client.
5. It is not in an explicit protected-client-ID list.

Deletion uses the supported Supabase OAuth Admin API. The command never deletes
directly from `auth.oauth_clients`. Each deletion result is recorded only by
client ID hash, age bucket, outcome, and run ID; client metadata and credentials
are excluded.

### 8.3 Scheduling and kill switch

A production scheduler runs the read-only audit hourly. Cleanup is never
scheduled: it is a manual, protected-environment operation and runs only while
provider DCR, Brian's DCR marker, and new approvals are all paused and aligned.
The command rechecks that window and lifecycle evidence immediately before each
Admin-API deletion. Permanent DCR requires one recorded successful scheduled
audit run and alert delivery.

The warning threshold is two times the trailing seven-day same-hour baseline.
The release-stop threshold is five times baseline or 100 registrations in ten
minutes. At release-stop, operators disable Supabase DCR and set
`MCP_DCR_ENABLED=false`; existing approved connections remain valid because
`MCP_OAUTH_ENABLED` stays true.

## 9. Error behavior

- **DCR unavailable:** clients receive their standards-level registration error;
  CLI reports registrations paused and the owner runbook identifies marker
  drift or the disabled Supabase setting.
- **Browser does not open:** CLI prints the exact native login retry command.
- **Client registered but no login:** the registration remains unauthorized and
  becomes cleanup-eligible after 24 hours.
- **Expired authorization:** Brian instructs the user to return to the agent and
  connect again; it never reconstructs OAuth state.
- **Approval paused:** denial remains available, while approval returns a safe
  maintenance message.
- **Grant activation/token mismatch:** MCP returns a bounded 401/403 and records
  only the existing categorical failure event.
- **Native login process fails:** configuration remains installed and status
  distinguishes configuration from authentication evidence.
- **Cleanup cannot verify eligibility:** fail closed and retain the registration.
- **Cleanup API failure:** stop the run, preserve remaining registrations, emit a
  bounded operational failure, and alert; do not retry deletions blindly.

## 10. Verification strategy

### 10.1 Automated repository verification

Tests must prove:

- DCR/approval/signup controls remain independent and fail closed;
- public config and doctor surface marker drift without claiming enforcement;
- consent sanitizes dynamic client metadata and highlights loopback redirects;
- default and elevated permission behavior match server enforcement;
- CLI config writes complete before login execution;
- CLI invokes only fixed argument arrays for verified native clients;
- JSON, dry-run, non-TTY, and `--no-login` never spawn login;
- native login failure preserves configuration and yields a safe retry;
- DCR audit never prints client metadata, secrets, tokens, or raw IDs;
- cleanup eligibility requires every predicate and ambiguous cases are retained;
- cleanup uses the Admin API adapter and never direct Auth-schema deletion;
- generated Edge output is deterministic and drift-free.

### 10.2 Controlled production proof

The release sequence is:

1. Keep public signup off.
2. Configure `SUPABASE_SECRET_KEY` only in the production secret runner used for
   registry hygiene.
3. Run and record a read-only DCR audit.
4. Enable Supabase DCR and set `MCP_DCR_ENABLED=true`.
5. Set `MCP_OAUTH_APPROVALS_ENABLED=true` for the controlled window.
6. Run the public OAuth smoke.
7. Run Codex URL-only connect, DCR, browser login, consent, initialize,
   permission-filtered `tools/list`, and a harmless tenant-scoped `find_skill`.
8. Prove refresh-token rotation by reconnecting after an access-token refresh.
9. Revoke the Brian connection and prove the next MCP call fails immediately.
10. Prove the client starts a fresh authorization flow after provider/Brian
    revocation.
11. Repeat the compatibility matrix for a current Claude client and Cursor.
12. Exercise the DCR volume alert and paired kill switches without disabling
    existing-token validation.
13. Run scheduled audit/cleanup once and record counts and alert delivery.
14. Leave DCR enabled only if every applicable check passes; otherwise disable
    DCR and preserve the failure evidence in the compatibility matrix.

## 11. Release claim

Brian may claim "connect from any compatible AI agent with one URL" only when:

- DCR is enabled and the Brian marker matches production;
- existing/invited browser login and consent complete end to end;
- Codex plus at least one second launch client pass the authenticated matrix;
- refresh and immediate revocation are proven;
- registry audit, cleanup, alert delivery, and kill-switch exercises are dated;
- the public CLI package is published with the verified connect behavior and
  installation smoke;
- public signup is still described separately and is not implied by the agent
  connection claim.
