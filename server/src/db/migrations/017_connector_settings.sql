-- Explicit tenant-owned resource selections are separate from encrypted OAuth credentials.
alter table connectors add column if not exists settings jsonb not null default '{}'::jsonb;

-- Migration 014 installed the company-deletion function before settings
-- existed. Reinstall its connector guard so the scheduler erases settings on
-- its terminal write, while later settings-only writes remain blocked once the
-- tenant is suspended.
do $$
declare s text := current_schema();
begin
  execute format($function$
    create or replace function %I.brian_guard_connector_during_company_deletion()
    returns trigger
    language plpgsql
    security definer
    set search_path = pg_catalog, %I
    as $body$
    begin
      if new.status = 'disabled'
         and coalesce(new.credentials, '{}'::jsonb) = '{}'::jsonb
         and coalesce(new.cursor, '{}'::jsonb) = '{}'::jsonb
         and tg_op = 'INSERT' then
        new.settings := '{}'::jsonb;
        return new;
      end if;
      if new.status = 'disabled'
         and coalesce(new.credentials, '{}'::jsonb) = '{}'::jsonb
         and coalesce(new.cursor, '{}'::jsonb) = '{}'::jsonb
         and (old.status <> 'disabled'
           or coalesce(old.credentials, '{}'::jsonb) <> '{}'::jsonb
           or coalesce(old.cursor, '{}'::jsonb) <> '{}'::jsonb
           or coalesce(old.settings, '{}'::jsonb) <> '{}'::jsonb) then
        new.settings := '{}'::jsonb;
        return new;
      end if;

      perform 1
        from %I.tenants tenant
       where tenant.id = new.tenant_id
         and tenant.status = 'active'
       for share;
      if not found then
        raise exception 'company deletion is pending'
          using errcode = '55000', constraint = 'company_deletion_pending';
      end if;
      return new;
    end
    $body$
  $function$, s, s, s);

  execute format('drop trigger if exists brian_guard_deleting_company_connector on %I.connectors', s);
  execute format(
    'create trigger brian_guard_deleting_company_connector before insert or update of tenant_id,status,credentials,settings,cursor on %I.connectors for each row execute function %I.brian_guard_connector_during_company_deletion()',
    s, s
  );
end $$;
