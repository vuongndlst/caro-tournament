-- Account hardening, academic seasons, provisional ratings and a server-side
-- timeout safety net for LSTS Caro Tourney.

-- ── Account security state ────────────────────────────────────────────────
alter table public.profiles
  add column if not exists must_change_password boolean not null default false,
  add column if not exists password_reset_at timestamptz,
  add column if not exists is_locked boolean not null default false,
  add column if not exists locked_at timestamptz,
  add column if not exists mfa_required boolean not null default false;

update public.profiles
set mfa_required = role in ('teacher', 'admin')
where mfa_required is distinct from (role in ('teacher', 'admin'));

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and not is_locked
  );
$$;

revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated, service_role;

-- Authorization flags come only from raw_app_meta_data. raw_user_meta_data is
-- intentionally limited to the display nickname because users can edit it.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  requested_nickname text;
  requested_role text;
  force_password_change boolean;
begin
  requested_nickname := trim(coalesce(new.raw_user_meta_data ->> 'nickname', split_part(new.email, '@', 1)));
  requested_nickname := left(regexp_replace(requested_nickname, '[^[:alnum:] _-]', '', 'g'), 20);
  if char_length(requested_nickname) < 2 then requested_nickname := 'Hoc sinh'; end if;

  requested_role := case
    when new.raw_app_meta_data ->> 'role' in ('teacher', 'admin')
      then new.raw_app_meta_data ->> 'role'
    else 'student'
  end;
  force_password_change := coalesce((new.raw_app_meta_data ->> 'must_change_password')::boolean, false);

  perform pg_advisory_xact_lock(hashtext(lower(requested_nickname)));
  if exists (select 1 from public.profiles where lower(nickname) = lower(requested_nickname)) then
    requested_nickname := left(requested_nickname, 15) || '-' || left(md5(new.id::text), 4);
  end if;

  insert into public.profiles (
    id, nickname, role, must_change_password, password_reset_at, mfa_required
  ) values (
    new.id, requested_nickname, requested_role, force_password_change,
    case when force_password_change then now() else null end,
    requested_role in ('teacher', 'admin')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

-- ── Academic seasons and seasonal ratings ────────────────────────────────
create table if not exists public.seasons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 80),
  school_year text not null check (school_year ~ '^[0-9]{4}-[0-9]{4}$'),
  semester    text not null check (semester in ('1', '2', 'summer')),
  status      text not null default 'active' check (status in ('active', 'archived')),
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create unique index if not exists seasons_one_active_idx
  on public.seasons ((status)) where status = 'active';

insert into public.seasons (name, school_year, semester, status)
select 'Học kỳ 1 · 2026-2027', '2026-2027', '1', 'active'
where not exists (select 1 from public.seasons where status = 'active');

alter table public.profile_game_ratings
  add column if not exists rated_games integer not null default 0
  check (rated_games >= 0);

update public.profile_game_ratings
set rated_games = wins + draws + losses
where rated_games = 0 and wins + draws + losses > 0;

create table if not exists public.season_game_ratings (
  season_id   uuid not null references public.seasons(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  game_type   text not null check (game_type in ('caro', 'tictactoe', 'chess')),
  elo         integer not null default 1200 check (elo between 800 and 3000),
  rated_games integer not null default 0 check (rated_games >= 0),
  wins        integer not null default 0 check (wins >= 0),
  draws       integer not null default 0 check (draws >= 0),
  losses      integer not null default 0 check (losses >= 0),
  streak      integer not null default 0 check (streak >= 0),
  updated_at  timestamptz not null default now(),
  primary key (season_id, user_id, game_type)
);

alter table public.tournaments
  add column if not exists season_id uuid references public.seasons(id) on delete restrict,
  add column if not exists is_rated boolean not null default true,
  add column if not exists chess_mode text
    check (chess_mode is null or chess_mode in ('blitz', 'rapid', 'standard', 'custom'));

update public.tournaments
set season_id = (select id from public.seasons where status = 'active' limit 1)
where season_id is null;

alter table public.tournaments alter column season_id set not null;

alter table public.match_history
  add column if not exists season_id uuid references public.seasons(id) on delete set null,
  add column if not exists is_rated boolean not null default true,
  add column if not exists chess_mode text
    check (chess_mode is null or chess_mode in ('blitz', 'rapid', 'standard', 'custom'));

update public.match_history
set season_id = (select id from public.seasons where status = 'active' limit 1)
where season_id is null;

create index if not exists season_game_ratings_leaderboard_idx
  on public.season_game_ratings (season_id, game_type, elo desc, wins desc);
create index if not exists tournaments_season_created_idx
  on public.tournaments (season_id, created_at desc);
create index if not exists match_history_season_played_idx
  on public.match_history (season_id, played_at desc);

alter table public.seasons enable row level security;
alter table public.season_game_ratings enable row level security;

drop policy if exists seasons_select_authenticated on public.seasons;
create policy seasons_select_authenticated
on public.seasons for select to authenticated
using (true);

drop policy if exists season_game_ratings_select_authenticated on public.season_game_ratings;
create policy season_game_ratings_select_authenticated
on public.season_game_ratings for select to authenticated
using (true);

revoke all on public.seasons, public.season_game_ratings from anon, authenticated;
grant select on public.seasons, public.season_game_ratings to authenticated;
grant all on public.seasons, public.season_game_ratings to service_role;

drop view if exists public.season_leaderboard;
create view public.season_leaderboard
with (security_invoker = true)
as
select
  r.season_id,
  s.name as season_name,
  r.user_id,
  p.nickname,
  r.game_type,
  r.elo,
  r.rated_games,
  r.wins,
  r.draws,
  r.losses,
  r.streak,
  (r.rated_games < 5) as is_placement
from public.season_game_ratings r
join public.seasons s on s.id = r.season_id
join public.profiles p on p.id = r.user_id
order by s.starts_at desc, r.game_type, r.elo desc, r.wins desc, p.nickname;

revoke all on public.season_leaderboard from anon;
grant select on public.season_leaderboard to authenticated, service_role;

do $$
declare table_name text;
begin
  foreach table_name in array array['seasons', 'season_game_ratings']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;

-- ── Timeout safety net ────────────────────────────────────────────────────
-- Browser clients still claim exact deadlines. This once-per-minute job is a
-- recovery path when both players disconnect. The Vault values are provisioned
-- separately and never committed to source control.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'lsts-expired-match-worker') then
    perform cron.unschedule('lsts-expired-match-worker');
  end if;
end $$;

select cron.schedule(
  'lsts-expired-match-worker',
  '* * * * *',
  $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'lsts_project_url' limit 1)
        || '/functions/v1/game-api',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'lsts_service_role_key' limit 1),
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lsts_service_role_key' limit 1)
      ),
      body := '{"action":"process_expired_matches"}'::jsonb,
      timeout_milliseconds := 10000
    );
  $cron$
);
