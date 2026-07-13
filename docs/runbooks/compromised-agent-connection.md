# Runbook: compromised agent connection

Use this runbook for a lost device, suspected MCP refresh-token theft, unexpected agent actions, malicious OAuth client metadata, or an agent connection the user no longer controls.

## Contain immediately

1. In Brian, open Settings → Agents & connections and revoke the exact connection. Brian's current-grant resolver must block its next request even if the access token is unexpired.
2. If the approving user is available, revoke the matching Supabase OAuth grant as that user. The dashboard attempts this automatically when a user revokes their own connection. For an administrator revoking another user's connection, use Supabase's supported administrative/user procedure as soon as available.
3. On the affected MCP client/device, run its OAuth logout and remove the Brian entry or run `brian disconnect`. Clear credentials through the client's supported storage—not by searching/logging their values.
4. If the device may expose a legacy static bearer, revoke the corresponding `api_tokens` row and inspect/remove CLI configuration backups that contain it.

Do not delete audit events, rotate unrelated tenant credentials, or disable tenant checks.

## Investigate

Preserve redacted evidence:

- connection ID, OAuth client ID/name, approving user, tenant, permissions, created/approved/last-used/revoked times;
- request IDs, tool names, execution IDs, connector/action categories, outcomes, and source IP category where available;
- membership/tenant status changes and relevant Supabase Auth events.

Never paste access/refresh tokens, Authorization headers, raw callbacks, PKCE values, connector secrets, invitation tokens, or stored hashes into the incident record.

Determine whether the event is limited to one grant, one user session, one device, a connector credential, the OAuth client registration, or the Supabase signing plane. Verify that no other connection shares unexpected client/redirect metadata and that audit activity stayed within the resolved tenant.

## Eradicate and recover

- One connection: leave it revoked, clear the client session, and create a fresh authorization grant after the device/client is trusted.
- User account compromise: invalidate Supabase sessions, reset credentials/MFA as supported, review all that user's connections, then reauthorize individually.
- OAuth client registration compromise: disable/revoke the client at Supabase, revoke every Brian grant for that client, and require fresh trusted registration.
- Connector compromise: revoke at the provider, disable the tenant connector, rotate its provider secret, and review actions separately. Brian MCP token rotation does not rotate Google/Slack credentials.
- Signing-key compromise: invoke the Supabase signing-key incident process, preserve safe JWKS overlap only if security permits, invalidate affected token families, and retest exact issuer/audience validation.

After recovery, run the authenticated MCP smoke with a harmless synthetic tenant, verify permission filtering, and then revoke it to prove immediate denial. Monitor the affected tenant for renewed client IDs or repeated invalid-token attempts.

## Closeout

Record scope, revocation times, evidence reviewed, user notifications, rotations, and preventive action. Add a regression test or alert for the failed control. Confirm the old connection remains revoked and no secret was copied into logs, tickets, chat, or source control.
