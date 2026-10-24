-- 031_backfill_missing_logs.sql
-- TÙY CHỌN, chạy 1 lần sau 030: bổ sung log cho các giao dịch CŨ chưa có dòng nào trong payment_logs
-- (ví dụ các đơn thanh toán ngày 13/10, 15/10 trong ảnh). Chỉ thêm, không sửa / xóa log đang có.
-- Nên chạy phần SELECT trước để xem sẽ thêm những đơn nào.

-- Xem trước:
-- select id, client_name, photographer_name, package_price, deposit_paid_at
-- from public.bookings b
-- where b.deposit_paid_at is not null
--   and not exists (select 1 from public.payment_logs l where l.booking_id = b.id::text);

insert into public.payment_logs
  (provider, booking_id, amount, result, note, created_at,
   client_id, photographer_user_id, client_label, photographer_label, package_name, fee_amount)
select
  'system', b.id::text,
  case when coalesce(b.deposit_amount, 0) > 0 then b.deposit_amount else coalesce(b.package_price, 0) end,
  'manual',
  'Bổ sung log (backfill) cho giao dịch cũ chưa được ghi',
  b.deposit_paid_at,
  b.client_id, b.photographer_user_id, b.client_name, b.photographer_name, b.package_name,
  round(coalesce(b.package_price, 0) * 0.10)
from public.bookings b
where b.deposit_paid_at is not null
  and not exists (select 1 from public.payment_logs l where l.booking_id = b.id::text);
