-- Interviews (004) predate the Supabase-auth identity migration (010):
-- created_by still referenced the legacy local `users` table, while the API
-- records the authenticated identity id. Every interview a real dashboard user
-- started therefore failed its foreign key and the route answered 500.
-- Repoint the column at the identity table the rest of the schema already uses.
-- Attribution stays intentionally nullable (see 014): a legacy row pointing at
-- a retired local user loses its attribution rather than the interview.
do $$
declare
  s text := current_schema();
  auth_users text;
  created_by_attnum smallint;
  legacy record;
begin
  if s = 'public' then
    if to_regclass('auth.users') is null then
      raise exception 'auth.users is required for identity migration';
    end if;
    auth_users := 'auth.users';
  else
    auth_users := format('%I.brian_auth_users_test', s);
  end if;

  select attnum into created_by_attnum
    from pg_attribute
   where attrelid = format('%I.interviews', s)::regclass
     and attname = 'created_by'
     and not attisdropped;

  -- Drop whatever foreign key currently guards created_by, by shape rather
  -- than by name, so replays and the legacy 004 constraint both converge.
  for legacy in
    select con.conname
      from pg_constraint con
     where con.contype = 'f'
       and con.conrelid = format('%I.interviews', s)::regclass
       and array_length(con.conkey, 1) = 1
       and con.conkey[1] = created_by_attnum
  loop
    execute format('alter table %I.interviews drop constraint %I', s, legacy.conname);
  end loop;

  execute format(
    'update %I.interviews set created_by = null
      where created_by is not null
        and not exists (select 1 from %s identity where identity.id = created_by)',
    s, auth_users
  );

  execute format(
    'alter table %I.interviews add constraint interviews_created_by_user_fk
       foreign key (created_by) references %s(id) on delete set null',
    s, auth_users
  );
end $$;
