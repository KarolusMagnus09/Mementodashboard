-- ============================================================
-- 030_admin_moderation.sql
-- Ban / unban / xóa tài khoản + quyền đọc chat log cho trang "Xử lý report"
-- Chạy 1 lần trong Supabase → SQL Editor. Chạy lại nhiều lần vẫn an toàn.
-- Cần chạy SAU 021_profile_reports.sql (và các file sql cũ).
-- ============================================================

-- 1) Cột ban trên profiles ----------------------------------
alter table public.profiles add column if not exists banned_at  timestamptz;
alter table public.profiles add column if not exists ban_reason text;
alter table public.profiles add column if not exists banned_by  uuid;

-- 2) Helper: caller có phải admin không -----------------------
create or replace function public.mod_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Admin được đọc toàn bộ tin nhắn (bảng public.messages của 032_chat_realtime.sql) để xem chat log
do $$
begin
  if to_regclass('public.messages') is not null then
    execute 'alter table public.messages enable row level security';
    execute 'drop policy if exists messages_admin_select on public.messages';
    execute 'create policy messages_admin_select on public.messages for select to authenticated using (public.mod_is_admin())';
  end if;
end $$;

-- 3) Ban ----------------------------------------------------
create or replace function public.admin_ban_user(p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_role text;
begin
  if not public.mod_is_admin() then
    raise exception 'Chỉ admin mới được thực hiện';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Không thể tự ban chính mình';
  end if;
  select role into v_role from public.profiles where id = p_user_id;
  if v_role is null then
    raise exception 'Không tìm thấy tài khoản';
  end if;
  if v_role = 'admin' then
    raise exception 'Không thể ban tài khoản admin';
  end if;

  update public.profiles
     set banned_at = now(), ban_reason = nullif(trim(coalesce(p_reason, '')), ''), banned_by = auth.uid()
   where id = p_user_id;

  -- Chặn đăng nhập + làm mới token ở tầng Supabase Auth, và đá các phiên đang mở
  update auth.users set banned_until = 'infinity' where id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

create or replace function public.admin_unban_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.mod_is_admin() then
    raise exception 'Chỉ admin mới được thực hiện';
  end if;
  update public.profiles
     set banned_at = null, ban_reason = null, banned_by = null
   where id = p_user_id;
  update auth.users set banned_until = null where id = p_user_id;
end;
$$;

-- 4) Xóa tài khoản + dữ liệu liên quan ------------------------
-- Chạy 1 câu lệnh, bỏ qua nếu bảng/cột chưa tồn tại (schema của từng môi trường có thể khác).
create or replace function public.mod_try_delete(p_sql text, p_uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  execute p_sql using p_uid;
exception
  when undefined_table or undefined_column then
    null;
end;
$$;
revoke all on function public.mod_try_delete(text, uuid) from public, anon, authenticated;

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  r record;
begin
  if not public.mod_is_admin() then
    raise exception 'Chỉ admin mới được thực hiện';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Không thể tự xóa chính mình';
  end if;
  select role into v_role from public.profiles where id = p_user_id;
  if v_role = 'admin' then
    raise exception 'Không thể xóa tài khoản admin';
  end if;

  -- Bảng con của bookings (theo booking mà user là khách hoặc PTG)
  perform public.mod_try_delete(
    'delete from public.booking_photo_feedback where booking_id in (select id from public.bookings where client_id = $1 or photographer_user_id = $1)', p_user_id);
  perform public.mod_try_delete(
    'delete from public.booking_drive_links where booking_id in (select id from public.bookings where client_id = $1 or photographer_user_id = $1)', p_user_id);
  -- Tin nhắn + cuộc trò chuyện gắn với các booking sắp xóa (tên bảng/cột theo 032_chat_realtime.sql)
  perform public.mod_try_delete(
    'delete from public.messages where sender_id = $1 or recipient_id = $1', p_user_id);
  perform public.mod_try_delete(
    'delete from public.messages where conversation_id in (select id from public.conversations where booking_id in (select id from public.bookings where client_id = $1 or photographer_user_id = $1))', p_user_id);
  perform public.mod_try_delete(
    'delete from public.conversations where booking_id in (select id from public.bookings where client_id = $1 or photographer_user_id = $1)', p_user_id);
  -- Log thanh toán giữ lại làm đối soát tiền, chỉ gỡ liên kết tới booking sắp xóa
  perform public.mod_try_delete(
    'update public.payment_logs set booking_id = null where booking_id in (select id from public.bookings where client_id = $1 or photographer_user_id = $1)', p_user_id);
  perform public.mod_try_delete(
    'delete from public.bookings where client_id = $1 or photographer_user_id = $1', p_user_id);

  -- Chat, report, review, ghim, log
  perform public.mod_try_delete('delete from public.profile_reports where reporter_id = $1 or reported_user_id = $1', p_user_id);
  perform public.mod_try_delete('delete from public.photographer_reviews where reviewer_id = $1', p_user_id);
  perform public.mod_try_delete('delete from public.photographer_reviews where photographer_user_id = $1', p_user_id);
  perform public.mod_try_delete('delete from public.pinned_photographers where user_id = $1', p_user_id);
  perform public.mod_try_delete('delete from public.photographer_update_logs where user_id = $1', p_user_id);
  perform public.mod_try_delete('delete from public.bank_change_requests where user_id = $1', p_user_id);

  -- Hồ sơ PTG
  perform public.mod_try_delete('delete from public.photographers where user_id = $1', p_user_id);
  perform public.mod_try_delete('delete from public.photographer_applications where user_id = $1', p_user_id);

  -- Quét mọi bảng public còn lại có khoá ngoại trỏ tới auth.users / profiles
  for r in
    select kcu.table_schema as s, kcu.table_name as t, kcu.column_name as c
      from information_schema.referential_constraints rc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = rc.constraint_name and kcu.constraint_schema = rc.constraint_schema
      join information_schema.constraint_column_usage ccu
        on ccu.constraint_name = rc.unique_constraint_name and ccu.constraint_schema = rc.unique_constraint_schema
     where kcu.table_schema = 'public'
       and ((ccu.table_schema = 'auth' and ccu.table_name = 'users')
         or (ccu.table_schema = 'public' and ccu.table_name = 'profiles'))
       and kcu.table_name not in ('profiles', 'payment_logs')
  loop
    perform public.mod_try_delete(format('delete from %I.%I where %I = $1', r.s, r.t, r.c), p_user_id);
  end loop;

  -- Ảnh đại diện trong storage (nếu có)
  begin
    delete from storage.objects where bucket_id = 'avatars' and (name like p_user_id::text || '/%' or name like p_user_id::text || '.%');
  exception when others then
    null;
  end;

  delete from public.profiles where id = p_user_id;
  delete from auth.users where id = p_user_id;
end;
$$;

-- 5) Quyền gọi ----------------------------------------------
revoke all on function public.admin_ban_user(uuid, text)   from public, anon;
revoke all on function public.admin_unban_user(uuid)       from public, anon;
revoke all on function public.admin_delete_user(uuid)      from public, anon;
grant execute on function public.admin_ban_user(uuid, text)  to authenticated;
grant execute on function public.admin_unban_user(uuid)      to authenticated;
grant execute on function public.admin_delete_user(uuid)     to authenticated;
grant execute on function public.mod_is_admin()              to authenticated;

-- 6) Admin được đọc/sửa mọi dòng trong profile_reports (xử lý report)
drop policy if exists profile_reports_admin_all on public.profile_reports;
create policy profile_reports_admin_all on public.profile_reports
  for all to authenticated
  using (public.mod_is_admin()) with check (public.mod_is_admin());
