-- 022: Tự động ghi nhận thanh toán (webhook ngân hàng) + log + theo dõi chuyển tiền cho photographer
--      + duyệt đổi TK ngân hàng bằng RPC (không bị RLS chặn)
-- Chạy trong Supabase → SQL Editor. Cần đã chạy 014 (hàm is_admin()).

-- ── 1) Cột theo dõi chuyển tiền cho photographer ────────────────────────────
alter table public.bookings
  add column if not exists ptg_advance_paid_at timestamptz,
  add column if not exists ptg_advance_ref text,
  add column if not exists ptg_final_paid_at timestamptz,
  add column if not exists ptg_final_ref text;

-- ── 2) Bảng log mọi giao dịch / thao tác tiền ──────────────────────────────
create table if not exists public.payment_logs (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'manual',          -- sepay | manual | admin
  provider_tx_id text,                              -- id giao dịch của ngân hàng/SePay (chống ghi trùng)
  booking_id text,
  bill_code text,
  amount bigint not null default 0,
  content text,                                     -- nội dung chuyển khoản
  result text not null default 'processing',        -- matched | unmatched | underpaid | ignored | manual | payout_advance | payout_final
  note text,
  raw jsonb,
  actor uuid,                                       -- admin thao tác tay (null nếu tự động)
  created_at timestamptz not null default now()
);

create unique index if not exists payment_logs_provider_tx_uq
  on public.payment_logs (provider, provider_tx_id)
  where provider_tx_id is not null;

alter table public.payment_logs enable row level security;

drop policy if exists "payment_logs_select_admin" on public.payment_logs;
create policy "payment_logs_select_admin" on public.payment_logs
  for select using (public.is_admin());
-- Không có policy insert/update: chỉ hàm security definer / service_role mới ghi được.

