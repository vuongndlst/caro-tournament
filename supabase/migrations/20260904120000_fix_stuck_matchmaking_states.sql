-- Sửa hai trạng thái khiến học sinh không bao giờ được ghép trận nữa.
--
-- 1. "matching" là ngõ cụt. matchWaiting đặt cả hai người chơi sang "matching"
--    rồi mới tạo trận và chuyển sang "playing". Nếu edge function bị ngắt giữa
--    hai bước đó, người chơi kẹt ở "matching" vĩnh viễn: matchWaiting chỉ quét
--    status = 'waiting', và request_next_match cũng chỉ nhận ('result','waiting').
--
-- 2. "playing" mồ côi. Học sinh tải lại trang giữa trận, hoặc trận bị cron kết
--    thúc bất thường, có thể để lại status = 'playing' mà không còn trận nào
--    đang chạy — cũng kẹt vĩnh viễn.
--
-- Để gỡ kẹt theo thời gian, cần biết trạng thái đổi lúc nào. Cột dưới đây do
-- trigger tự duy trì nên mọi đường ghi (edge function, SQL tay) đều đúng.

alter table public.tournament_players
  add column if not exists status_changed_at timestamptz not null default now();

update public.tournament_players
set status_changed_at = coalesce(waiting_since, joined_at, now())
where status_changed_at is null;

create or replace function private.touch_player_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists tournament_players_touch_status on public.tournament_players;
create trigger tournament_players_touch_status
  before update on public.tournament_players
  for each row execute function private.touch_player_status();

-- Hàng chờ luôn được quét theo (tournament_id, status).
create index if not exists tournament_players_status_idx
  on public.tournament_players (tournament_id, status, status_changed_at);

comment on column public.tournament_players.status_changed_at is
  'Thời điểm status đổi lần cuối, do trigger duy trì. Dùng để gỡ người chơi kẹt ở matching.';
