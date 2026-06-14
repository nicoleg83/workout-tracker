-- Migration: 2026-06-13 — Routine editing / library backbone
-- Run in Supabase Dashboard → SQL Editor → New query, then reload the app.
-- This is the one-time unlock that lets the app edit/remove exercises and
-- manage workout days in-app (no more manual SQL after this).

-- 1. Allow the app to edit and remove exercises.
--    (RLS currently permits only select + insert; without update/delete the
--    app's edits silently fail.) Matches the existing permissive single-user model.
create policy "Update exercises" on exercises for update using (true) with check (true);
create policy "Delete exercises" on exercises for delete using (true);

-- 2. Day metadata table — powers the home day list, progress filters, and
--    creator-mode new days. The app seeds Day 1/2/3 rows automatically if empty.
create table if not exists routine_days (
  id uuid primary key default gen_random_uuid(),
  label text not null,        -- 'Day 1' … 'Day 4'
  name text,                  -- 'Push', 'Legs + Core'
  muscles text,
  color text,
  sort_order int,
  archived boolean default false
);

alter table routine_days enable row level security;
create policy "Read routine_days"  on routine_days for select using (true);
create policy "Write routine_days" on routine_days for all using (true) with check (true);

-- Verify:
-- select policyname from pg_policies where tablename in ('exercises','routine_days');
-- select * from routine_days order by sort_order;
