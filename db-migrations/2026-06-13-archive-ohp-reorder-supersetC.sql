-- Migration: 2026-06-13
-- Run in Supabase Dashboard → SQL Editor → New query, then reload the app.
--
-- Context: the `exercises` table is the live source of truth (exercises.js is
-- only the one-time seed + offline fallback). RLS allows read/insert only, so
-- these changes can't be done from the app — they must run here as the owner.

-- 1. Archive "Barbell Overhead Press": remove it from Day 1 so it's no longer
--    an option, but keep the row + all logged set history (no data destroyed).
--    [DONE 2026-06-13 — already applied successfully.]
update exercises
set day = 'Archived'
where name = 'Barbell Overhead Press';

-- 2. Reorder Day 1 → Superset C so Incline DB Chest Press comes first.
--    Single atomic statement (a CASE) so all three rows update together and
--    can't partially apply. Re-run-safe: sets the exact target order every time.
update exercises
set sort_order = case name
  when 'Incline Dumbbell Chest Press'      then 9
  when 'Dumbbell Alternating Bench Press'  then 10
  when 'Tricep Kickback'                   then 11
end
where day = 'Day 1' and section = 'Superset C'
  and name in (
    'Incline Dumbbell Chest Press',
    'Dumbbell Alternating Bench Press',
    'Tricep Kickback'
  );

-- Verify:
-- select name, sort_order from exercises
-- where day = 'Day 1' and section = 'Superset C' order by sort_order;
-- Expect: Incline (9) → Dumbbell Alternating Bench Press (10) → Tricep Kickback (11)
