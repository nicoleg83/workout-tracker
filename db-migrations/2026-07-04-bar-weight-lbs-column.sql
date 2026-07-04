-- Migration: 2026-07-04 — Sync bar weight reference server-side
-- Run in Supabase Dashboard → SQL Editor → New query, then reload the app.
--
-- Context: "Bar weight" (the reference weight of the bar itself, e.g. an EZ
-- curl bar) was previously localStorage-only, so it silently got wiped by
-- anything that clears local storage (PWA reinstall, Safari data purge,
-- switching between the home-screen app and a browser tab). Moving it onto
-- the exercises row makes it durable and synced like every other exercise
-- field. No RLS changes needed — update/delete on exercises was already
-- opened up by the routine-editing-backbone migration.

alter table exercises add column if not exists bar_weight_lbs numeric;
