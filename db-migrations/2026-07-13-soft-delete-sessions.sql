-- Migration: 2026-07-13 — Soft-delete sessions (Recently deleted + Restore)
-- Run in Supabase Dashboard → SQL Editor → New query, then reload the app.
--
-- Context: deleting a workout used to hard-delete the session + set_logs with
-- no way back. Sessions now get a deleted_at stamp instead; the app hides them
-- from History/Progress, shows them under History → Recently deleted with
-- Restore / Delete forever, and hard-deletes anything older than 30 days.
--
-- ⚠️ Until this runs, soft-deletes made in the app stay queued in pending_sync
-- (the payload includes the deleted_at column the server doesn't have yet) and
-- flush automatically once the column exists. Normal session writes are
-- unaffected either way.

alter table sessions add column if not exists deleted_at timestamptz;

-- Verify:
-- select column_name from information_schema.columns
-- where table_name = 'sessions' and column_name = 'deleted_at';