-- ── 3) Webhook gọi hàm này: khớp mã MMT-XXXXXXXX → đánh dấu đã thanh toán ──
create or replace function public.apply_bank_transaction(
  p_provider text,
  p_tx_id text,
  p_amount bigint,
  p_content text,
  p_raw jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log uuid;
  v_code text;
  v_b public.bookings%rowtype;
  v_need bigint;
  v_result text;
  v_note text;
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
    select * into v_b
    from public.bookings
    where replace(lower(id::text), '-', '') like lower(v_code) || '%'
    order by created_at desc
    limit 1;

    if not found then
      v_result := 'unmatched'; v_note := 'Không tìm thấy lịch hẹn mã ' || v_code;
    else
      v_need := coalesce(nullif(v_b.deposit_amount, 0), v_b.package_price)::bigint;

      if v_b.deposit_paid_at is not null
         or v_b.status in ('deposit_paid','handover','final_payment','completed','paid') then
        v_result := 'ignored'; v_note := 'Lịch hẹn đã được thanh toán trước đó (có thể chuyển trùng — cần hoàn tiền?)';
      elsif v_b.status <> 'confirmed' then
        v_result := 'ignored'; v_note := 'Lịch hẹn đang ở trạng thái "' || v_b.status || '" nên không tự xác nhận — cần xử lý tay/hoàn tiền';
      elsif coalesce(p_amount, 0) < v_need then
        v_result := 'underpaid'; v_note := 'Thiếu tiền: cần ' || v_need || ', nhận ' || coalesce(p_amount, 0);
      else
        update public.bookings
        set status = 'deposit_paid',
            payment_status = 'deposit_paid',
            deposit_paid_at = now(),
            paid_at = now(),
            payment_ref = 'MMT-' || v_code,
            updated_at = now()
        where id = v_b.id;
        v_result := 'matched';
        v_note := case when p_amount > v_need then 'Khách chuyển dư ' || (p_amount - v_need) else 'Đủ tiền' end;
      end if;
    end if;
  end if;

  update public.payment_logs
  set booking_id = v_b.id::text,
      bill_code = case when v_code is null then null else 'MMT-' || v_code end,
      result = v_result,
      note = v_note
  where id = v_log;

  return jsonb_build_object('ok', true, 'result', v_result, 'booking_id', v_b.id, 'note', v_note);
end;
$$;

revoke all on function public.apply_bank_transaction(text, text, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_bank_transaction(text, text, bigint, text, jsonb) to service_role;

-- ── 4) Admin đánh dấu tay (dự phòng khi webhook lỗi) — có ghi log ───────────
create or replace function public.admin_mark_booking_paid(p_booking_id text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_b public.bookings%rowtype;
begin
  if not public.is_admin() then raise exception 'Forbidden: admin only'; end if;

  select * into v_b from public.bookings where id::text = p_booking_id;
  if not found then raise exception 'Không tìm thấy lịch hẹn'; end if;
  if v_b.deposit_paid_at is not null then raise exception 'Lịch hẹn này đã được ghi nhận thanh toán'; end if;

  update public.bookings
  set status = 'deposit_paid',
      payment_status = 'deposit_paid',
      deposit_paid_at = now(),
      paid_at = now(),
      payment_ref = 'MMT-' || upper(left(replace(id::text, '-', ''), 8)),
      updated_at = now()
  where id = v_b.id;

  insert into public.payment_logs (provider, booking_id, bill_code, amount, content, result, note, actor)
  values ('admin', v_b.id::text, 'MMT-' || upper(left(replace(v_b.id::text, '-', ''), 8)),
          coalesce(nullif(v_b.deposit_amount, 0), v_b.package_price)::bigint,
          null, 'manual', coalesce(p_note, 'Admin đánh dấu đã nhận tiền'), auth.uid());
end;
$$;
grant execute on function public.admin_mark_booking_paid(text, text) to authenticated;

-- ── 5) Admin ghi nhận đã chuyển tiền cho photographer (ứng 30% / quyết toán) ─
create or replace function public.admin_mark_ptg_payout(p_booking_id text, p_kind text, p_ref text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.bookings%rowtype;
  v_adv bigint; v_total bigint; v_amt bigint;
begin
  if not public.is_admin() then raise exception 'Forbidden: admin only'; end if;
  if p_kind not in ('advance', 'final') then raise exception 'p_kind phải là advance hoặc final'; end if;

  select * into v_b from public.bookings where id::text = p_booking_id;
  if not found then raise exception 'Không tìm thấy lịch hẹn'; end if;
  if v_b.deposit_paid_at is null then raise exception 'Khách chưa thanh toán lịch hẹn này'; end if;

  v_adv   := round(v_b.package_price * 0.3);
  v_total := round(v_b.package_price * 0.9);

  if p_kind = 'advance' then
    if v_b.ptg_advance_paid_at is not null then raise exception 'Đã chuyển ứng 30% rồi'; end if;
    v_amt := v_adv;
    update public.bookings
    set ptg_advance_paid_at = now(), ptg_advance_ref = p_ref, updated_at = now()
    where id = v_b.id;
  else
    if v_b.ptg_final_paid_at is not null then raise exception 'Đã quyết toán rồi'; end if;
    if v_b.status <> 'completed' then raise exception 'Chỉ quyết toán khi lịch hẹn đã hoàn tất'; end if;
    v_amt := v_total - v_adv;
    update public.bookings
    set ptg_final_paid_at = now(), ptg_final_ref = p_ref, updated_at = now()
    where id = v_b.id;
  end if;

  insert into public.payment_logs (provider, booking_id, amount, result, note, actor)
  values ('admin', v_b.id::text, v_amt,
          case when p_kind = 'advance' then 'payout_advance' else 'payout_final' end,
          'Chuyển cho ' || coalesce(v_b.photographer_name, 'photographer') || coalesce(' · ref ' || p_ref, ''),
          auth.uid());
end;
$$;
grant execute on function public.admin_mark_ptg_payout(text, text, text) to authenticated;

-- ── 6) Duyệt đổi TK ngân hàng (áp dụng được cả khi hồ sơ đã approved) ──────
do $$
begin
  if to_regclass('public.bank_change_requests') is not null then
    alter table public.bank_change_requests
      add column if not exists admin_note text,
      add column if not exists reviewed_at timestamptz;
  end if;
end $$;

create or replace function public.admin_review_bank_change(p_request_id text, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r public.bank_change_requests%rowtype;
begin
  if not public.is_admin() then raise exception 'Forbidden: admin only'; end if;

  select * into r from public.bank_change_requests where id::text = p_request_id;
  if not found then raise exception 'Không tìm thấy yêu cầu'; end if;
  if r.status <> 'pending' then raise exception 'Yêu cầu này đã được xử lý'; end if;

  update public.bank_change_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_at = now(),
      admin_note = p_note
  where id = r.id;

  if p_approve then
    update public.photographer_applications
    set bank_name = r.bank_name, bank_code = r.bank_code,
        bank_account = r.bank_account, bank_account_name = r.bank_account_name
    where user_id = r.user_id;

    update public.photographers
    set bank_name = r.bank_name, bank_code = r.bank_code,
        bank_account = r.bank_account, bank_account_name = r.bank_account_name
    where user_id = r.user_id;
  end if;
end;
$$;
grant execute on function public.admin_review_bank_change(text, boolean, text) to authenticated;
