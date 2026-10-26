-- =====================================================================
-- 050_notifications.sql  —  Hệ thống thông báo dùng chung (app + dashboard)
-- Chạy 1 lần trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn.
-- Mọi trigger đều bọc EXCEPTION: nếu tạo thông báo lỗi thì đơn hàng VẪN chạy bình thường.
-- =====================================================================

-- 1) Bảng thông báo --------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null,
  tab         text not null default 'messages' check (tab in ('bookings','messages')),
  title       text not null,
  body        text not null default '',
  booking_id  uuid,
  data        jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx  on public.notifications (user_id, tab) where read_at is null;

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists notifications_delete_own on public.notifications;
create policy notifications_delete_own on public.notifications
  for delete to authenticated using (user_id = auth.uid());

-- Client không tự INSERT/UPDATE được (chỉ trigger + RPC bên dưới)
revoke insert, update on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;

-- Bật Realtime
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- 2) Token thiết bị (push điện thoại) --------------------------------
create table if not exists public.device_tokens (
  token       text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text not null default 'android',
  updated_at  timestamptz not null default now()
);
create index if not exists device_tokens_user_idx on public.device_tokens (user_id);
alter table public.device_tokens enable row level security;
revoke all on public.device_tokens from anon, authenticated;   -- chỉ qua RPC / service_role

