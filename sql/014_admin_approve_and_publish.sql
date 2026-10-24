-- =============================================================================
-- MEMENTO: Admin duyệt PTG → publish marketplace + 1 profile / user + xóa hồ sơ
-- Chạy TOÀN BỘ file này trong Supabase SQL Editor (một lần).
-- =============================================================================

-- ── 0) Cột cần thiết trên applications ──────────────────────────────────────
alter table public.photographer_applications
  add column if not exists admin_note text,
  add column if not exists skill_rental boolean default false,
  add column if not exists rental_boards jsonb not null default '[]'::jsonb,
  add column if not exists rental_pins jsonb not null default '[]'::jsonb,
  add column if not exists reviewed_at timestamptz;

-- ── 1) photographers: gắn user_id (1 acc = 1 profile marketplace) ───────────
alter table public.photographers
  add column if not exists user_id uuid unique references auth.users(id) on delete cascade,
  add column if not exists boards jsonb not null default '[]'::jsonb,
  add column if not exists standalone_pins jsonb not null default '[]'::jsonb,
  add column if not exists pin_likes jsonb not null default '{}'::jsonb,
  add column if not exists work_locations jsonb not null default '[]'::jsonb,
  add column if not exists shooting_styles jsonb not null default '[]'::jsonb,
  add column if not exists experience_years text,
  add column if not exists equipment text,
  add column if not exists languages jsonb not null default '[]'::jsonb,
  add column if not exists work_model text,
  add column if not exists experience_detail text;

-- ── 2) Helper: user hiện tại có phải admin không ────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- ── 3) RPC: Admin duyệt / từ chối ───────────────────────────────────────────
-- p_status: 'approved' | 'rejected'
-- Khi approved: set role photographer + UPSERT vào photographers (marketplace
--   → Home/Search filter theo name, specialty, tags, location, price vẫn chạy)
-- Khi rejected: chỉ đổi status + note; không publish
create or replace function public.admin_set_application_status(
  p_user_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  app public.photographer_applications%rowtype;
  v_price numeric := 0;
  v_specialty text;
  v_location text;
  v_tags jsonb;
  v_portfolio jsonb;
  v_packages jsonb;
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'Forbidden: admin only';
  end if;

  if p_status not in ('approved', 'rejected') then
    raise exception 'status must be approved or rejected';
  end if;

  select * into app
  from public.photographer_applications
  where user_id = p_user_id;

  if not found then
    raise exception 'Application not found';
  end if;

  update public.photographer_applications
  set
    status = p_status,
    admin_note = p_note,
    reviewed_at = now()
  where user_id = p_user_id;

  if p_status = 'rejected' then
    -- Nếu từng duyệt rồi rồi reject lại → gỡ marketplace + role
    delete from public.photographers where user_id = p_user_id;
    update public.profiles
    set role = 'customer'
    where id = p_user_id and role = 'photographer';

    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  -- ── APPROVED: role + publish marketplace ──
  update public.profiles
  set role = 'photographer'
  where id = p_user_id;

  v_name := coalesce(nullif(trim(app.full_name), ''), 'Photographer');
  v_location := case
    when jsonb_typeof(app.work_locations) = 'array'
         and jsonb_array_length(app.work_locations) > 0
      then coalesce(app.work_locations->>0, 'Việt Nam')
    else 'Việt Nam'
  end;

  -- Giá thấp nhất từ price_groups.lines.price (chuỗi số)
  select coalesce(min(
    nullif(regexp_replace(coalesce(line->>'price', ''), '[^0-9.]', '', 'g'), '')::numeric
  ), 0)
  into v_price
  from jsonb_array_elements(coalesce(app.price_groups, '[]'::jsonb)) g,
       jsonb_array_elements(coalesce(g->'lines', '[]'::jsonb)) line;

  v_specialty := case
    when jsonb_typeof(app.selected_styles) = 'array'
         and jsonb_array_length(app.selected_styles) > 0
      then app.selected_styles->>0
    else coalesce(app.style_description, 'Photography')
  end;

  select coalesce(jsonb_agg(to_jsonb('#' || replace(s, ' ', ''))), '[]'::jsonb)
  into v_tags
  from jsonb_array_elements_text(coalesce(app.selected_styles, '[]'::jsonb)) s;

  -- Portfolio = standalone + pins trong boards
  select coalesce(
    (
      select jsonb_agg(to_jsonb(x))
      from (
        select distinct p as x
        from (
          select jsonb_array_elements_text(coalesce(app.standalone_pins, '[]'::jsonb)) p
          union all
          select jsonb_array_elements_text(coalesce(b->'pins', '[]'::jsonb))
          from jsonb_array_elements(coalesce(app.boards, '[]'::jsonb)) b
        ) u
        where p is not null and p <> ''
      ) d
    ),
    '[]'::jsonb
  ) into v_portfolio;

  -- packages từ price_groups (đơn giản)
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', coalesce(line->>'name', g->>'title', 'Gói'),
        'price', coalesce(nullif(regexp_replace(coalesce(line->>'price', ''), '[^0-9.]', '', 'g'), '')::numeric, 0),
        'desc', coalesce(line->>'detail', g->>'title', ''),
        'includes', '[]'::jsonb
      )
    ),
    '[]'::jsonb
  )
  into v_packages
  from jsonb_array_elements(coalesce(app.price_groups, '[]'::jsonb)) g,
       jsonb_array_elements(coalesce(g->'lines', '[]'::jsonb)) line;

  insert into public.photographers as ph (
    user_id, name, location, price, rating, bookings,
    specialty, avatar, cover, portfolio, bio, tags, reviews, packages,
    boards, standalone_pins, pin_likes,
    work_locations, shooting_styles, experience_years, equipment, languages, work_model, experience_detail
  )
  values (
    p_user_id,
    v_name,
    v_location,
    coalesce(v_price, 0),
    0, 0,
    v_specialty,
    app.avatar_url,
    app.banner_url,
    coalesce(v_portfolio, '[]'::jsonb),
    app.bio,
    coalesce(v_tags, '[]'::jsonb),
    '[]'::jsonb,
    coalesce(v_packages, '[]'::jsonb),
    coalesce(app.boards, '[]'::jsonb),
    coalesce(app.standalone_pins, '[]'::jsonb),
    '{}'::jsonb,
    coalesce(app.work_locations, '[]'::jsonb),
    coalesce(app.selected_styles, '[]'::jsonb),
    app.experience_years,
    app.equipment,
    coalesce(app.languages, '[]'::jsonb),
    app.work_model,
    coalesce(app.experience_detail, app.style_description)
  )
  on conflict (user_id) do update set
    name = excluded.name,
    location = excluded.location,
    price = excluded.price,
    specialty = excluded.specialty,
    avatar = excluded.avatar,
    cover = excluded.cover,
    portfolio = excluded.portfolio,
    bio = excluded.bio,
    tags = excluded.tags,
    packages = excluded.packages,
    boards = excluded.boards,
    standalone_pins = excluded.standalone_pins,
    work_locations = excluded.work_locations,
    shooting_styles = excluded.shooting_styles,
    experience_years = excluded.experience_years,
    equipment = excluded.equipment,
    languages = excluded.languages,
    work_model = excluded.work_model,
    experience_detail = excluded.experience_detail;

  return jsonb_build_object('ok', true, 'status', 'approved', 'name', v_name);
