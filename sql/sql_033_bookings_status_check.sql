-- 033: Mở rộng bookings.status CHECK để pipeline admin hoạt động
-- Chạy trong Supabase SQL Editor. An toàn khi chạy lại.

alter table public.bookings drop constraint if exists bookings_status_check;

alter table public.bookings add constraint bookings_status_check
  check (status in (
    'pending',
    'confirmed',
    'processing',
    'active',
    'deposit_paid',
    'handover',
    'closing',
    'final_payment',
    'completed',
    'rejected',
    'cancelled',
    'paid'
  ));

-- Ghi chú: app có thể dùng deposit_paid thay processing nếu constraint cũ chưa cập nhật.
