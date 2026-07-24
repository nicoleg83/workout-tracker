// Regression tests for the 2026-07-24 per-user routine isolation change.
//
// Before this, `exercises` and `routine_days` were a single shared routine with
// no owner, so a second account saw and could overwrite the first account's
// program. Every routine row written by the app must now carry the signed-in
// user's id (server RLS scopes reads/writes to that id), so one account's
// exercises, days, and orderings can never reach or clobber another's.
import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp } from './helpers/load-app.js';

describe('per-user routine ownership stamping', () => {
  let app;
  const UID = 'user-friend-123';

  beforeEach(() => {
    app = loadApp();
    app.Supabase.getUser = () => ({ id: UID });
    // renderSeedingOverlay touches the DOM; not under test here.
    app.renderSeedingOverlay = () => {};
  });

  it('toExerciseRow stamps the signed-in user_id', () => {
    const row = app.toExerciseRow({ id: 'ex-1', name: 'Bench Press', day: 'Day 1' });
    expect(row.user_id).toBe(UID);
  });

  it('toExerciseRow never trusts an ownership value from the source object', () => {
    // A spoofed/stale user_id on the input must be overwritten by the real
    // session owner — you can't write a row into someone else's account.
    const row = app.toExerciseRow({ id: 'ex-1', name: 'Bench Press', user_id: 'someone-else' });
    expect(row.user_id).toBe(UID);
  });

  it('seedExercises stamps every seeded exercise with the current user', async () => {
    const captured = [];
    app.Supabase.insertExercises = async (batch) => { captured.push(...batch); };

    await app.seedExercises();

    expect(captured.length).toBeGreaterThan(0);
    expect(captured.every(e => e.user_id === UID)).toBe(true);
  });

  it('syncNewExercises stamps newly-added built-in exercises with the current user', async () => {
    const captured = [];
    app.Supabase.insertExercises = async (batch) => { captured.push(...batch); };

    // Empty remote set → every built-in exercise counts as "missing" and is inserted.
    const hadNew = await app.syncNewExercises([]);

    expect(hadNew).toBe(true);
    expect(captured.length).toBeGreaterThan(0);
    expect(captured.every(e => e.user_id === UID)).toBe(true);
  });

  it('persistRoutineDay stamps ownership on a pre-migration row that lacks it', async () => {
    let synced = null;
    app.DB.put = async () => {};
    app.DB.queueSync = async (table, op, payload) => { synced = { table, op, payload }; };
    app.syncIfOnline = () => {};

    await app.persistRoutineDay({ id: 'd1', label: 'Day 1', name: 'Push' });

    expect(synced.payload.user_id).toBe(UID);
  });
});
