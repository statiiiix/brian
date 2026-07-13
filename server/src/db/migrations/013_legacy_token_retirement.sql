-- Phase-5 retirement controls for the temporary api_tokens compatibility path.
-- Existing rows deliberately retain a NULL expires_at so rollout is
-- nonbreaking. New application-issued rows require an explicit future expiry.

alter table api_tokens add column if not exists last_used_at timestamptz;
alter table api_tokens add column if not exists expires_at timestamptz;

do $$
declare s text := current_schema();
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'api_tokens_expiry_after_creation'
       and conrelid = format('%I.api_tokens', s)::regclass
  ) then
    execute format(
      'alter table %I.api_tokens add constraint api_tokens_expiry_after_creation check (expires_at is null or expires_at > created_at)',
      s
    );
  end if;
end $$;

-- Supports the tenant-scoped retirement inventory without indexing already
-- revoked credentials. The resolver continues to use token_hash's unique
-- index and never exposes that value.
create index if not exists api_tokens_active_retirement_idx
  on api_tokens (tenant_id, created_at)
  include (last_used_at, expires_at)
  where revoked_at is null;

do $$
declare s text := current_schema();
begin
  -- This view contains no credential material. SECURITY INVOKER makes the
  -- underlying api_tokens/tenants RLS policies apply to brian_app callers.
  execute format($view$
    create or replace view %I.legacy_token_migration_report
      with (security_invoker = true, security_barrier = true)
    as
    select
      a.id as token_id,
      a.tenant_id,
      t.name as tenant_name,
      t.slug as tenant_slug,
      t.status as tenant_status,
      a.label,
      a.created_at,
      a.last_used_at,
      a.expires_at,
      (a.expires_at is null) as has_no_expiry,
      case when a.last_used_at is null then 'never_used' else 'observed' end as usage_state
    from %I.api_tokens a
    join %I.tenants t on t.id = a.tenant_id
    where a.revoked_at is null
      and (a.expires_at is null or a.expires_at > statement_timestamp())
  $view$, s, s, s);

  -- Pre-tenant validation remains a single exact-hash lookup. A valid use
  -- advances last_used_at at most once per five minutes, avoiding a write on
  -- every MCP request while still providing useful migration evidence.
  execute format($function$
    create or replace function %I.resolve_legacy_agent_token(p_token_hash text)
    returns table (
      tenant_id uuid,
      connection_id uuid
    )
    language plpgsql
    volatile
    security definer
    set search_path = pg_catalog, %I
    as $body$
    declare
      v_token_id uuid;
      v_tenant_id uuid;
    begin
      if p_token_hash is null or lower(p_token_hash) !~ '^[0-9a-f]{64}$' then
        return;
      end if;

      select a.id, a.tenant_id
        into v_token_id, v_tenant_id
        from %I.api_tokens a
        join %I.tenants t on t.id = a.tenant_id
       where a.token_hash = lower(p_token_hash)
         and a.revoked_at is null
         and (a.expires_at is null or a.expires_at > statement_timestamp())
         and t.status = 'active'
       limit 1;
      if not found then return; end if;

      update %I.api_tokens
         set last_used_at = statement_timestamp()
       where id = v_token_id
         and (
           last_used_at is null
           or last_used_at < statement_timestamp() - interval '5 minutes'
         );

      return query select v_tenant_id, null::uuid;
    end
    $body$
  $function$, s, s, s, s, s);

  -- A security-invoker view requires underlying column privileges. Replace
  -- broad table SELECT with only the non-secret columns used by the report;
  -- the exact hash is available solely inside the definer resolver.
  execute format('revoke select on table %I.api_tokens from brian_app', s);
  execute format(
    'grant select (id, tenant_id, label, created_at, revoked_at, last_used_at, expires_at) on table %I.api_tokens to brian_app',
    s
  );

  execute format('revoke all on table %I.legacy_token_migration_report from public', s);
  execute format('revoke all on table %I.legacy_token_migration_report from brian_app', s);
  execute format('grant select on table %I.legacy_token_migration_report to brian_app', s);
  execute format('revoke all on function %I.resolve_legacy_agent_token(text) from public', s);
  execute format('grant execute on function %I.resolve_legacy_agent_token(text) to brian_app', s);

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on table %I.legacy_token_migration_report from anon', s);
    execute format('revoke all on function %I.resolve_legacy_agent_token(text) from anon', s);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on table %I.legacy_token_migration_report from authenticated', s);
    execute format('revoke all on function %I.resolve_legacy_agent_token(text) from authenticated', s);
  end if;
end $$;
