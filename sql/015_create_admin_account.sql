-- =============================================================================
-- GÁN QUYỀN ADMIN cho 1 tài khoản (chạy SAU khi user đã tồn tại trong Auth)
-- =============================================================================
-- Bước 1: Supabase Dashboard → Authentication → Users → "Add user"
--         Email: admin@memento.local  (hoặc email thật của bạn)
--         Password: (đặt mật khẩu mạnh)
--         Tick "Auto Confirm User"
--
-- Bước 2: Đổi email bên dưới rồi Run:

update public.profiles
set role = 'admin'
where id = (
  select id from auth.users
  where email = 'admin@memento.local'   -- ← ĐỔI EMAIL NÀY
  limit 1
);

-- Kiểm tra:
select p.id, u.email, p.role, p.full_name
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'admin';
