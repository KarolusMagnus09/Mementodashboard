-- =====================================================================
-- 041_sepay_hardening.sql
-- Sửa 3 lỗi của luồng SePay tự xác nhận đơn (022_payments_auto.sql):
--   1) bookings.payment_status chỉ cho 'unpaid'/'paid' → webhook ghi 'deposit_paid' bị từ chối
--   2) mỗi giao dịch webhook sinh 2 dòng log (matched + 'manual' do trigger 030 tự ghi thêm)
--   3) khách chuyển thiếu rồi chuyển bù thì không được cộng dồn
-- Chạy trong Supabase → SQL Editor SAU 022 và 030. Chạy lại nhiều lần được.
-- =====================================================================

-- 1) Mở ràng buộc payment_status (NOT VALID: không quét/chặn dữ liệu cũ, chỉ áp cho ghi mới)
alter table public.bookings drop constraint if exists bookings_payment_status_check;
alter table public.bookings add constraint bookings_payment_status_check
  check (payment_status is null
         or payment_status in ('unpaid', 'paid', 'deposit_paid', 'fully_paid')) not valid;

-- 2) + 3) Viết lại hàm webhook
create or replace function public.apply_bank_transaction(
  p_provider text,
  p_tx_id    text,
  p_amount   bigint,
  p_content  text,
  p_raw      jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log     uuid;
  v_code    text;
  v_b       public.bookings%rowtype;
  v_found   boolean := false;
  v_need    bigint;
  v_prior   bigint := 0;
  v_total   bigint;
  v_result  text;
  v_note    text;
begin
  -- Ghi log trước; trùng (provider, tx_id) → bỏ qua (SePay có thể gửi lại)
  insert into public.payment_logs (provider, provider_tx_id, amount, content, raw)
  values (coalesce(p_provider, 'sepay'), p_tx_id, coalesce(p_amount, 0), p_content, p_raw)
  on conflict (provider, provider_tx_id) where provider_tx_id is not null do nothing
  returning id into v_log;

  if v_log is null then
    return jsonb_build_object('ok', true, 'result', 'duplicate');
  end if;

  -- Bank có thể bỏ dấu gạch: "MMT-DFFCCB95C" hoặc "MMTDFFCCB95C"
  v_code := substring(upper(coalesce(p_content, '')) from 'MMT-?([A-Z0-9]{8})');

  if v_code is null then
    v_result := 'unmatched'; v_note := 'Nội dung CK không có mã MMT-XXXXXXXX';
  else
    -- Khoá dòng để 2 webhook cùng đơn không chạy song song
    select * into v_b
      from public.bookings
     where replace(lower(id::text), '-', '') like lower(v_code) || '%'
     order by created_at desc
     limit 1
       for update;
    v_found := found;

    if not v_found then
      v_result := 'unmatched'; v_note := 'Không tìm thấy lịch hẹn mã ' || v_code;
    else
      v_need := coalesce(nullif(v_b.deposit_amount, 0), v_b.package_price)::bigint;

      -- Các lần chuyển thiếu trước đó của cùng đơn (chưa được gộp)
      select coalesce(sum(amount), 0) into v_prior
        from public.payment_logs
       where booking_id = v_b.id::text and result = 'underpaid' and id <> v_log;
      v_total := coalesce(p_amount, 0) + v_prior;

      if v_b.deposit_paid_at is not null
         or v_b.status in ('deposit_paid','handover','final_payment','completed','paid','processing','active','closing') then
        v_result := 'ignored';
        v_note := 'Lịch hẹn đã được thanh toán trước đó (có thể chuyển trùng — cần hoàn tiền?)';
      elsif v_b.status <> 'confirmed' then
        v_result := 'ignored';
        v_note := 'Lịch hẹn đang ở trạng thái "' || v_b.status || '" nên không tự xác nhận — cần xử lý tay/hoàn tiền';
      elsif v_total < v_need then
        v_result := 'underpaid';
        v_note := 'Thiếu tiền: cần ' || v_need || ', đã nhận ' || v_total
                  || ' (còn thiếu ' || (v_need - v_total) || '). Khách chuyển bù cùng nội dung, hệ thống tự cộng dồn';
      else
        v_result := 'matched';
        v_note := case
          when v_prior > 0 then 'Đủ tiền sau khi cộng dồn ' || v_prior || ' (lần chuyển trước) + ' || coalesce(p_amount, 0)
          when v_total > v_need then 'Khách chuyển dư ' || (v_total - v_need)
          else 'Đủ tiền'
        end;
      end if;
    end if;
  end if;

  -- Cập nhật log TRƯỚC khi sửa bookings: trigger log_booking_money_events (030) thấy đã có
  -- dòng 'matched' của đơn này nên không ghi thêm dòng 'manual' trùng.
  update public.payment_logs
     set booking_id = case when v_found then v_b.id::text else null end,
         bill_code  = case when v_code is null then null else 'MMT-' || v_code end,
         result     = v_result,
         note       = v_note
   where id = v_log;

  if v_result = 'matched' then
    -- Các lần chuyển thiếu trước đó đã được gộp → không còn là "cần xem"
    update public.payment_logs
       set result = 'matched',
           note   = 'Đã gộp vào giao dịch bù ' || coalesce(p_tx_id, v_log::text)
     where booking_id = v_b.id::text and result = 'underpaid' and id <> v_log;

    update public.bookings
       set status          = 'deposit_paid',
           payment_status  = 'deposit_paid',
           deposit_paid_at = now(),
           paid_at         = now(),
           payment_ref     = 'MMT-' || v_code,
           updated_at      = now()
     where id = v_b.id;
  end if;

  return jsonb_build_object(
    'ok', true, 'result', v_result,
    'booking_id', case when v_found then v_b.id::text else null end,
    'note', v_note
  );
end;
$$;

revoke all on function public.apply_bank_transaction(text, text, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_bank_transaction(text, text, bigint, text, jsonb) to service_role;
