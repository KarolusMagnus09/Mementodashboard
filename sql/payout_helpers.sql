-- ─────────────────────────────────────────────────────────────
-- 1) (Tuỳ chọn) Gắn lại photographer_user_id cho các đơn cũ bị trống.
--    Đơn thiếu cột này thì dashboard (và chat) không biết PTG là ai.
-- ─────────────────────────────────────────────────────────────
update public.bookings b
set photographer_user_id = p.user_id
from public.photographers p
where b.photographer_user_id is null
  and b.photographer_id = p.id
  and p.user_id is not null;

-- Còn đơn nào vẫn trống? (PTG đó chưa liên kết tài khoản — phải gắn tay hoặc nhờ PTG đăng nhập/liên kết)
select id, status, photographer_id, photographer_name, created_at
from public.bookings
where photographer_user_id is null
order by created_at desc;

-- ─────────────────────────────────────────────────────────────
-- 2) Các đơn đang chờ chi tiền và PTG của chúng đã có STK chưa
-- ─────────────────────────────────────────────────────────────
select b.id, b.status, b.photographer_name,
       a.bank_code  as app_bank,  a.bank_account  as app_acc,
       p.bank_code  as ptg_bank,  p.bank_account  as ptg_acc
from public.bookings b
left join public.photographer_applications a on a.user_id = b.photographer_user_id
left join public.photographers p on p.user_id = b.photographer_user_id
where b.status in ('processing', 'closing');

-- ─────────────────────────────────────────────────────────────
-- 3) KIỂM TRA BẢO MẬT: ai đang đọc được cột ngân hàng?
--    Nếu 'anon' hoặc 'authenticated' có SELECT trên bank_account của bảng photographers
--    VÀ policy của bảng cho đọc mọi dòng, thì mọi người dùng đều thấy STK của mọi photographer.
-- ─────────────────────────────────────────────────────────────
select table_name, column_name, grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in ('photographers', 'photographer_applications')
  and column_name like 'bank%'
  and grantee in ('anon', 'authenticated')
  and privilege_type = 'SELECT'
order by table_name, column_name, grantee;

select tablename, policyname, roles, cmd, qual
from pg_policies
where tablename in ('photographers', 'photographer_applications');
