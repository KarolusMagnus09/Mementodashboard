-- 030: Ban / Unban / Delete user (admin only) + cột báo cáo mở rộng + RPC ẩn review
-- Chạy trong Supabase SQL Editor (sau các migration 021, 023, 028).

-- ─── 1) Cột ban trên profiles ───────────────────────────────────────────────
alter table public.profiles
  add column if not exists banned_at timestamptz,
  add column if not exists ban_reason text;

-- ─── 2) Cột mở rộng profile_reports (nếu chưa có từ code Reports.tsx) ───────
alter table public.profile_reports
  add column if not exists subject text check (subject is null or subject in ('profile','photo','review')),
  add column if not exists photo_url text,
  add column if not exists review_id uuid;

-- ─── 3) RPC: admin ẩn / hiện review ─────────────────────────────────────────
create or replace function public.admin_set_review_hidden(
  p_review_id uuid,
  p_hidden boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Chỉ admin mới được thực hiện';
  end if;

  update public.photographer_reviews
  set hidden = p_hidden, updated_at = now()
  where id = p_review_id;

  if not found then
    raise exception 'Không tìm thấy review';
  end if;
end;
$$;

grant execute on function public.admin_set_review_hidden(uuid, boolean, text) to authenticated;

-- ─── 4) RPC: Ban user (không ban được admin) ────────────────────────────────
create or replace function public.admin_ban_user(
  p_user_id uuid,
  p_reason text default 'Vi phạm quy định'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role text;
begin
  if not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Chỉ admin mới được ban';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Không thể ban chính mình';
  end if;

  select role into target_role from public.profiles where id = p_user_id;
  if target_role is null then
    raise exception 'Không tìm thấy user';
  end if;
  if target_role = 'admin' then
    raise exception 'Không thể ban tài khoản admin';
  end if;

  update public.profiles
  set banned_at = now(),
      ban_reason = coalesce(nullif(trim(p_reason), ''), 'Vi phạm quy định')
  where id = p_user_id;

  -- Gỡ khỏi marketplace nếu là photographer
  delete from public.photographers where user_id = p_user_id;
end;
$$;

grant execute on function public.admin_ban_user(uuid, text) to authenticated;

-- ─── 5) RPC: Bỏ ban ─────────────────────────────────────────────────────────
create or replace function public.admin_unban_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Chỉ admin mới được bỏ ban';
  end if;

  update public.profiles
  set banned_at = null, ban_reason = null
  where id = p_user_id;
end;
$$;

grant execute on function public.admin_unban_user(uuid) to authenticated;

-- ─── 6) RPC: Xóa dữ liệu liên quan + đánh dấu đã xóa (soft hard-clean) ─────
-- Lưu ý: Xóa hẳn auth.users cần Service Role / Dashboard Supabase.
-- RPC này xóa dữ liệu public + ban vĩnh viễn + ẩn thông tin cá nhân.
create or replace function public.admin_delete_user_data(
  p_user_id uuid,
  p_reason text default 'Admin xóa tài khoản'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_role text;
  deleted_counts jsonb := '{}'::jsonb;
  n int;
begin
  if not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Chỉ admin mới được xóa';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'Không thể xóa chính mình';
  end if;

  select role into target_role from public.profiles where id = p_user_id;
  if target_role is null then
    raise exception 'Không tìm thấy user';
  end if;
  if target_role = 'admin' then
    raise exception 'Không thể xóa tài khoản admin';
  end if;

  -- Marketplace
  delete from public.photographers where user_id = p_user_id;
  get diagnostics n = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('photographers', n);

  -- Ứng dụng PTG
  delete from public.photographer_applications where user_id = p_user_id;
  get diagnostics n = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('applications', n);

  -- Reviews của user
  delete from public.photographer_reviews where reviewer_id = p_user_id;
  get diagnostics n = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('reviews', n);

  -- Likes
  delete from public.photo_likes where user_id = p_user_id;
  get diagnostics n = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('photo_likes', n);

  -- Reports liên quan
  delete from public.profile_reports
  where reporter_id = p_user_id or reported_user_id = p_user_id;
  get diagnostics n = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('profile_reports', n);

  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'review_reports') then
    delete from public.review_reports where reporter_id = p_user_id;
    get diagnostics n = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('review_reports', n);
  end if;

  -- Bookings: không xóa lịch sử thanh toán (giữ audit), chỉ anonymize note nếu cần
  -- Giữ bookings để admin còn xem lịch sử giao dịch.

  -- Ẩn thông tin cá nhân + ban vĩnh viễn
  update public.profiles
  set
    full_name = '[Đã xóa]',
    username = null,
    email = null,
    phone = null,
    avatar_url = null,
    banned_at = now(),
    ban_reason = coalesce(nullif(trim(p_reason), ''), 'Admin xóa tài khoản')
  where id = p_user_id;

  deleted_counts := deleted_counts || jsonb_build_object(
    'profile_anonymized', true,
    'note', 'Để xóa hẳn auth.users: Supabase Dashboard → Authentication → Users → Delete user'
  );

  return deleted_counts;
end;
$$;

grant execute on function public.admin_delete_user_data(uuid, text) to authenticated;

-- ─── 7) (Tuỳ chọn) Chặn user bị ban đăng nhập / dùng app ───────────────────
-- App client nên check profiles.banned_at sau login và signOut nếu có.
-- Có thể thêm policy RLS nếu cần siết chặt hơn.