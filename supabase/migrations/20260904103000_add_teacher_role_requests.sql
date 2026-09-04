-- Cho phép người dùng ĐỀ NGHỊ làm giáo viên ngay khi đăng ký, và bắt buộc
-- quản trị viên duyệt tay thì mới lên quyền.
--
-- Nguyên tắc giữ nguyên như trước: quyền thật luôn đọc từ
-- auth.users.raw_app_meta_data (chỉ service_role ghi được). Cột dưới đây chỉ là
-- ĐỀ NGHỊ đang chờ, tự nó không cấp quyền gì.
--
-- Người dùng cũng không tự ghi được cột này sau khi đăng ký: profiles chỉ
-- grant update (nickname, updated_at) cho authenticated, nên đường duy nhất để
-- tạo đề nghị là trigger lúc đăng ký, và đường duy nhất để duyệt là edge
-- function chạy bằng service_role.

alter table public.profiles
  add column if not exists requested_role text,
  add column if not exists requested_role_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_requested_role_check;

alter table public.profiles
  add constraint profiles_requested_role_check
  check (requested_role is null or requested_role = 'teacher');

comment on column public.profiles.requested_role is
  'Đề nghị nâng quyền đang chờ admin duyệt. Không phải quyền hiệu lực — quyền hiệu lực nằm ở cột role.';

-- Danh sách chờ duyệt luôn được lọc theo requested_role is not null.
create index if not exists profiles_pending_teacher_idx
  on public.profiles (requested_role_at)
  where requested_role is not null;

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
  pending_role text;
begin
  requested_nickname := trim(coalesce(new.raw_user_meta_data ->> 'nickname', split_part(new.email, '@', 1)));
  requested_nickname := left(regexp_replace(requested_nickname, '[^[:alnum:] _-]', '', 'g'), 20);
  if char_length(requested_nickname) < 2 then requested_nickname := 'Hoc sinh'; end if;

  -- Quyền hiệu lực: chỉ tin raw_app_meta_data (server/admin API mới ghi được).
  requested_role := case
    when new.raw_app_meta_data ->> 'role' in ('teacher', 'admin')
      then new.raw_app_meta_data ->> 'role'
    else 'student'
  end;
  force_password_change := coalesce((new.raw_app_meta_data ->> 'must_change_password')::boolean, false);

  -- Đề nghị làm giáo viên: đọc từ raw_user_meta_data (người dùng ghi được),
  -- nhưng chỉ ghi nhận để chờ duyệt. Tài khoản do admin tạo sẵn với quyền
  -- teacher/admin thì không cần đề nghị nữa.
  pending_role := case
    when requested_role = 'student'
      and new.raw_user_meta_data ->> 'requested_role' = 'teacher'
      then 'teacher'
    else null
  end;

  perform pg_advisory_xact_lock(hashtext(lower(requested_nickname)));
  if exists (select 1 from public.profiles where lower(nickname) = lower(requested_nickname)) then
    requested_nickname := left(requested_nickname, 15) || '-' || left(md5(new.id::text), 4);
  end if;

  insert into public.profiles (
    id, nickname, role, must_change_password, password_reset_at, mfa_required,
    requested_role, requested_role_at
  ) values (
    new.id, requested_nickname, requested_role, force_password_change,
    case when force_password_change then now() else null end,
    requested_role in ('teacher', 'admin'),
    pending_role,
    case when pending_role is not null then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
