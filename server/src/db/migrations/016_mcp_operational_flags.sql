-- Runtime-visible, non-secret MCP release controls. The application role is
-- not allowed to read owner-only app_config directly; this narrow definer
-- exposes only the two boolean gates required by the public marker and consent
-- path. Missing or malformed values fail closed.
create or replace function public.brian_mcp_operational_flags()
returns table (
  mcp_dcr_enabled boolean,
  mcp_oauth_approvals_enabled boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select lower(c.value) in ('1', 'true', 'yes', 'on')
        from public.app_config c
       where c.key = 'MCP_DCR_ENABLED'
    ), false) as mcp_dcr_enabled,
    coalesce((
      select lower(c.value) in ('1', 'true', 'yes', 'on')
        from public.app_config c
       where c.key = 'MCP_OAUTH_APPROVALS_ENABLED'
    ), false) as mcp_oauth_approvals_enabled;
$$;

revoke all on function public.brian_mcp_operational_flags() from public;
revoke all on function public.brian_mcp_operational_flags() from anon;
revoke all on function public.brian_mcp_operational_flags() from authenticated;
grant execute on function public.brian_mcp_operational_flags() to brian_app;
