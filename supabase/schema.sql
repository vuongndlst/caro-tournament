-- CaroTourney: Supabase schema
-- Run in Supabase SQL editor (Dashboard → SQL)

-- Profiles table (extends Supabase Auth users)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nickname    text not null unique,
  elo         integer not null default 1000,
  wins        integer not null default 0,
  losses      integer not null default 0,
  draws       integer not null default 0,
  streak      integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Match history
create table if not exists public.match_history (
  id            uuid primary key default gen_random_uuid(),
  room_code     text not null,
  game_type     text not null check (game_type in ('caro','tictactoe','chess')),
  p1_id         uuid references public.profiles(id),
  p2_id         uuid references public.profiles(id),
  winner_id     uuid references public.profiles(id),
  is_draw       boolean not null default false,
  elo_delta_p1  integer,
  elo_delta_p2  integer,
  played_at     timestamptz not null default now()
);

-- Row-level security
alter table public.profiles enable row level security;
alter table public.match_history enable row level security;

-- Anyone can read profiles (for leaderboard)
create policy "profiles_read_all" on public.profiles
  for select using (true);

-- Only own profile can be updated (server uses service role, bypasses RLS)
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Players can read their own matches; server writes via service role
create policy "matches_read_own" on public.match_history
  for select using (auth.uid() = p1_id or auth.uid() = p2_id);

-- Auto-create profile on signup (triggered by auth.users insert)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nickname)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Helper function called by the server to atomically update stats
create or replace function public.update_player_stats(
  p_id uuid, p_elo int, p_wins int, p_losses int, p_draws int, p_streak int
) returns void language plpgsql security definer as $$
begin
  update public.profiles set
    elo = p_elo, wins = p_wins, losses = p_losses,
    draws = p_draws, streak = p_streak
  where id = p_id;
end;
$$;

-- Global ELO leaderboard view
create or replace view public.leaderboard as
select
  id, nickname, elo, wins, losses, draws, streak,
  (wins * 3 + draws) as tournament_points,
  (wins + losses + draws) as total_games
from public.profiles
order by elo desc;
