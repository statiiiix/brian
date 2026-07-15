-- Runtime-visible, non-secret MCP release controls. The application role is
-- not allowed to read owner-only app_config directly; this narrow definer
-- exposes only the two boolean gates required by the public marker and consent
-- path. Missing or malformed values fail closed. Production installs into
-- public; isolated tests install into their active schema.
do $migration$
declare
  s text := current_schema();
begin
  execute format($ddl$
    create or replace function %I.brian_mcp_operational_flags()
    returns table (
      mcp_dcr_enabled boolean,
      mcp_oauth_approvals_enabled boolean
    )
    language sql
    stable
    security definer
    set search_path = ''
    as $function$
      select
        coalesce((
          select lower(c.value) in ('1', 'true', 'yes', 'on')
            from %I.app_config c
           where c.key = 'MCP_DCR_ENABLED'
        ), false) as mcp_dcr_enabled,
        coalesce((
          select lower(c.value) in ('1', 'true', 'yes', 'on')
            from %I.app_config c
           where c.key = 'MCP_OAUTH_APPROVALS_ENABLED'
        ), false) as mcp_oauth_approvals_enabled;
    $function$
  $ddl$, s, s, s);

  execute format(
    'revoke all on function %I.brian_mcp_operational_flags() from public', s
  );
  execute format(
    'revoke all on function %I.brian_mcp_operational_flags() from anon', s
  );
  execute format(
    'revoke all on function %I.brian_mcp_operational_flags() from authenticated', s
  );
  execute format(
    'grant execute on function %I.brian_mcp_operational_flags() to brian_app', s
  );
end
$migration$;