create or replace function public.register_device_token(p_token text, p_platform text default 'android')
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(p_token,'') = '' then return; end if;
  insert into public.device_tokens(token, user_id, platform, updated_at)
  values (p_token, auth.uid(), coalesce(p_platform,'android'), now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;

create or replace function public.unregister_device_token(p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.device_tokens where token = p_token and user_id = auth.uid();
end $$;

grant execute on function public.register_device_token(text, text) to authenticated;
grant execute on function public.unregister_device_token(text) to authenticated;

-- 3) RPC đánh dấu đã đọc --------------------------------------------
-- p_ids: các thông báo cụ thể | p_tab: cả 1 tab ('bookings'/'messages') | bỏ trống: tất cả
create or replace function public.mark_notifications_read(p_ids uuid[] default null, p_tab text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then return 0; end if;
  update public.notifications
     set read_at = now()
   where user_id = auth.uid() and read_at is null
     and (p_ids is null or id = any(p_ids))
     and (p_tab is null or tab = p_tab);
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.mark_notifications_read(uuid[], text) to authenticated;

-- 4) Hàm nội bộ ------------------------------------------------------
create or replace function public.notif_push(
  p_user uuid, p_type text, p_tab text, p_title text, p_body text,
  p_booking uuid default null, p_data jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications(user_id, type, tab, title, body, booking_id, data)
  values (p_user, p_type, p_tab, p_title, p_body, p_booking, coalesce(p_data, '{}'::jsonb));
end $$;

create or replace function public.notif_push_admins(
  p_type text, p_title text, p_body text, p_booking uuid default null, p_data jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.profiles where role = 'admin' loop
    perform public.notif_push(r.id, p_type, 'bookings', p_title, p_body, p_booking, p_data);
  end loop;
exception when others then
  raise warning 'notif_push_admins: %', sqlerrm;
end $$;

revoke execute on function public.notif_push(uuid, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.notif_push_admins(text, text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.notif_vnd(n numeric) returns text language sql immutable as $$
  select regexp_replace(round(coalesce(n, 0))::text, '\B(?=(\d{3})+(?!\d))', '.', 'g') || 'đ'
$$;

create or replace function public.notif_bill(p_id uuid) returns text language sql immutable as $$
  select 'MMT-' || upper(left(replace(p_id::text, '-', ''), 8))
$$;

-- 5) Trigger: đặt lịch mới -------------------------------------------
create or replace function public.trg_notif_booking_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  begin
    who := coalesce(
      nullif(trim(new.client_name), ''),
      (select nullif(trim(full_name), '') from public.profiles where id = new.client_id),
      'Một khách hàng');
    perform public.notif_push(new.photographer_user_id, 'booking_new', 'bookings',
      'Có yêu cầu đặt lịch mới',
      who || ' muốn đặt gói "' || coalesce(new.package_name, '') || '" ngày ' ||
        coalesce(to_char(new.booking_date::date, 'DD/MM/YYYY'), '') || '. Hãy xác nhận sớm nhé!',
      new.id, jsonb_build_object('code', public.notif_bill(new.id)));
  exception when others then
    raise warning 'trg_notif_booking_insert: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists notif_booking_insert on public.bookings;
create trigger notif_booking_insert after insert on public.bookings
  for each row execute function public.trg_notif_booking_insert();

-- 6) Trigger: đơn đổi trạng thái / có tiến triển ----------------------
create or replace function public.trg_notif_booking_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  code  text    := public.notif_bill(new.id);
  ptg   text    := coalesce(nullif(trim(new.photographer_name), ''), 'Photographer');
  cli   text    := coalesce(nullif(trim(new.client_name), ''), 'Khách hàng');
  d     jsonb   := jsonb_build_object('code', public.notif_bill(new.id));
  price numeric := coalesce(new.package_price, 0);
  actor uuid    := auth.uid();
begin
  begin
    -- PTG chấp nhận
    if old.status is distinct from new.status and new.status = 'confirmed' then
      perform public.notif_push(new.client_id, 'booking_accepted', 'bookings',
        'Đơn của bạn đã được chấp nhận 🎉',
        'Xin chúc mừng! Đơn ' || code || ' đã được Photographer ' || ptg || ' chấp nhận. Vui lòng thanh toán để giữ lịch.',
        new.id, d);
    end if;

    -- PTG từ chối
    if old.status is distinct from new.status and new.status = 'rejected' then
      perform public.notif_push(new.client_id, 'booking_rejected', 'bookings',
        'Đơn của bạn đã bị từ chối',
        'Rất tiếc, Photographer ' || ptg || ' không thể nhận đơn ' || code || '. Bạn có thể chọn nhiếp ảnh gia khác.',
        new.id, d);
    end if;

    -- Hủy đơn: báo cho bên còn lại
    if old.status is distinct from new.status and new.status = 'cancelled' then
      if actor is not null and actor = new.client_id then
        perform public.notif_push(new.photographer_user_id, 'booking_cancelled', 'bookings',
          'Đơn đã bị hủy', cli || ' đã hủy đơn ' || code || '.', new.id, d);
      elsif actor is not null and actor = new.photographer_user_id then
        perform public.notif_push(new.client_id, 'booking_cancelled', 'bookings',
          'Đơn đã bị hủy', 'Photographer ' || ptg || ' đã hủy đơn ' || code || '.', new.id, d);
      else
        perform public.notif_push(new.client_id, 'booking_cancelled', 'bookings',
          'Đơn đã bị hủy', 'Đơn ' || code || ' đã bị hủy.', new.id, d);
        perform public.notif_push(new.photographer_user_id, 'booking_cancelled', 'bookings',
          'Đơn đã bị hủy', 'Đơn ' || code || ' đã bị hủy.', new.id, d);
      end if;
    end if;

    -- Khách thanh toán thành công
    if old.deposit_paid_at is null and new.deposit_paid_at is not null then
      perform public.notif_push(new.client_id, 'payment_ok', 'bookings',
        'Thanh toán thành công ✅',
        'Memento đã nhận ' || public.notif_vnd(coalesce(new.deposit_amount, price)) || ' cho đơn ' || code || '.',
        new.id, d);
      perform public.notif_push(new.photographer_user_id, 'payment_ok_ptg', 'bookings',
        'Khách đã thanh toán',
        cli || ' đã thanh toán đơn ' || code || '. Memento sẽ ứng 20% (' || public.notif_vnd(price * 0.2) || ') cho bạn.',
        new.id, d);
      perform public.notif_push_admins('admin_paid', 'Có đơn mới đã thanh toán',
        'Đơn ' || code || ' đã thanh toán ' || public.notif_vnd(coalesce(new.deposit_amount, price)) || ' — cần ứng 20% cho PTG.',
        new.id, d);
    end if;

    -- Memento ứng 20% cho PTG
    if old.ptg_advance_paid_at is null and new.ptg_advance_paid_at is not null then
      perform public.notif_push(new.photographer_user_id, 'ptg_advance', 'bookings',
        'Đã ứng 20% cho bạn 💸',
        'Memento đã chuyển ' || public.notif_vnd(price * 0.2) || ' cho đơn ' || code || '. Đơn đã chính thức có hiệu lực.',
        new.id, d);
      perform public.notif_push(new.client_id, 'order_active', 'bookings',
        'Đơn của bạn đã có hiệu lực',
        'Photographer ' || ptg || ' đã được Memento ứng cọc. Hẹn gặp bạn đúng ngày chụp nhé!',
        new.id, d);
    end if;

    -- PTG báo đã chụp xong
    if old.shoot_done_at is null and new.shoot_done_at is not null then
      perform public.notif_push(new.client_id, 'shoot_done', 'bookings',
        'Buổi chụp đã hoàn thành',
        'Photographer ' || ptg || ' báo đã chụp xong đơn ' || code || '. Ảnh sẽ được bàn giao sớm.',
        new.id, d);
    end if;

    -- PTG bàn giao ảnh (gửi / đổi link Drive)
    if (old.drive_submitted_at is null and new.drive_submitted_at is not null)
       or (old.drive_url is not null and new.drive_url is not null and old.drive_url is distinct from new.drive_url) then
      perform public.notif_push(new.client_id, 'handover', 'bookings',
        'Ảnh của bạn đã sẵn sàng 📸',
        'Photographer ' || ptg || ' đã bàn giao ảnh cho đơn ' || code || '. Hãy xem và xác nhận nhé!',
        new.id, d);
    end if;

    -- Khách / PTG xác nhận hoàn tất
    if old.client_success_at is null and new.client_success_at is not null then
      perform public.notif_push(new.photographer_user_id, 'client_confirmed', 'bookings',
        'Khách đã xác nhận hoàn tất', cli || ' đã xác nhận đơn ' || code || ' hoàn tất.', new.id, d);
    end if;
    if old.ptg_success_at is null and new.ptg_success_at is not null then
      perform public.notif_push(new.client_id, 'ptg_confirmed', 'bookings',
        'Photographer đã xác nhận hoàn tất', ptg || ' đã xác nhận đơn ' || code || ' hoàn tất.', new.id, d);
    end if;
    if new.client_success_at is not null and new.ptg_success_at is not null
       and (old.client_success_at is null or old.ptg_success_at is null) then
      perform public.notif_push_admins('admin_closing', 'Đơn cần quyết toán',
        'Đơn ' || code || ' đã được 2 bên xác nhận — cần chuyển nốt 70% cho PTG.', new.id, d);
    end if;

    -- Quyết toán 70% cho PTG
    if old.ptg_final_paid_at is null and new.ptg_final_paid_at is not null then
      perform public.notif_push(new.photographer_user_id, 'ptg_final', 'bookings',
        'Đã quyết toán đơn hàng 💰',
        'Memento đã chuyển nốt ' || public.notif_vnd(price * 0.7) || ' cho đơn ' || code || '. Cảm ơn bạn!',
        new.id, d);
    end if;

    -- Hoàn thành
    if old.status is distinct from new.status and new.status = 'completed' then
      perform public.notif_push(new.client_id, 'completed', 'bookings',
        'Đơn đã hoàn thành',
        'Đơn ' || code || ' đã hoàn tất. Đừng quên để lại đánh giá cho ' || ptg || ' nhé!',
        new.id, d);
      perform public.notif_push(new.photographer_user_id, 'completed', 'bookings',
        'Đơn đã hoàn thành', 'Đơn ' || code || ' đã hoàn tất.', new.id, d);
    end if;
  exception when others then
    raise warning 'trg_notif_booking_update: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists notif_booking_update on public.bookings;
create trigger notif_booking_update after update on public.bookings
  for each row execute function public.trg_notif_booking_update();

-- 7) Khách gửi yêu cầu chỉnh sửa ảnh -> báo PTG ----------------------
create or replace function public.trg_notif_feedback_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare b record;
begin
  begin
    select id, photographer_user_id, client_name into b from public.bookings where id = new.booking_id;
    if found then
      perform public.notif_push(b.photographer_user_id, 'feedback_new', 'bookings',
        'Có yêu cầu chỉnh sửa ảnh',
        coalesce(nullif(trim(b.client_name), ''), 'Khách hàng') || ' vừa gửi yêu cầu chỉnh sửa cho đơn ' || public.notif_bill(b.id) || '.',
        b.id, jsonb_build_object('code', public.notif_bill(b.id)));
    end if;
  exception when others then
    raise warning 'trg_notif_feedback_insert: %', sqlerrm;
  end;
  return new;
end $$;

do $$ begin
  if to_regclass('public.booking_photo_feedback') is not null then
    drop trigger if exists notif_feedback_insert on public.booking_photo_feedback;
    create trigger notif_feedback_insert after insert on public.booking_photo_feedback
      for each row execute function public.trg_notif_feedback_insert();
  end if;
end $$;

-- 8) Admin: có report / yêu cầu đổi tài khoản ngân hàng ----------------
create or replace function public.trg_notif_admin_generic() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_table_name = 'profile_reports' then
      perform public.notif_push_admins('admin_report', 'Có report mới',
        'Một người dùng vừa bị báo cáo. Vào "Xử lý report" để xem.');
    elsif tg_table_name = 'bank_change_requests' then
      perform public.notif_push_admins('admin_bank', 'Yêu cầu đổi TK ngân hàng',
        'Có photographer gửi yêu cầu đổi tài khoản ngân hàng cần duyệt.');
    end if;
  exception when others then
    raise warning 'trg_notif_admin_generic: %', sqlerrm;
  end;
  return new;
end $$;

do $$ begin
  if to_regclass('public.profile_reports') is not null then
    drop trigger if exists notif_profile_reports on public.profile_reports;
    create trigger notif_profile_reports after insert on public.profile_reports
      for each row execute function public.trg_notif_admin_generic();
  end if;
  if to_regclass('public.bank_change_requests') is not null then
    drop trigger if exists notif_bank_change on public.bank_change_requests;
    create trigger notif_bank_change after insert on public.bank_change_requests
      for each row execute function public.trg_notif_admin_generic();
  end if;
end $$;

-- Kiểm tra nhanh sau khi chạy:
--   select tgname from pg_trigger where tgname like 'notif_%';
--   select count(*) from public.notifications;
