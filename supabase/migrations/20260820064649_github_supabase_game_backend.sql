-- LSTS Caro Tourney — Supabase Auth and persistent player data.
-- Game state migration to Supabase Realtime/Edge Functions will build on these tables.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nickname    text not null unique check (char_length(nickname) between 2 and 20),
  role        text not null default 'student' check (role in ('student', 'teacher')),
  elo         integer not null default 1200 check (elo between 800 and 3000),
  wins        integer not null default 0 check (wins >= 0),
  losses      integer not null default 0 check (losses >= 0),
  draws       integer not null default 0 check (draws >= 0),
  streak      integer not null default 0 check (streak >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles add column if not exists role text not null default 'student';
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.profiles alter column elo set default 1200;

create table if not exists public.match_history (
  id            uuid primary key default gen_random_uuid(),
  room_code     text not null,
  game_type     text not null check (game_type in ('caro', 'tictactoe', 'chess')),
  p1_id         uuid references public.profiles(id) on delete set null,
  p2_id         uuid references public.profiles(id) on delete set null,
  winner_id     uuid references public.profiles(id) on delete set null,
  is_draw       boolean not null default false,
  elo_delta_p1  integer,
  elo_delta_p2  integer,
  played_at     timestamptz not null default now()
);

create index if not exists match_history_p1_played_idx on public.match_history (p1_id, played_at desc);
create index if not exists match_history_p2_played_idx on public.match_history (p2_id, played_at desc);

create or replace function private.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'teacher'
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
begin
  requested_nickname := trim(coalesce(new.raw_user_meta_data ->> 'nickname', split_part(new.email, '@', 1)));
  requested_nickname := left(regexp_replace(requested_nickname, '[^[:alnum:] _-]', '', 'g'), 20);
  if char_length(requested_nickname) < 2 then
    requested_nickname := 'Hoc sinh';
  end if;
  perform pg_advisory_xact_lock(hashtext(lower(requested_nickname)));
  if exists (select 1 from public.profiles where lower(nickname) = lower(requested_nickname)) then
    requested_nickname := left(requested_nickname, 15) || '-' || left(md5(new.id::text), 4);
  end if;

  insert into public.profiles (id, nickname)
  values (new.id, requested_nickname)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Remove the legacy publicly callable SECURITY DEFINER helpers if present.
drop function if exists public.handle_new_user();
drop function if exists public.update_player_stats(uuid, integer, integer, integer, integer, integer);

alter table public.profiles enable row level security;
alter table public.match_history enable row level security;

drop policy if exists profiles_read_all on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists matches_read_own on public.match_history;
drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_update_own_nickname on public.profiles;
drop policy if exists match_history_select_participant_or_teacher on public.match_history;

create policy profiles_select_authenticated
on public.profiles for select
to authenticated
using (true);

create policy profiles_update_own_nickname
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id and role = 'student');

create policy match_history_select_participant_or_teacher
on public.match_history for select
to authenticated
using (
  (select auth.uid()) = p1_id
  or (select auth.uid()) = p2_id
  or (select private.is_teacher())
);

revoke all on public.profiles, public.match_history from anon;
revoke all on public.profiles, public.match_history from authenticated;
grant select on public.profiles, public.match_history to authenticated;
grant update (nickname, updated_at) on public.profiles to authenticated;
grant all on public.profiles, public.match_history to service_role;

drop view if exists public.leaderboard;
create view public.leaderboard
with (security_invoker = true)
as
select
  id, nickname, elo, wins, losses, draws, streak,
  wins * 3 + draws as tournament_points,
  wins + losses + draws as total_games
from public.profiles
order by elo desc, wins desc, nickname;

revoke all on public.leaderboard from anon;
grant select on public.leaderboard to authenticated, service_role;

-- Persistent tournament/game state used by GitHub Pages + Supabase Realtime.
create table if not exists public.tournaments (
  id                uuid primary key default gen_random_uuid(),
  room_code         text not null unique check (room_code ~ '^[A-Z0-9]{6}$'),
  name              text not null check (char_length(name) between 1 and 60),
  game_type         text not null check (game_type in ('caro', 'tictactoe', 'chess')),
  status            text not null default 'waiting' check (status in ('waiting', 'active', 'finished')),
  teacher_id        uuid not null references public.profiles(id) on delete restrict,
  chess_initial_ms  integer,
  chess_increment_ms integer,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz
);

