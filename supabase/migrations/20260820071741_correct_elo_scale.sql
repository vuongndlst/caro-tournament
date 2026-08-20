-- Keep the number of globally rated games captured when a player joins a
-- tournament. The Edge Function increments it after every completed match and
-- uses it for placement/provisional K-factor decisions.
alter table public.tournament_players
  add column if not exists rated_games integer not null default 0
  check (rated_games >= 0);

update public.tournament_players tp
set rated_games = greatest(0, p.wins + p.draws + p.losses)
from public.profiles p
where p.id = tp.user_id
  and tp.rated_games = 0;

comment on column public.tournament_players.rated_games is
  'Total rated games used for placement rank and ELO K-factor selection.';

-- A player's Caro, Tic-tac-toe and Chess ability are independent. Keeping one
-- profile-level ELO made results from one game incorrectly affect matchmaking
-- in another game.
create table if not exists public.profile_game_ratings (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  game_type   text not null check (game_type in ('caro', 'tictactoe', 'chess')),
  elo         integer not null default 1200 check (elo between 800 and 3000),
  wins        integer not null default 0 check (wins >= 0),
  draws       integer not null default 0 check (draws >= 0),
  losses      integer not null default 0 check (losses >= 0),
  streak      integer not null default 0 check (streak >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, game_type)
);

-- Existing data predates multiple game modes, so preserve it as Caro history.
insert into public.profile_game_ratings (user_id, game_type, elo, wins, draws, losses, streak)
select id, 'caro', elo, wins, draws, losses, streak
from public.profiles
on conflict (user_id, game_type) do nothing;

alter table public.profile_game_ratings enable row level security;

drop policy if exists profile_game_ratings_select_authenticated
  on public.profile_game_ratings;
create policy profile_game_ratings_select_authenticated
on public.profile_game_ratings for select to authenticated
using (true);

revoke all on public.profile_game_ratings from anon, authenticated;
grant select on public.profile_game_ratings to authenticated;
grant all on public.profile_game_ratings to service_role;

drop view if exists public.game_leaderboard;
create view public.game_leaderboard
with (security_invoker = true)
as
select
  r.user_id,
  p.nickname,
  r.game_type,
  r.elo,
  r.wins,
  r.draws,
  r.losses,
  r.streak,
  r.wins + r.draws + r.losses as total_games
from public.profile_game_ratings r
join public.profiles p on p.id = r.user_id
order by r.game_type, r.elo desc, r.wins desc, p.nickname;

revoke all on public.game_leaderboard from anon;
grant select on public.game_leaderboard to authenticated, service_role;
