-- Chạy trên Supabase SQL Editor (một lần)
-- 1) Bảng photographer_applications (nếu chưa có)
-- 2) Policy cho admin đọc/sửa
-- 3) Gán role admin cho 1 user (sửa email bên dưới)

create table if not exists public.photographer_applications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  birth_date text,
  phone text,
  cccd_front_url text,
  cccd_back_url text,
  work_locations jsonb not null default '[]'::jsonb,
  experience_years text,
  equipment text,
  languages jsonb not null default '[]'::jsonb,
  work_model text,
  style_description text,
  specialty_tags jsonb not null default '[]'::jsonb,
  experience_detail text,
  bio text,
  skill_makeup boolean default false,
  skill_edit boolean default false,
  selected_styles jsonb not null default '[]'::jsonb,
  price_groups jsonb not null default '[]'::jsonb,
  proof_link text,
  banner_url text,
  avatar_url text,
  boards jsonb not null default '[]'::jsonb,
  standalone_pins jsonb not null default '[]'::jsonb,
  agreed_terms boolean default false,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.photographer_applications enable row level security;

-- User xem / sửa hồ sơ của chính mình
drop policy if exists "Users read own application" on public.photographer_applications;
create policy "Users read own application"
  on public.photographer_applications for select
  using (auth.uid() = user_id);

drop policy if exists "Users upsert own application" on public.photographer_applications;
create policy "Users upsert own application"
  on public.photographer_applications for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own application" on public.photographer_applications;
create policy "Users update own application"
  on public.photographer_applications for update
  using (auth.uid() = user_id);

-- Admin: đọc / sửa tất cả hồ sơ
drop policy if exists "Admin read all applications" on public.photographer_applications;
create policy "Admin read all applications"
  on public.photographer_applications for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "Admin update all applications" on public.photographer_applications;
create policy "Admin update all applications"
  on public.photographer_applications for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Admin đọc / sửa profiles (để set role = photographer khi duyệt)
drop policy if exists "Admin read all profiles" on public.profiles;
create policy "Admin read all profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "Admin update all profiles" on public.profiles;
create policy "Admin update all profiles"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Admin đọc photographers marketplace
drop policy if exists "Admin read photographers" on public.photographers;
create policy "Admin read photographers"
  on public.photographers for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- >>> GÁN ADMIN: đổi email thành email tài khoản của bạn rồi chạy <<<
-- update public.profiles
-- set role = 'admin'
-- where id = (select id from auth.users where email = 'ban@email.com' limit 1);