end;
$$;

revoke all on function public.admin_set_application_status(uuid, text, text) from public;
grant execute on function public.admin_set_application_status(uuid, text, text) to authenticated;

-- ── 4) RPC: User xóa hồ sơ PTG (chỉ từ Cài đặt — app gọi sau captcha + password) ─
create or replace function public.delete_own_ptg_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.photographers where user_id = auth.uid();
  delete from public.photographer_applications where user_id = auth.uid();

  update public.profiles
  set role = case when role = 'photographer' then 'customer' else role end
  where id = auth.uid();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.delete_own_ptg_profile() from public;
grant execute on function public.delete_own_ptg_profile() to authenticated;

-- ── 5) RLS: sau khi approved, user KHÔNG được UPDATE hồ sơ (chỉ DELETE) ─────
drop policy if exists "Users update own application" on public.photographer_applications;
drop policy if exists "own application - update" on public.photographer_applications;
create policy "Users update own application when not approved"
  on public.photographer_applications for update
  using (
    auth.uid() = user_id
    and status is distinct from 'approved'
  );

-- Giữ delete own (đã có trong 012)
drop policy if exists "own application - delete" on public.photographer_applications;
create policy "own application - delete"
  on public.photographer_applications for delete
  using (auth.uid() = user_id);

-- Admin policies (đồng bộ tên)
drop policy if exists "admin - select all applications" on public.photographer_applications;
drop policy if exists "Admin read all applications" on public.photographer_applications;
create policy "admin - select all applications"
  on public.photographer_applications for select
  using (public.is_admin());

drop policy if exists "admin - update all applications" on public.photographer_applications;
drop policy if exists "Admin update all applications" on public.photographer_applications;
create policy "admin - update all applications"
  on public.photographer_applications for update
  using (public.is_admin());

-- Admin đọc profiles
drop policy if exists "Admin read all profiles" on public.profiles;
create policy "Admin read all profiles"
  on public.profiles for select
  using (public.is_admin() or auth.uid() = id);

-- Public vẫn đọc photographers (marketplace + filter Search)
-- (policy "Public read access" từ 001 đã có)

-- ── 6) TẠO / GÁN ACC ADMIN ──────────────────────────────────────────────────
-- Cách A (khuyên dùng): Dashboard → Authentication → Users → Add user
--   email + password → rồi chạy khối dưới (đổi email):
--
-- update public.profiles
-- set role = 'admin'
-- where id = (select id from auth.users where email = 'admin@memento.local' limit 1);
--
-- Cách B: nếu đã có user, chỉ cần UPDATE role = 'admin'.
