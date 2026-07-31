-- Global Brian logout intentionally ends user-delegated agent authorization.
-- Persist that fact separately from revocation so the dashboard can explain
-- that reconnecting the agent is sufficient.

alter table agent_connections
  add column if not exists inactive_reason text;

alter table agent_connections
  drop constraint if exists agent_connections_status_check;

alter table agent_connections
  add constraint agent_connections_status_check
  check (status in ('pending', 'active', 'inactive', 'denied', 'revoked'));

alter table agent_connections
  drop constraint if exists agent_connections_inactive_reason_check;

alter table agent_connections
  add constraint agent_connections_inactive_reason_check
  check (
    (status = 'inactive' and inactive_reason in ('user_logout'))
    or (status <> 'inactive' and inactive_reason is null)
  );
