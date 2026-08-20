# LSTS Caro Tourney

Nền tảng giải đấu Caro, Tic Tac Toe và Cờ vua dành cho lớp học.

## Luyện tập với máy

Trang `#/practice` hoạt động hoàn toàn trên trình duyệt và không thay đổi ELO:

- Caro 15×15: bot biết hoàn tất 5 quân, chặn nước thắng và đánh giá thế cờ.
- Tic-tac-toe: cấp Khó dùng minimax và không chủ động đi nước thua.
- Cờ vua: mọi nước đi được kiểm tra bằng `chess.js`; cấp Khó tìm kiếm có alpha-beta và đánh giá quân/thế đứng.
- Bốn cấp độ Dễ, Vừa, Khó, Siêu khó; chọn đi trước, đi sau hoặc ngẫu nhiên; hỗ trợ đi lại và thống kê luyện tập trên thiết bị.
- Siêu khó dùng minimax + alpha-beta pruning. Caro cắt tỉa tập nước ứng viên; Chess dùng iterative deepening và giới hạn thời gian trong Web Worker để giao diện không bị khóa.

Kiểm thử bot:

```bash
node client/src/utils/botEngine.test.js
```

## Kiến trúc production (chỉ 2 nền tảng)

- **GitHub**: lưu source, chạy GitHub Actions và host React/Vite bằng GitHub Pages.
- **Supabase**: Auth, Postgres, Realtime và Edge Function `game-api` có thẩm quyền xác thực nước đi.

Express/Socket.IO trong thư mục `server/` chỉ còn dùng để phát triển và chạy bộ test local; bản GitHub Pages dùng `VITE_GAME_BACKEND=supabase`.

## Chuẩn bị Supabase

1. Tạo một project Supabase riêng cho ứng dụng.
2. Chạy migration trong `supabase/migrations/` và deploy `supabase/functions/game-api`.
3. Tạo tài khoản admin đầu tiên bằng Supabase Dashboard/Management API rồi đặt `role = 'admin'` một lần. Sau đó admin quản lý toàn bộ tài khoản tại `/admin/accounts`.

```sql
update public.profiles
set role = 'admin', mfa_required = true, must_change_password = true
where id = (select id from auth.users where email = 'email-admin@example.com');
```

Không đưa `service_role`/secret key vào frontend hoặc GitHub Variables. Frontend chỉ dùng publishable key.

## Bảo mật tài khoản

- Admin tạo học sinh/giáo viên bằng mật khẩu tạm; người dùng bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên.
- Mật khẩu tối thiểu 10 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.
- Admin và giáo viên bắt buộc đăng ký TOTP MFA và đạt mức AAL2 trước khi dùng chức năng đặc quyền.
- Trang `/admin/accounts` cho phép admin tạo tài khoản, khóa/mở khóa học sinh và cấp mật khẩu tạm mới.
- Edge Function kiểm tra khóa tài khoản, trạng thái đổi mật khẩu và AAL2 ở phía server; không chỉ dựa vào giao diện.

Supabase Leaked Password Protection cần được bật trong **Authentication → Password Security** khi project sử dụng gói hỗ trợ tính năng này.

## Mùa giải và ELO học kỳ

- Admin tạo và kích hoạt mùa giải tại `/admin/accounts` → **Mùa giải**.
- Mỗi môn có ELO riêng theo mùa; bảng xếp hạng mùa không làm mất lịch sử các học kỳ trước.
- 5 trận đầu là placement (`K=48`), trận 6–10 là provisional (`K=32`), sau đó ổn định (`K=24`, hoặc `K=16` ở nhóm ELO cao).
- Biến động được giới hạn: placement tối đa `±32`, ổn định `±20`, nhóm cao thủ `±12`; tổng ELO của hai người trong một trận luôn zero-sum.
- Giải luyện tập hoặc trận đấu với bot không cập nhật ELO.

## Xử lý timeout không phụ thuộc trình duyệt

Migration thiết lập `pg_cron` + `pg_net` gọi Edge Function mỗi phút. Cron dùng một `CRON_SECRET` riêng trong Vault và Edge Function Secrets; không lưu secret trong repository. Vì vậy trận hết giờ vẫn được xử lý khi cả hai trình duyệt đã đóng.

## Cấu hình GitHub

Trong repository **Settings → Secrets and variables → Actions**:

Variables:

- `SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`

Trong **Settings → Pages**, chọn source **GitHub Actions**. Khi push lên `master`, workflow `.github/workflows/deploy-github-supabase.yml` sẽ áp dụng migration, deploy Edge Function, build và deploy GitHub Pages.

## Chạy local với Node test server

```bash
npm install
npm install --prefix client
npm install --prefix server
npm run dev
```

Mở `http://localhost:5173`. Bộ test spectator:

```bash
node server/test_spectator.js
```

## Chạy frontend local với Supabase

Tạo `client/.env.local`:

```env
VITE_GAME_BACKEND=supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
```

Sau đó chạy `npm run dev --prefix client`.
