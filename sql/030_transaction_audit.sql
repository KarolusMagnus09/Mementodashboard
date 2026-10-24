-- 030_transaction_audit.sql
-- Mục tiêu: MỌI giao dịch tiền trên bảng bookings đều tự có 1 dòng trong payment_logs,
-- kèm tài khoản khách / PTG / admin thao tác và phí Memento — bất kể thao tác đi từ trang
-- admin, app hay webhook. Ghi ở tầng database nên không thể "quên" log.
--
-- An toàn: chạy lại nhiều lần được (idempotent). Việc ghi log nằm trong khối EXCEPTION,
-- nếu log lỗi thì chỉ cảnh báo, KHÔNG làm hỏng việc cập nhật đơn.
-- LƯU Ý: HẰNG SỐ phí 10% phải khớp COMMISSION_RATE trong src/lib/payout.ts.

-- 1) Cột bổ sung cho payment_logs (cột cũ giữ nguyên)
alter table public.payment_logs add column if not exists client_id            uuid;
alter table public.payment_logs add column if not exists photographer_user_id uuid;
alter table public.payment_logs add column if not exists client_label         text;
alter table public.payment_logs add column if not exists photographer_label   text;
alter table public.payment_logs add column if not exists package_name         text;
alter table public.payment_logs add column if not exists fee_amount           numeric;
alter table public.payment_logs add column if not exists actor_id             uuid;
alter table public.payment_logs add column if not exists actor_email          text;

-- LƯU Ý: payment_logs.booking_id kiểu text, bookings.id kiểu uuid → luôn so sánh/ghi bằng id::text
create index if not exists payment_logs_booking_id_idx on public.payment_logs (booking_id);

-- 2) Hàm ghi log (security definer → bỏ qua RLS của bảng payment_logs)
create or replace function public.log_booking_money_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate   constant numeric := 0.10;   -- = COMMISSION_RATE trong payout.ts
  v_price  numeric := coalesce(new.package_price, 0);
  v_paid   numeric := case when coalesce(new.deposit_amount, 0) > 0 then new.deposit_amount else v_price end;
  v_actor  uuid    := auth.uid();
  v_email  text    := nullif(auth.jwt() ->> 'email', '');
  v_src    text    := case when v_actor is null then 'system' else 'admin' end;
begin
  begin
    -- (a) Khách đã thanh toán (deposit_paid_at từ trống -> có giá trị)
    if new.deposit_paid_at is not null
       and (tg_op = 'INSERT' or old.deposit_paid_at is null)
       and not exists (
         select 1 from payment_logs
         where booking_id = new.id::text and result in ('matched', 'manual')
       )
    then
      insert into payment_logs (provider, booking_id, amount, result, note, created_at,
                                client_id, photographer_user_id, client_label, photographer_label,
                                package_name, fee_amount, actor_id, actor_email)
      values (v_src, new.id::text, v_paid, 'manual',
              'Tự ghi log: khách đã thanh toán', coalesce(new.deposit_paid_at, now()),
              new.client_id, new.photographer_user_id, new.client_name, new.photographer_name,
              new.package_name, round(v_price * v_rate), v_actor, v_email);
    end if;

    -- (b) Admin ứng cọc cho PTG
    if new.ptg_advance_paid_at is not null
       and (tg_op = 'INSERT' or old.ptg_advance_paid_at is null)
       and not exists (
         select 1 from payment_logs where booking_id = new.id::text and result = 'payout_advance'
       )
    then
      insert into payment_logs (provider, booking_id, amount, result, note, created_at,
                                client_id, photographer_user_id, client_label, photographer_label,
                                package_name, fee_amount, actor_id, actor_email)
      values (v_src, new.id::text, round(v_price * 0.2), 'payout_advance',
              'Tự ghi log: ứng cọc cho PTG ' || coalesce(new.photographer_name, ''),
              coalesce(new.ptg_advance_paid_at, now()),
              new.client_id, new.photographer_user_id, new.client_name, new.photographer_name,
              new.package_name, null, v_actor, v_email);
    end if;

    -- (c) Admin quyết toán nốt cho PTG (phí Memento được ghi nhận ở bước này)
    if new.ptg_final_paid_at is not null
       and (tg_op = 'INSERT' or old.ptg_final_paid_at is null)
       and not exists (
         select 1 from payment_logs where booking_id = new.id::text and result = 'payout_final'
       )
    then
      insert into payment_logs (provider, booking_id, amount, result, note, created_at,
                                client_id, photographer_user_id, client_label, photographer_label,
                                package_name, fee_amount, actor_id, actor_email)
      values (v_src, new.id::text, round(v_price * (1 - v_rate - 0.2)), 'payout_final',
              'Tự ghi log: quyết toán PTG ' || coalesce(new.photographer_name, '') ||
              ' · Memento giữ phí ' || round(v_price * v_rate)::text || 'đ',
              coalesce(new.ptg_final_paid_at, now()),
              new.client_id, new.photographer_user_id, new.client_name, new.photographer_name,
              new.package_name, round(v_price * v_rate), v_actor, v_email);
    end if;
  exception when others then
    raise warning 'log_booking_money_events: không ghi được log cho đơn %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_log_booking_money_events on public.bookings;
create trigger trg_log_booking_money_events
after insert or update of deposit_paid_at, ptg_advance_paid_at, ptg_final_paid_at
on public.bookings
for each row execute function public.log_booking_money_events();
