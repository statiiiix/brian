# Runbook: database backup and restore drill

Use this runbook before public signup and at least quarterly after launch. A
successful application test is not a restore test: the release gate closes only
when an operator restores a dated production-like backup into an isolated
project, verifies it, records recovery time/data loss, and deletes the drill
project under the normal change process.

Supabase documents the current backup and PITR behavior in its
[database backup guide](https://supabase.com/docs/guides/platform/backups) and
supports a database-only [restore to a new project](https://supabase.com/docs/guides/platform/clone-project).
Review those documents immediately before a drill because plan eligibility,
retention, and restore behavior can change.

## Ownership and targets

Before the drill, record:

- incident commander and database operator;
- approved isolated destination project and region;
- target recovery point, RPO, and RTO;
- expected migration head and Edge build identifier;
- where the drill evidence will be stored without credentials or customer row
  contents.

Choose the paid backup/PITR retention that satisfies the approved RPO. This is a
billing and risk decision, not a repository default. Never use an in-place
production restore for a routine drill.

## Restore drill

1. Confirm the selected recovery point predates a harmless, uniquely labeled
   synthetic fixture in a dedicated test tenant.
2. Restore or clone that backup into the approved isolated project. Record start
   and ready times; never copy management access tokens into tickets or logs.
3. Keep the restored project unreachable from production DNS, OAuth callbacks,
   webhooks, email delivery, and connector providers.
4. Reapply environment-specific configuration that a database restore does not
   reproduce: Edge Functions, Auth/OAuth settings, custom-hook selection,
   redirect allowlists, CAPTCHA, gateway rules, and secrets.
5. Reset the out-of-band `brian_app` login credential. Supabase notes that daily
   backups do not preserve custom-role passwords.
6. Run the repository migrations against the restored database; replay must be
   convergent and leave the expected migration head.
7. Verify schema objects, tenant/membership/connection counts, the absence of the
   post-recovery-point synthetic fixture, and the presence of older fixtures.
   Record counts and hashes only—never export credential columns or customer
   content into drill evidence.
8. Connect as non-owner `brian_app` and run the cross-tenant RLS suite. Then run
   credential-free discovery and an isolated synthetic OAuth/MCP flow, including
   revocation.
9. Confirm deletion-request, retention, audit immutability, signup provisioning,
   and last-owner invariants still hold.
10. Record achieved RPO/RTO, failures, manual reconfiguration, and a named owner
    and date for every remediation. Destroy the isolated project after evidence
    review.

## Production recovery

For an actual incident, freeze risky writes first, preserve audit evidence,
select the closest approved recovery point before corruption or deletion, and
communicate expected downtime. Restore only with incident-command approval.
After recovery, rotate affected credentials, reset custom-role passwords,
redeploy the exact reviewed Edge artifact, rerun RLS/OAuth smokes, reconcile
events written after the recovery point, and keep public signup and new OAuth
approvals disabled until verification is complete.

The repository contains this procedure but cannot prove the external drill. The
dated drill record remains a GA gate.
