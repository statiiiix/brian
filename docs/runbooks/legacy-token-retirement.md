# Legacy agent-token retirement

Legacy `api_tokens` bearers exist only to migrate installations to MCP OAuth. Do not use this path for public onboarding, and never select, export, log, or paste `token_hash` values.

## Safe inventory

Migration 013 provides a tenant-RLS-aware, security-invoker report containing only operational metadata:

```sql
select
  token_id,
  tenant_id,
  tenant_name,
  tenant_slug,
  tenant_status,
  label,
  created_at,
  last_used_at,
  expires_at,
  has_no_expiry,
  usage_state
from legacy_token_migration_report
order by last_used_at desc nulls last, created_at;
```

The view includes only unrevoked, unexpired credentials. `last_used_at` is advanced by the narrow resolver at most once every five minutes, so it is migration evidence rather than an exact request log. A null `last_used_at` means “not observed since tracking shipped,” not proof that the credential was never used historically.

Existing null-expiry rows remain valid during the rollout. New code-issued legacy tokens must call `ensureToken` with an explicit future expiry. `ensureLegacyToken` is reserved solely for idempotently importing the pre-existing founding `BRIAN_API_TOKEN`; it must not be used by new issuance flows.

## Per-tenant migration

For each reported token:

1. Identify its owner from tenant and label; never request or recover the bearer value.
2. Have the owner run the URL-only CLI connection and complete browser OAuth.
3. Verify a tenant-scoped `find_skill` call and a redacted execution audit from the new OAuth connection.
4. Revoke the legacy row by `token_id` and `tenant_id`, never by hash:

   ```sql
   update api_tokens
      set revoked_at = now()
    where id = $1
      and tenant_id = $2
      and revoked_at is null;
   ```

5. Verify the old client receives `401`, then remove its static credential and securely delete any configuration backup containing it.
6. Record the migration owner and verification evidence outside the credential table.

Revoking rows tenant by tenant is the scoped disable control while `LEGACY_AGENT_TOKENS_ENABLED` remains on for installations still migrating. Do not switch the global flag off until the report is empty or every remaining exception has an approved, dated owner.

## Dated rollout gates

These are operational gates, not automatic database jobs. Missing evidence delays the gate; it never justifies weakening OAuth validation.

| Date | Gate |
|---|---|
| 2026-07-13 | Ship expiry/usage tracking and the non-secret report. Existing null-expiry rows remain accepted. |
| 2026-08-03 | Complete founding/internal reconnects. Stop issuing customer legacy credentials; emergency exceptions require a named owner and explicit expiry. |
| 2026-09-01 | Contact every tenant still present in the report and revoke credentials already replaced by verified OAuth connections. |
| 2026-10-01 | Revoke remaining tenant rows individually unless an approved exception has a future expiry and migration date. |
| 2026-11-02 | Set `LEGACY_AGENT_TOKENS_ENABLED=false` after staging and production smoke verification. Keep the code path for a 30-day rollback window. |
| 2026-12-02 | Remove the static founding-token and legacy resolver path only after the report remains empty and the rollback window closes. |

## Rollback and incidents

- A normal OAuth outage is not permission to re-enable all legacy tokens. Follow the OAuth outage runbook and keep issuer, audience, resource, membership, and grant checks intact.
- If a specifically migrated tenant must roll back during the window, require incident-owner approval and issue a new short-expiry compatibility credential; do not un-revoke a possibly copied bearer.
- A compromised legacy bearer is revoked immediately by token ID. Inspect redacted request/audit evidence and remove client backups; never print the stored hash while investigating.
- After the global flag is disabled, re-enabling it requires an incident record, explicit affected tenants, a fixed end time, and post-incident revocation.

Related guidance: [token handling](../security/token-handling.md), [OAuth outage](oauth-outage.md), and [compromised agent connection](compromised-agent-connection.md).