create table if not exists public.tournament_players (
  tournament_id    uuid not null references public.tournaments(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  nickname         text not null,
  status           text not null default 'waiting' check (status in ('waiting', 'matching', 'playing', 'result', 'offline')),
  elo              integer not null default 1200,
  score            integer not null default 0,
  wins             integer not null default 0,
  draws            integer not null default 0,
  losses           integer not null default 0,
  streak           integer not null default 0,
  waiting_since    timestamptz,
  last_opponent_id uuid references public.profiles(id) on delete set null,
  opponent_history uuid[] not null default '{}',
  joined_at        timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

create table if not exists public.matches (
  id                uuid primary key default gen_random_uuid(),
  tournament_id     uuid not null references public.tournaments(id) on delete cascade,
  p1_id             uuid not null references public.profiles(id) on delete restrict,
  p2_id             uuid not null references public.profiles(id) on delete restrict,
  status            text not null default 'active' check (status in ('active', 'finished')),
  board             jsonb not null,
  board_size        integer not null,
  current_turn      uuid references public.profiles(id) on delete restrict,
  winner_id         uuid references public.profiles(id) on delete set null,
  is_draw           boolean not null default false,
  winning_cells     jsonb,
  result_reason     text,
  elo_delta_p1      integer,
  elo_delta_p2      integer,
  p1_time_ms        integer,
  p2_time_ms        integer,
  chess_increment_ms integer,
  turn_started_at   timestamptz,
  turn_deadline_at  timestamptz,
  last_move_at      timestamptz,
  version           integer not null default 0,
  created_at        timestamptz not null default now(),
  finished_at       timestamptz,
  check (p1_id <> p2_id)
);

create table if not exists public.game_events (
  id             bigint generated always as identity primary key,
  tournament_id  uuid not null references public.tournaments(id) on delete cascade,
  match_id       uuid references public.matches(id) on delete cascade,
  actor_id       uuid references public.profiles(id) on delete set null,
  event_type     text not null,
  payload        jsonb not null default '{}',
  created_at     timestamptz not null default now()
);

create index if not exists tournaments_teacher_created_idx on public.tournaments (teacher_id, created_at desc);
create index if not exists tournament_players_status_idx on public.tournament_players (tournament_id, status, waiting_since);
create index if not exists matches_tournament_status_idx on public.matches (tournament_id, status, created_at desc);
create index if not exists game_events_tournament_id_idx on public.game_events (tournament_id, id desc);

create or replace function private.is_tournament_member(target_tournament uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.tournament_players
    where tournament_id = target_tournament and user_id = (select auth.uid())
  ) or exists (
    select 1 from public.tournaments
    where id = target_tournament and teacher_id = (select auth.uid())
  );
$$;

revoke all on function private.is_tournament_member(uuid) from public, anon;
grant execute on function private.is_tournament_member(uuid) to authenticated, service_role;

alter table public.tournaments enable row level security;
alter table public.tournament_players enable row level security;
alter table public.matches enable row level security;
alter table public.game_events enable row level security;

create policy tournaments_select_member
on public.tournaments for select to authenticated
using ((select private.is_tournament_member(id)));

create policy tournament_players_select_member
on public.tournament_players for select to authenticated
using ((select private.is_tournament_member(tournament_id)));

create policy matches_select_member
on public.matches for select to authenticated
using ((select private.is_tournament_member(tournament_id)));

create policy game_events_select_member
on public.game_events for select to authenticated
using ((select private.is_tournament_member(tournament_id)));

revoke all on public.tournaments, public.tournament_players, public.matches, public.game_events from anon, authenticated;
grant select on public.tournaments, public.tournament_players, public.matches, public.game_events to authenticated;
grant all on public.tournaments, public.tournament_players, public.matches, public.game_events to service_role;
grant usage, select on sequence public.game_events_id_seq to service_role;

-- Postgres Changes is sufficient for a classroom-sized tournament and keeps
-- the browser clients synchronized without a third hosting platform.
do $$
declare table_name text;
begin
  foreach table_name in array array['tournaments', 'tournament_players', 'matches', 'game_events']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
