-- Admin đọc toàn bộ bookings + photographer_update_logs
-- Yêu cầu profiles.role = 'admin'

-- Bookings: cho admin SELECT all
drop policy if exists "bookings_select_admin" on public.bookings;
create policy "bookings_select_admin" on public.bookings
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Update logs table (nếu chưa có)
create table if not exists public.photographer_update_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  photographer_name text,
  change_summary text not null default '',
  snapshot jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.photographer_update_logs enable row level security;

drop policy if exists "update_logs_select_admin" on public.photographer_update_logs;
create policy "update_logs_select_admin" on public.photographer_update_logs
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

drop policy if exists "update_logs_select_authenticated" on public.photographer_update_logs;
create policy "update_logs_select_authenticated" on public.photographer_update_logs
  for select using (auth.uid() is not null);

drop policy if exists "update_logs_insert_own" on public.photographer_update_logs;
create policy "update_logs_insert_own" on public.photographer_update_logs
  for insert with check (auth.uid() = user_id);
