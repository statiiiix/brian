# Public signup and company lifecycle

Brian's public signup creates a Supabase Auth user and exactly one new Brian company. A browser session authenticates the human; it does not connect an agent. Agent access always requires a separate OAuth consent grant.

## User flows

### New company

1. The user opens `/signup`, supplies a full name, work email, password, and company name, accepts the legal terms, and completes Turnstile when configured.
2. The browser calls `supabase.auth.signUp` with PKCE-compatible callback state. Only `full_name` and `company_name` are sent as user metadata.
3. Supabase sends the verification email. `/auth/callback` exchanges the one-time code, removes it from browser history, and accepts only a safe Brian-relative `returnTo` value.
4. Migration 011's Auth trigger checks `PUBLIC_SIGNUP_ENABLED`, creates a collision-safe tenant slug, an owner membership, onboarding state, and a redacted security audit event.
5. The user continues at `/onboarding`.

The trigger is replay-safe: if the user already has a membership, later metadata changes do not move or reprovision them. User metadata cannot nominate a tenant, role, or administrator status.

### Invitation

An owner/admin creates a seven-day, single-use invitation. Brian stores only a SHA-256 token hash and returns a link of the form `/invite/<token>` for the configured delivery system. Before creating an Auth identity, the signup page calls a rate-limited boolean-only preflight with the submitted email and raw token; the server hashes it and returns no tenant, role, inviter, or email data. A brand-new invitee's signup then sends only a non-authoritative `brian_invitation_signup` marker, so normal company creation is deferred and the raw token is never copied into Auth metadata. After authentication, the browser posts the token in the request body to `/api/invitations/accept`. The security-definer resolver matches the signed-in user's normalized email and derives the tenant and role exclusively from the invitation row.

Expired, revoked, already-used, wrong-email, or malformed invitations fail closed. An invalid invitation never falls back to creating an unrelated company. The last active owner cannot be suspended or removed until ownership is transferred.

### Recovery and logout

- `/forgot-password` sends a Supabase recovery email and includes a Turnstile token when configured.
- `/reset-password` changes the password only after Supabase restores a valid recovery session.
- `/auth/callback` preserves only validated relative continuations, including an OAuth `authorization_id` continuation.
- Logout calls `supabase.auth.signOut` and clears Brian's in-memory profile state.

## Onboarding

`onboarding_state` stores server-side progress for five steps:

1. confirm company identity;
2. create the first skill;
3. connect optional sources;
4. connect an AI agent;
5. verify the first `find_skill` MCP call.

Optional sources can be skipped. An empty skill library does not prevent OAuth approval. The first successful `find_skill` call records `first_mcp_call_at`.

## Required configuration

Frontend build variables:

```text
REACT_APP_SUPABASE_URL=https://<project-ref>.supabase.co
REACT_APP_SUPABASE_PUBLISHABLE_KEY=<publishable-or-anon-key>
REACT_APP_TURNSTILE_SITE_KEY=<cloudflare-turnstile-site-key>
REACT_APP_BRIAN_MCP_URL=https://api.brianthebrain.app/mcp
REACT_APP_SITE_URL=https://brianthebrain.app
```

Server/Edge deployment variables (required when the runtime uses `brian_app`):

```text
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<publishable-or-anon-key>
BRIAN_APP_URL=https://brianthebrain.app
```

Enable public provisioning in the database only after the checklist below:

```sql
insert into app_config (key, value)
values ('PUBLIC_SIGNUP_ENABLED', 'true')
on conflict (key) do update set value = excluded.value;
```

The API/UI feature display also reads the `PUBLIC_SIGNUP_ENABLED` runtime variable. Keep both off during migration and staging preparation. Disabling the database flag stops new self-service company provisioning without invalidating existing memberships or sessions; also disable new-user signup in Supabase Auth when a hard stop must prevent creation of membership-less Auth identities.

## Pre-enable checklist

- Migrations 010-014 are applied and `identity_membership_report` returns no unexplained rows.
- The Edge/API database connection uses `brian_app`, not the table owner.
- Supabase email confirmation, production Site URL, exact callback allowlist, password limits, signup/resend rate limits, and email templates are configured.
- Turnstile is enabled in Supabase and the matching site key is present in the frontend deployment.
- Real `/terms` and `/privacy` pages, deletion/retention policy, subprocessors, and security contact are published. The repository does not invent legal text.
- Provisioning failures and signup abuse generate monitored metrics/alerts.
- A clean-browser staging test proves confirmation, retry idempotency, recovery, invitation acceptance, and strict tenant isolation.
- Account/company deletion, the grace-period processor, and retention policy match the reviewed Privacy Policy; see [privacy deletion and retention](runbooks/privacy-deletion-and-retention.md).

## Troubleshooting

- **`membership_required` after login:** the Supabase identity is valid but no active default membership exists. Inspect the owner-only `identity_membership_report`; never add a founding-tenant fallback.
- **Signup confirms but no company exists:** verify the database flag, Auth trigger installation, and trigger logs. Keep signup disabled until the trigger succeeds reliably.
- **Invitation unavailable:** confirm the signed-in email, expiry, and whether it was already consumed. Do not resend or expose the stored hash.
- **OAuth continuation expired:** return to the MCP client and start Connect again; authorization requests are intentionally not reconstructed.
