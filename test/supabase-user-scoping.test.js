// QA: verify the shipped Supabase read helpers are scoped to the signed-in
// user — getExercises/getRoutineDays must (a) return nothing when logged out
// and (b) constrain the query to the current user_id when logged in. This
// exercises the real functions in supabase.js, not a reimplementation.
import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp } from './helpers/load-app.js';

describe('Supabase routine reads are user-scoped', () => {
  let app;

  beforeEach(() => {
    app = loadApp();
  });

  it('returns nothing and makes no request when there is no session', async () => {
    let called = false;
    app.fetch = async () => { called = true; throw new Error('should not fetch'); };

    expect(await app.Supabase.getExercises()).toEqual([]);
    expect(await app.Supabase.getRoutineDays()).toEqual([]);
    expect(called).toBe(false);
  });

  it('constrains getExercises/getRoutineDays to the signed-in user_id', async () => {
    // Seed a live (far-future) session so restoreSession populates the module's
    // internal _session without a network round-trip.
    app.localStorage.setItem('wt_auth', JSON.stringify({
      access_token: 'tok', refresh_token: 'refresh',
      expires_at: 9999999999999, user: { id: 'USER-A' },
    }));
    await app.Supabase.restoreSession();

    const urls = [];
    app.fetch = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, text: async () => '[]', json: async () => ([]) };
    };

    await app.Supabase.getExercises();
    await app.Supabase.getRoutineDays();

    expect(urls[0]).toContain('/exercises');
    expect(urls[0]).toContain('user_id=eq.USER-A');
    expect(urls[1]).toContain('/routine_days');
    expect(urls[1]).toContain('user_id=eq.USER-A');
  });
});
