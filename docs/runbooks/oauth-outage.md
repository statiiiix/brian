# Runbook: MCP OAuth outage

Use this runbook when discovery, browser authorization, token exchange/refresh, or authenticated MCP initialization fails above the agreed error threshold.

## Immediate objectives

1. Protect tenant isolation and credential confidentiality.
2. Determine whether the failure is public discovery/proxy, Supabase authorization, Brian token validation, grant resolution, or database/runtime availability.
3. Stop creating unsafe or unusable grants while preserving evidence and existing access only when it remains safe.

Never recover service by accepting a missing/wrong audience, trusting browser metadata, disabling membership/grant checks, exposing the raw Edge Function URL, or broadly enabling legacy tokens.

## Triage

Record incident time, environment, request IDs, affected client/version, and status/error categories. Do not collect bearer values or callback URLs.

1. Run `npm run smoke:mcp-oauth` with no token. If it fails, check branded-domain DNS/TLS, proxy rewrites, both RFC 9728 documents, the `401` challenge, and Supabase authorization-server discovery.
2. Check Supabase Auth/OAuth status, OAuth enablement, signing-key/JWKS availability, consent path, redirect allowlists, DCR volume, custom-hook errors, and recent configuration changes.
3. With a dedicated synthetic tenant and short-lived token, run the authenticated smoke. Separate signature/issuer/audience failures from missing claims and from an inactive grant/membership.
4. Check Edge/API and database health, `brian_app` connectivity, resolver errors, migration version, request latency, and error-rate changes.
5. Reproduce with the protocol-control client before labeling a vendor client incompatible.

## Containment

- Set the database `PUBLIC_SIGNUP_ENABLED` value to `false` to stop new company provisioning while preserving existing sessions. For a hard signup stop, also disable new-user signup in Supabase Auth so no membership-less identities accumulate.
- Set `MCP_OAUTH_APPROVALS_ENABLED=false` to stop new grant preparation and disable Approve while continuing to validate existing short-lived tokens. Users can still deny an authorization request safely. `MCP_OAUTH_ENABLED=false` is the separate hard stop that rejects existing OAuth MCP tokens; use it only when continuing OAuth validation is unsafe.
- Keep `LEGACY_AGENT_TOKENS_ENABLED` unchanged unless incident command explicitly approves a tenant-scoped, time-boxed fallback. Global legacy enablement is not a normal OAuth rollback.
- Set the application marker `MCP_DCR_ENABLED=false` and disable DCR in Supabase if registration abuse is the cause and known launch clients have a safe pre-registered path. The Supabase setting is the enforcement boundary.
- Revoke only affected grants for a client-specific compromise; rotate signing keys only for signing-key compromise.

## Recovery

1. Fix staging first and rerun public discovery, authorization, token exchange, claims, MCP initialize, tools filtering, access-token expiry/refresh, and revocation.
2. Verify two staging tenants cannot cross read/write boundaries and that the application is still using `brian_app`.
3. Restore production behind the smallest affected switch. Watch approval-success-to-MCP-401 rate, refresh failures, resolver errors, DCR volume, and Edge latency.
4. Reenable public signup last, after trigger/provisioning metrics are healthy.
5. Ask impacted users to start Connect again only after the authorization service is stable. Never attempt to reconstruct expired authorizations.

## Closeout

Document timeline, root cause, affected tenants/connections, exact safe mitigations, and whether any credentials require rotation. Exercise the failed path in an automated smoke or integration test. Review alert thresholds and confirm no incident artifact contains secrets.
