-- Add a distinct platform administrator role while keeping authorization data
-- server-managed. New Auth users receive their profile role from app_metadata,
-- never from user_metadata (which users can edit themselves).

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('student', 'teacher', 'admin'));

create or replace function private.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role in ('teacher', 'admin')
  );
$$;

revoke all on function private.is_teacher() from public, anon;
grant execute on function private.is_teacher() to authenticated, service_role;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  requested_nickname text;
  requested_role text;
begin
  requested_nickname := trim(coalesce(new.raw_user_meta_data ->> 'nickname', split_part(new.email, '@', 1)));
  requested_nickname := left(regexp_replace(requested_nickname, '[^[:alnum:] _-]', '', 'g'), 20);
  if char_length(requested_nickname) < 2 then
    requested_nickname := 'Hoc sinh';
  end if;

  -- raw_app_meta_data is only writable through trusted server/admin APIs.
  requested_role := case
    when new.raw_app_meta_data ->> 'role' in ('teacher', 'admin')
      then new.raw_app_meta_data ->> 'role'
    else 'student'
  end;

  perform pg_advisory_xact_lock(hashtext(lower(requested_nickname)));
  if exists (select 1 from public.profiles where lower(nickname) = lower(requested_nickname)) then
    requested_nickname := left(requested_nickname, 15) || '-' || left(md5(new.id::text), 4);
  end if;

  insert into public.profiles (id, nickname, role)
  values (new.id, requested_nickname, requested_role)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

comment on column public.profiles.role is
  'Server-managed authorization role. Valid values: student, teacher, admin.';
