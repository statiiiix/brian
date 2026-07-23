-- The people picker on "Build a skill" needs a member's name, not a UUID.
-- Membership rows are tenant-owned, but the display identity lives in the auth
-- users table, which the app role must never read directly. This narrow
-- SECURITY DEFINER function joins the two for the *caller's own tenant only*:
-- the tenant comes from transaction-local app.tenant_id (bound by the RLS
-- wrapper in db/tenant.ts), never from a parameter, so it can enumerate no
-- other company's members.

do $$
declare
  s text := current_schema();
  auth_users text := case
    when current_schema() = 'public' then 'auth.users'
    else format('%I.brian_auth_users_test', current_schema())
  end;
begin
  execute format($ddl$
    create or replace function %I.list_tenant_members()
    returns table (
      id uuid,
      user_id uuid,
      role text,
      status text,
      is_default boolean,
      email text,
      display_name text,
      created_at timestamptz,
      updated_at timestamptz
    )
    language plpgsql
    stable
    security definer
    set search_path = pg_catalog, %I
    as $function$
    declare v_tenant uuid;
    begin
      begin
        v_tenant := nullif(current_setting('app.tenant_id', true), '')::uuid;
      exception when others then
        return;
      end;
      if v_tenant is null then return; end if;

      return query
      select m.id, m.user_id, m.role, m.status, m.is_default,
             u.email::text,
             nullif(btrim(coalesce(
               u.raw_user_meta_data ->> 'name',
               u.raw_user_meta_data ->> 'full_name',
               ''
             )), ''),
             m.created_at, m.updated_at
        from %I.tenant_memberships m
        left join %s u on u.id = m.user_id
       where m.tenant_id = v_tenant
         and m.status <> 'removed'
       order by m.created_at;
    end
    $function$
  $ddl$, s, s, s, auth_users);

  -- Default-deny, then grant only the server role (same policy as 012).
  execute format('revoke all on function %I.list_tenant_members() from public', s);
  execute format('grant execute on function %I.list_tenant_members() to brian_app', s);
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on function %I.list_tenant_members() from anon', s);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on function %I.list_tenant_members() from authenticated', s);
  end if;
end $$;
