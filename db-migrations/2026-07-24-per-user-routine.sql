-- Migration: 2026-07-24 — Private per-user routines
-- Run in Supabase Dashboard → SQL Editor → New query, then reload the app.
--
-- Context: `exercises` and `routine_days` were a single SHARED routine with no
-- user_id and wide-open RLS (using(true)) — every signed-in account read and
-- wrote the SAME rows, so a second user would see the owner's program and any
-- edit (add exercise, rename/reorder day, delete) would overwrite it. This
-- scopes both tables per-user exactly like `sessions`/`set_logs`, so one
-- account's routine can never reach or clobber another's.
--
-- ⚠️ Run this ONCE, while you are still the only account. The backfill assigns
-- every existing (unowned) row to the oldest auth user — you.

-- 1. Add ownership columns.
alter table exercises    add column if not exists user_id text;
alter table routine_days add column if not exists user_id text;

-- 2. Backfill existing rows to the current sole owner (you).
update exercises
  set user_id = (select id from auth.users order by created_at limit 1)::text
  where user_id is null;
update routine_days
  set user_id = (select id from auth.users order by created_at limit 1)::text
  where user_id is null;

-- 3. Require ownership going forward — every insert must carry a user_id.
alter table exercises    alter column user_id set not null;
alter table routine_days alter column user_id set not null;

-- 4. Replace the permissive shared-table policies with per-user isolation,
--    matching the existing "Users own sessions" policy.
drop policy if exists "Read exercises"       on exercises;
drop policy if exists "Insert exercises"     on exercises;
drop policy if exists "Update exercises"     on exercises;
drop policy if exists "Delete exercises"     on exercises;
drop policy if exists "Allow all on exercises" on exercises;
create policy "Users own exercises" on exercises
  for all
  using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);

drop policy if exists "Read routine_days"  on routine_days;
drop policy if exists "Write routine_days" on routine_days;
create policy "Users own routine_days" on routine_days
  for all
  using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);

-- Verify:
-- select tablename, policyname from pg_policies
--   where tablename in ('exercises','routine_days') order by tablename;
-- select count(*) filter (where user_id is null) as unowned from exercises;   -- expect 0
-- select distinct user_id from routine_days;                                  -- expect 1 (you)
