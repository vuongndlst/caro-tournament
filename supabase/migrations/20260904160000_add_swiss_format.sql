-- Thể thức Thụy Sĩ (Swiss) cho giải đấu trong lớp.
--
-- Vì sao chọn Thụy Sĩ thay vì vòng bảng + loại trực tiếp: không ai bị loại sớm
-- phải ngồi chơi hết buổi, mọi học sinh đấu đúng số trận như nhau, và sĩ số
-- không cần chia hết cho 4 hay là luỹ thừa của 2.
--
-- Cách chạy: mỗi vòng ghép TẤT CẢ học sinh cùng lúc, ưu tiên người cùng điểm
-- gặp nhau và tránh tái đấu. Hết vòng cuối, ai nhiều điểm nhất là vô địch.
--
-- Thể thức 'auto' (ghép liên tục như cũ) vẫn là mặc định, không đổi hành vi.

alter table public.tournaments
  add column if not exists format text not null default 'auto',
  add column if not exists total_rounds integer,
  add column if not exists current_round integer not null default 0;

alter table public.tournaments
  drop constraint if exists tournaments_format_check;
alter table public.tournaments
  add constraint tournaments_format_check check (format in ('auto', 'swiss'));

alter table public.tournaments
  drop constraint if exists tournaments_total_rounds_check;
alter table public.tournaments
  add constraint tournaments_total_rounds_check
  check (
    (format = 'auto' and total_rounds is null)
    or (format = 'swiss' and total_rounds between 3 and 9)
  );

alter table public.tournaments
  drop constraint if exists tournaments_current_round_check;
alter table public.tournaments
  add constraint tournaments_current_round_check
  check (current_round >= 0 and (total_rounds is null or current_round <= total_rounds));

-- Trận thuộc vòng nào (null với thể thức auto).
alter table public.matches
  add column if not exists round integer;

create index if not exists matches_round_idx
  on public.matches (tournament_id, round, status);

-- Số lần được miễn đấu. Khi sĩ số lẻ, mỗi vòng có đúng một em được miễn; ưu
-- tiên em chưa từng được miễn để không ai bị miễn hai lần trong khi người khác
-- chưa lần nào.
alter table public.tournament_players
  add column if not exists byes integer not null default 0;

comment on column public.tournaments.format is
  'auto = ghép liên tục (mặc định); swiss = đấu theo vòng, hết vòng cuối lấy người dẫn đầu làm vô địch.';
comment on column public.tournament_players.byes is
  'Số vòng được miễn đấu do sĩ số lẻ. Mỗi lần miễn được cộng điểm như một trận thắng nhưng không tính ELO.';
