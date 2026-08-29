// Regression: cross-day history/lastCache not merging + weight input keyboard
// Found by /qa on 2026-07-04
// Report: .gstack/qa-reports/qa-report-workout-tracker-2026-07-04.md
import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp } from './helpers/load-app.js';

describe('cross-day exercise history (loadProgressData)', () => {
  let app;

  const legsCalfRaise = {
    id: 'ex-legs-calf', day: 'Legs', section: 'Superset A',
    name: 'Standing Calf Raises', image_key: 'standing-calf-raises',
    sets_target: 3, reps_target: '20', equipment: '',
  };
  const fullBodyCalfRaise = {
    id: 'ex-fb-calf', day: 'Full Body', section: 'Superset D',
    name: 'Standing Calf Raise', image_key: 'standing-calf-raises',
    sets_target: 3, reps_target: '20', equipment: '',
  };

  beforeEach(() => {
    app = loadApp();
    app.state.exercises = [legsCalfRaise, fullBodyCalfRaise];
    app.state.sessions = [{ id: 'sess-legs-1', day: 'Legs', date: '2026-06-01' }];

    const legsLogs = [
      { id: 'log-1', session_id: 'sess-legs-1', exercise_id: 'ex-legs-calf', set_number: 1, weight_lbs: 20, reps: 20, completed: true },
      { id: 'log-2', session_id: 'sess-legs-1', exercise_id: 'ex-legs-calf', set_number: 2, weight_lbs: 20, reps: 18, completed: true },
    ];
    app.DB.getAll = async (store) => (store === 'set_logs' ? legsLogs : []);
  });

  it('shares last-session data across days for the same exercise (image_key match)', async () => {
    await app.loadProgressData();

    // Full Body's own row never logged a set, but should inherit Legs day's last session.
    expect(app.state.lastCache['ex-fb-calf']).toBeDefined();
    expect(app.state.lastCache['ex-fb-calf'].date).toBe('2026-06-01');
    expect(app.state.lastCache['ex-fb-calf'].sets).toHaveLength(2);
  });

  it('shares full history across days for the same exercise', async () => {
    await app.loadProgressData();

    expect(app.state.historyCache['ex-fb-calf']).toBeDefined();
    expect(app.state.historyCache['ex-fb-calf']).toHaveLength(1);
    expect(app.state.historyCache['ex-fb-calf'][0].date).toBe('2026-06-01');
  });

  it('uses created_at to choose the newest exercise values when sessions share a date', async () => {
    const app = loadApp();
    app.navigator.onLine = false;
    app.state.exercises = [{
      id: 'ex-row', day: 'Day 2', name: 'Seated Cable Row',
      image_key: 'seated-cable-row', sets_target: 3,
    }];
    app.state.sessions = [
      { id: 'sess-morning', day: 'Day 2', date: '2026-08-29', created_at: '2026-08-29T08:00:00Z' },
      { id: 'sess-evening', day: 'Day 2', date: '2026-08-29', created_at: '2026-08-29T18:00:00Z' },
    ];
    app.DB.getAll = async store => store === 'set_logs' ? [
      { session_id: 'sess-morning', exercise_id: 'ex-row', set_number: 1, weight_lbs: 40, reps: 10, completed: true },
      { session_id: 'sess-evening', exercise_id: 'ex-row', set_number: 1, weight_lbs: 50, reps: 10, completed: true },
    ] : [];

    await app.loadProgressData();

    expect(app.state.lastCache['ex-row']).toMatchObject({
      sessionId: 'sess-evening',
      createdAt: '2026-08-29T18:00:00Z',
    });
    expect(app.state.lastCache['ex-row'].sets[0].weight_lbs).toBe(50);
  });

  it('still shares PRs across days (pre-existing behavior, unchanged)', async () => {
    await app.loadProgressData();

    expect(app.state.prCache['ex-fb-calf']).toEqual(app.state.prCache['ex-legs-calf']);
    expect(app.state.prCache['ex-fb-calf'].weight_lbs).toBe(20);
  });

  it('does not merge across exercises with different image_key', async () => {
    app.state.exercises.push({
      id: 'ex-other', day: 'Full Body', image_key: 'bench-press', name: 'Bench Press', sets_target: 3,
    });

    await app.loadProgressData();

    expect(app.state.lastCache['ex-other']).toBeUndefined();
    expect(app.state.historyCache['ex-other']).toBeUndefined();
  });
});

// Regression: resuming an in-progress session (app reload mid-workout) left
// state.lastLogs empty, so the workout view showed no prefill/PR history even
// though History/Progress (fed by separate state) were unaffected. Found
// 2026-07-07. Root cause: loadLastLogs()'s "use the session before the
// current one" fallback was dead code — it detected the in-progress session
// but never actually stepped back to the prior one.
describe('resumed-session prefill (loadLastLogs)', () => {
  it('falls back to the prior session for the day instead of the empty in-progress one', async () => {
    const app = loadApp();
    app.state.sessions = [
      { id: 'sess-today', day: 'Push', date: '2026-07-07' },
      { id: 'sess-yesterday', day: 'Push', date: '2026-07-06' },
    ];
    app.state.activeSession = { id: 'sess-today', day: 'Push', date: '2026-07-07' };
    app.Supabase.getSetLogs = async (sessionId) =>
      sessionId === 'sess-yesterday'
        ? [{ id: 'log-1', session_id: 'sess-yesterday', exercise_id: 'ex-bench', set_number: 1, weight_lbs: 135, reps: 8, completed: true }]
        : [];

    await app.loadLastLogs('Push');

    expect(app.state.lastLogs['ex-bench']).toBeDefined();
    expect(app.state.lastLogs['ex-bench'][0].weight_lbs).toBe(135);
  });

  it('leaves lastLogs empty when the in-progress session is the only one for the day', async () => {
    const app = loadApp();
    app.state.sessions = [{ id: 'sess-today', day: 'Push', date: '2026-07-07' }];
    app.state.activeSession = { id: 'sess-today', day: 'Push', date: '2026-07-07' };

    await app.loadLastLogs('Push');

    expect(app.state.lastLogs).toEqual({});
  });

  // Regression: Barbell back squat / leg press prefill + PR card vanished when
  // an exercise was done in an earlier session but SKIPPED in the most recent
  // one for that day. loadLastLogs read only the immediately-previous session,
  // so a skipped exercise got no lastLogs entry — wiping both prefill
  // (initSetLogs) and the entire "Last session"/PR card (gated on lastLogs).
  // Found 2026-07-22. Fix: fall back to the exercise's own lastCache entry.
  it('prefills from an earlier session when the exercise was skipped last time', async () => {
    const app = loadApp();
    app.state.exercises = [
      { id: 'ex-squat', day: 'Legs', name: 'Barbell Back Squat', sets_target: 3, reps_target: '5' },
      { id: 'ex-legpress', day: 'Legs', name: 'Leg Press', sets_target: 3, reps_target: '10' },
    ];
    app.state.sessions = [
      { id: 'sess-legs-recent', day: 'Legs', date: '2026-07-20' }, // squat skipped here
      { id: 'sess-legs-older', day: 'Legs', date: '2026-07-13' },  // squat done here
    ];
    // Most recent Legs session only logged leg press, not the squat.
    app.Supabase.getSetLogs = async (sessionId) =>
      sessionId === 'sess-legs-recent'
        ? [{ id: 'lp-1', session_id: 'sess-legs-recent', exercise_id: 'ex-legpress', set_number: 1, weight_lbs: 300, reps: 10, completed: true }]
        : [];
    // lastCache (from loadProgressData over ALL history) still holds the squat
    // from the older session.
    app.state.lastCache = {
      'ex-squat': {
        sessionId: 'sess-legs-older', date: '2026-07-13',
        sets: [{ session_id: 'sess-legs-older', exercise_id: 'ex-squat', set_number: 1, weight_lbs: 225, reps: 5, completed: true }],
      },
    };

    await app.loadLastLogs('Legs');

    // Leg press comes from the recent session as before.
    expect(app.state.lastLogs['ex-legpress'][0].weight_lbs).toBe(300);
    // Squat, skipped last session, still prefills from the older one.
    expect(app.state.lastLogs['ex-squat']).toBeDefined();
    expect(app.state.lastLogs['ex-squat'][0].weight_lbs).toBe(225);
  });

  it('does not prefill an exercise from the active session itself', async () => {
    const app = loadApp();
    app.state.exercises = [{ id: 'ex-squat', day: 'Legs', name: 'Barbell Back Squat', sets_target: 3 }];
    app.state.sessions = [
      { id: 'sess-active', day: 'Legs', date: '2026-07-22' },
      { id: 'sess-prev', day: 'Legs', date: '2026-07-20' },
    ];
    app.state.activeSession = { id: 'sess-active', day: 'Legs', date: '2026-07-22' };
    app.Supabase.getSetLogs = async () => []; // prev session logged nothing for squat
    // lastCache points at the active session — must be ignored.
    app.state.lastCache = {
      'ex-squat': {
        sessionId: 'sess-active', date: '2026-07-22',
        sets: [{ session_id: 'sess-active', exercise_id: 'ex-squat', set_number: 1, weight_lbs: 999, reps: 1, completed: true }],
      },
    };

    await app.loadLastLogs('Legs');

    expect(app.state.lastLogs['ex-squat']).toBeUndefined();
  });

  it('prefills from the latest exercise history when the active workout is the only session for that day', async () => {
    const app = loadApp();
    app.state.exercises = [{
      id: 'ex-row', day: 'Day 2', name: 'Seated Cable Row',
      image_key: 'seated-cable-row', sets_target: 3,
    }];
    app.state.sessions = [
      { id: 'sess-active', day: 'Day 2', date: '2026-08-29' },
      { id: 'sess-other-day', day: 'Day 4', date: '2026-08-20' },
    ];
    app.state.activeSession = { id: 'sess-active', day: 'Day 2', date: '2026-08-29' };
    app.state.historyCache = {
      'ex-row': [{
        sessionId: 'sess-other-day', date: '2026-08-20',
        sets: [{ session_id: 'sess-other-day', exercise_id: 'ex-row', set_number: 1, weight_lbs: 40, reps: 12, completed: true }],
      }],
    };

    await app.loadLastLogs('Day 2');

    expect(app.state.lastLogs['ex-row'][0]).toMatchObject({ weight_lbs: 40, reps: 12 });
  });

  it('prefills from exercise history even when that workout day has no prior sessions', async () => {
    const app = loadApp();
    app.state.exercises = [{
      id: 'ex-row', day: 'Day 2', name: 'Seated Cable Row',
      image_key: 'seated-cable-row', sets_target: 3,
    }];
    app.state.sessions = [{ id: 'sess-other-day', day: 'Day 4', date: '2026-08-20' }];
    app.state.historyCache = {
      'ex-row': [{
        sessionId: 'sess-other-day', date: '2026-08-20',
        sets: [{ session_id: 'sess-other-day', exercise_id: 'ex-row', set_number: 1, weight_lbs: 45, reps: 10, completed: true }],
      }],
    };

    await app.loadLastLogs('Day 2');

    expect(app.state.lastLogs['ex-row'][0]).toMatchObject({ weight_lbs: 45, reps: 10 });
  });

  it('prefills from newer cross-day exercise history instead of an older same-day session', async () => {
    const app = loadApp();
    app.state.exercises = [{
      id: 'ex-row', day: 'Day 2', name: 'Seated Cable Row',
      image_key: 'seated-cable-row', sets_target: 3,
    }];
    app.state.sessions = [
      { id: 'sess-cross-day-new', day: 'Day 4', date: '2026-08-20' },
      { id: 'sess-same-day-old', day: 'Day 2', date: '2026-08-10' },
    ];
    app.Supabase.getSetLogs = async sessionId => sessionId === 'sess-same-day-old' ? [
      { session_id: sessionId, exercise_id: 'ex-row', set_number: 1, weight_lbs: 35, reps: 12, completed: true },
    ] : [];
    app.state.historyCache = {
      'ex-row': [{
        sessionId: 'sess-cross-day-new', date: '2026-08-20',
        sets: [{ session_id: 'sess-cross-day-new', exercise_id: 'ex-row', set_number: 1, weight_lbs: 50, reps: 10, completed: true }],
      }],
    };

    await app.loadLastLogs('Day 2');

    expect(app.state.lastLogs['ex-row'][0]).toMatchObject({ weight_lbs: 50, reps: 10 });
  });

  it('keeps a newer same-day session when cached cross-day history is stale', async () => {
    const app = loadApp();
    app.state.exercises = [{
      id: 'ex-row', day: 'Day 2', name: 'Seated Cable Row',
      image_key: 'seated-cable-row', sets_target: 3,
    }];
    app.state.sessions = [
      { id: 'sess-same-day-new', day: 'Day 2', date: '2026-08-20' },
      { id: 'sess-cross-day-old', day: 'Day 4', date: '2026-08-10' },
    ];
    app.Supabase.getSetLogs = async sessionId => sessionId === 'sess-same-day-new' ? [
      { session_id: sessionId, exercise_id: 'ex-row', set_number: 1, weight_lbs: 50, reps: 10, completed: true },
    ] : [];
    app.state.historyCache = {
      'ex-row': [{
        sessionId: 'sess-cross-day-old', date: '2026-08-10',
        sets: [{ session_id: 'sess-cross-day-old', exercise_id: 'ex-row', set_number: 1, weight_lbs: 40, reps: 12, completed: true }],
      }],
    };

    await app.loadLastLogs('Day 2');

    expect(app.state.lastLogs['ex-row'][0]).toMatchObject({ weight_lbs: 50, reps: 10 });
  });

  it('falls back to local set logs when the same-day network fetch fails', async () => {
    const app = loadApp();
    app.state.sessions = [{ id: 'sess-local', day: 'Day 2', date: '2026-08-20' }];
    app.Supabase.getSetLogs = async () => { throw new Error('offline'); };
    app.DB.getAll = async (store, index, sessionId) =>
      store === 'set_logs' && index === 'session_id' && sessionId === 'sess-local' ? [
        { session_id: sessionId, exercise_id: 'ex-row', set_number: 1, weight_lbs: 45, reps: 10, completed: true },
      ] : [];

    await app.loadLastLogs('Day 2');

    expect(app.state.lastLogs['ex-row'][0]).toMatchObject({ weight_lbs: 45, reps: 10 });
  });

  it('deduplicates repeated set numbers in the selected historical values', async () => {
    const app = loadApp();
    app.state.exercises = [{ id: 'ex-row', day: 'Day 2', name: 'Seated Cable Row', sets_target: 3 }];
    app.state.sessions = [{ id: 'sess-old', day: 'Day 4', date: '2026-08-20' }];
    app.state.historyCache = {
      'ex-row': [{
        sessionId: 'sess-old', date: '2026-08-20',
        sets: [
          { id: 'older', session_id: 'sess-old', exercise_id: 'ex-row', set_number: 1, weight_lbs: 40, reps: 10, completed: true, logged_at: '2026-08-20T10:00:00Z' },
          { id: 'newer', session_id: 'sess-old', exercise_id: 'ex-row', set_number: 1, weight_lbs: 45, reps: 10, completed: true, logged_at: '2026-08-20T10:01:00Z' },
        ],
      }],
    };

    await app.loadLastLogs('Day 2');

    expect(app.state.lastLogs['ex-row']).toHaveLength(1);
    expect(app.state.lastLogs['ex-row'][0].id).toBe('newer');
  });

  it('skips active-session history and uses the next-most-recent exercise values', async () => {
    const app = loadApp();
    app.state.exercises = [{ id: 'ex-row', day: 'Day 2', name: 'Seated Cable Row', sets_target: 3 }];
    app.state.activeSession = { id: 'sess-active', day: 'Day 2', date: '2026-08-29' };
    app.state.sessions = [{ id: 'sess-active', day: 'Day 2', date: '2026-08-29' }];
    app.state.historyCache = {
      'ex-row': [
        { sessionId: 'sess-active', date: '2026-08-29', sets: [{ session_id: 'sess-active', exercise_id: 'ex-row', set_number: 1, weight_lbs: 999, reps: 1, completed: true }] },
        { sessionId: 'sess-prior', date: '2026-08-20', sets: [{ session_id: 'sess-prior', exercise_id: 'ex-row', set_number: 1, weight_lbs: 45, reps: 10, completed: true }] },
      ],
    };

    await app.loadLastLogs('Day 2');

    expect(app.state.lastLogs['ex-row'][0]).toMatchObject({ weight_lbs: 45, reps: 10 });
  });
});

describe('personal records use individual-set volume', () => {
  const row = {
    id: 'ex-row', day: 'Day 2', section: '', name: 'Seated Cable Row',
    image_key: 'seated-cable-row', sets_target: 3, reps_target: '12',
    equipment: 'Cable Machine', instructions: [], sort_order: 1,
  };

  it('selects the historical set with the greatest weight × reps volume', async () => {
    const app = loadApp();
    app.navigator.onLine = false;
    app.state.exercises = [row];
    app.state.sessions = [
      { id: 'sess-heavy', day: 'Day 2', date: '2026-08-01' },
      { id: 'sess-volume', day: 'Day 2', date: '2026-08-08' },
    ];
    app.DB.getAll = async store => store === 'set_logs' ? [
      { id: 'heavy', session_id: 'sess-heavy', exercise_id: 'ex-row', set_number: 1, weight_lbs: 50, reps: 5, completed: true },
      { id: 'volume', session_id: 'sess-volume', exercise_id: 'ex-row', set_number: 1, weight_lbs: 40, reps: 12, completed: true },
    ] : [];

    await app.loadProgressData();

    expect(app.state.prCache['ex-row']).toMatchObject({
      weight_lbs: 40,
      reps: 12,
      sessionId: 'sess-volume',
    });
  });

  it('only awards a live PR when the new set volume is greater', () => {
    const app = loadApp();
    app.state.exercises = [row];
    app.state.sessionExercises = [row];
    app.state.prCache = { 'ex-row': { weight_lbs: 40, reps: 12, date: '2026-08-08' } };

    app.checkPR('ex-row', 50, 5); // 250 does not beat 480
    expect(app.state.prCache['ex-row']).toMatchObject({ weight_lbs: 40, reps: 12 });

    app.checkPR('ex-row', 45, 11); // 495 beats 480
    expect(app.state.prCache['ex-row']).toMatchObject({ weight_lbs: 45, reps: 11 });
  });

  it('keeps the lower-weight rule for assisted exercises and rejects a missing weight', () => {
    const app = loadApp();
    const assisted = {
      id: 'ex-assisted', day: 'Day 2', name: 'Assisted Pull-Up',
      image_key: 'assisted-pull-up', sets_target: 3,
    };
    app.state.exercises = [assisted];
    app.state.sessionExercises = [assisted];
    app.state.prCache = {};

    app.checkPR('ex-assisted', null, 8);
    expect(app.state.prCache['ex-assisted']).toBeUndefined();

    app.state.prCache['ex-assisted'] = { weight_lbs: 60, reps: 8, date: '2026-08-08' };
    app.checkPR('ex-assisted', 70, 12);
    expect(app.state.prCache['ex-assisted'].weight_lbs).toBe(60);

    app.checkPR('ex-assisted', 50, 6);
    expect(app.state.prCache['ex-assisted']).toMatchObject({ weight_lbs: 50, reps: 6 });
  });

  it('puts the history PR badge on the highest-volume set, not the heaviest set', () => {
    const app = loadApp();
    const session = { id: 'sess-pr', day: 'Day 2', date: '2026-08-08', notes: null };
    app.state.exercises = [row];
    app.state.sessions = [session];
    app.state.historySession = session;
    app.state.historyLogs = [
      { id: 'heavy', session_id: 'sess-pr', exercise_id: 'ex-row', set_number: 1, weight_lbs: 50, reps: 5, completed: true, logged_at: '2026-08-08T10:00:00Z' },
      { id: 'volume', session_id: 'sess-pr', exercise_id: 'ex-row', set_number: 2, weight_lbs: 40, reps: 12, completed: true, logged_at: '2026-08-08T10:01:00Z' },
    ];
    app.state.prCache = { 'ex-row': { weight_lbs: 40, reps: 12, date: '2026-08-08', sessionId: 'sess-pr' } };

    const html = app.renderSessionDetail();
    const prRow = html.split('<div class="sdet-set-row">').slice(1).find(part => part.includes('🏆 PR'));

    expect(prRow).toContain('40 lbs');
    expect(prRow).toContain('12 reps');
    expect(prRow).not.toContain('50 lbs');
  });

  it('does not put a PR badge on a different session from the same date', () => {
    const app = loadApp();
    const session = { id: 'sess-not-pr', day: 'Day 2', date: '2026-08-08', notes: null };
    app.state.exercises = [row];
    app.state.sessions = [session];
    app.state.historySession = session;
    app.state.historyLogs = [
      { id: 'same-performance', session_id: 'sess-not-pr', exercise_id: 'ex-row', set_number: 1, weight_lbs: 40, reps: 12, completed: true },
    ];
    app.state.prCache = {
      'ex-row': { weight_lbs: 40, reps: 12, date: '2026-08-08', sessionId: 'sess-pr' },
    };

    expect(app.renderSessionDetail()).not.toContain('🏆 PR');
  });

  it('does not put a PR badge on the PR session when no set matches the record', () => {
    const app = loadApp();
    const session = { id: 'sess-pr', day: 'Day 2', date: '2026-08-08', notes: null };
    app.state.exercises = [row];
    app.state.sessions = [session];
    app.state.historySession = session;
    app.state.historyLogs = [
      { id: 'different', session_id: 'sess-pr', exercise_id: 'ex-row', set_number: 1, weight_lbs: 35, reps: 12, completed: true },
    ];
    app.state.prCache = {
      'ex-row': { weight_lbs: 40, reps: 12, date: '2026-08-08', sessionId: 'sess-pr' },
    };

    expect(app.renderSessionDetail()).not.toContain('🏆 PR');
  });
});

describe('history cache freshness and reps-only prefill', () => {
  it('merges cached local sets when the direct same-session response is partial', async () => {
    const app = loadApp();
    app.state.exercises = [{
      id: 'ex-row', day: 'Day 2', name: 'Seated Cable Row', image_key: 'seated-cable-row',
      sets_target: 3, reps_target: '12', sort_order: 1,
    }];
    app.state.sessions = [{
      id: 'sess-latest', day: 'Day 2', date: '2026-08-29', created_at: '2026-08-29T18:00:00Z',
    }];
    app.state.historyCache = {
      'ex-row': [{
        sessionId: 'sess-latest', date: '2026-08-29', createdAt: '2026-08-29T18:00:00Z',
        sets: [
          { set_number: 1, weight_lbs: 40, reps: 10, completed: true },
          { set_number: 2, weight_lbs: 45, reps: 10, completed: true },
          { set_number: 3, weight_lbs: 50, reps: 8, completed: true },
        ],
      }],
    };
    app.Supabase.getSetLogs = async () => [
      { session_id: 'sess-latest', exercise_id: 'ex-row', set_number: 1, weight_lbs: 45, reps: 12, completed: true },
    ];
    app.DB.getAll = async store => store === 'pending_sync' ? [
      {
        table: 'set_logs', operation: 'insert',
        payload: { session_id: 'sess-latest', exercise_id: 'ex-row', set_number: 2, weight_lbs: 45, reps: 10, completed: true },
      },
      {
        table: 'set_logs', operation: 'insert',
        payload: { session_id: 'sess-latest', exercise_id: 'ex-row', set_number: 3, weight_lbs: 50, reps: 8, completed: true },
      },
    ] : [];

    await app.loadLastLogs('Day 2');

    expect(app.state.lastLogs['ex-row']).toHaveLength(3);
    expect(app.state.lastLogs['ex-row'][0]).toMatchObject({ weight_lbs: 45, reps: 12 });
  });

  it('does not resurrect a cache-only set after a successful direct read', async () => {
    const app = loadApp();
    app.state.exercises = [{
      id: 'ex-row', day: 'Day 2', name: 'Seated Cable Row', image_key: 'seated-cable-row',
      sets_target: 3, reps_target: '12', sort_order: 1,
    }];
    app.state.sessions = [{
      id: 'sess-latest', day: 'Day 2', date: '2026-08-29', created_at: '2026-08-29T18:00:00Z',
    }];
    app.state.historyCache = {
      'ex-row': [{
        sessionId: 'sess-latest', date: '2026-08-29', createdAt: '2026-08-29T18:00:00Z',
        sets: [
          { set_number: 1, weight_lbs: 45, reps: 12, completed: true },
          { set_number: 2, weight_lbs: 50, reps: 10, completed: true },
          { set_number: 3, weight_lbs: 55, reps: 8, completed: true },
        ],
      }],
    };
    app.Supabase.getSetLogs = async () => [
      { session_id: 'sess-latest', exercise_id: 'ex-row', set_number: 1, weight_lbs: 45, reps: 12, completed: true },
      { session_id: 'sess-latest', exercise_id: 'ex-row', set_number: 2, weight_lbs: 50, reps: 10, completed: true },
    ];
    app.DB.getAll = async () => [];

    await app.loadLastLogs('Day 2');

    expect(app.state.lastLogs['ex-row'].map(set => set.set_number)).toEqual([1, 2]);
  });

  it('treats a successful empty exercise response as authoritative', async () => {
    const app = loadApp();
    app.state.exercises = [{
      id: 'ex-row', day: 'Day 2', name: 'Seated Cable Row', image_key: 'seated-cable-row',
      sets_target: 3, reps_target: '12', sort_order: 1,
    }];
    app.state.sessions = [{
      id: 'sess-latest', day: 'Day 2', date: '2026-08-29', created_at: '2026-08-29T18:00:00Z',
    }];
    const staleEntry = {
      sessionId: 'sess-latest', date: '2026-08-29', createdAt: '2026-08-29T18:00:00Z',
      sets: [{ set_number: 1, weight_lbs: 45, reps: 12, completed: true }],
    };
    app.state.historyCache = { 'ex-row': [staleEntry] };
    app.state.lastCache = { 'ex-row': staleEntry };
    app.Supabase.getSetLogs = async () => [];
    app.DB.getAll = async () => [];

    await app.loadLastLogs('Day 2');

    expect(app.state.lastLogs['ex-row']).toBeUndefined();
  });

  it('keeps a complete direct fetch instead of stale partial cache data for the same session', async () => {
    const app = loadApp();
    app.state.exercises = [{
      id: 'ex-row', day: 'Day 2', name: 'Seated Cable Row', image_key: 'seated-cable-row',
      sets_target: 3, reps_target: '12', sort_order: 1,
    }];
    app.state.sessions = [{
      id: 'sess-latest', day: 'Day 2', date: '2026-08-29', created_at: '2026-08-29T18:00:00Z',
    }];
    app.state.historyCache = {
      'ex-row': [{
        sessionId: 'sess-latest', date: '2026-08-29', createdAt: '2026-08-29T18:00:00Z',
        sets: [{ set_number: 1, weight_lbs: 40, reps: 10, completed: true }],
      }],
    };
    app.Supabase.getSetLogs = async () => [
      { session_id: 'sess-latest', exercise_id: 'ex-row', set_number: 1, weight_lbs: 45, reps: 12, completed: true },
      { session_id: 'sess-latest', exercise_id: 'ex-row', set_number: 2, weight_lbs: 50, reps: 10, completed: true },
    ];

    await app.loadLastLogs('Day 2');

    expect(app.state.lastLogs['ex-row']).toHaveLength(2);
    expect(app.state.lastLogs['ex-row'][0]).toMatchObject({ weight_lbs: 45, reps: 12 });
  });

  it('ignores a newer checked-but-empty row and prefills the latest meaningful values', async () => {
    const app = loadApp();
    app.state.exercises = [{
      id: 'ex-row', day: 'Day 2', name: 'Seated Cable Row', image_key: 'seated-cable-row',
      sets_target: 3, reps_target: '12', sort_order: 1,
    }];
    app.state.sessions = [{
      id: 'sess-empty', day: 'Day 2', date: '2026-08-29', created_at: '2026-08-29T18:00:00Z',
    }];
    app.state.historyCache = {
      'ex-row': [{
        sessionId: 'sess-real', date: '2026-08-28', createdAt: '2026-08-28T18:00:00Z',
        sets: [{ weight_lbs: 45, reps: 12, completed: true }],
      }],
    };
    app.Supabase.getSetLogs = async () => [{
      session_id: 'sess-empty', exercise_id: 'ex-row', set_number: 1,
      weight_lbs: null, reps: null, notes: '', completed: true,
    }];

    await app.loadLastLogs('Day 2');

    expect(app.state.lastLogs['ex-row'][0]).toMatchObject({ weight_lbs: 45, reps: 12 });
  });

  it('rebuilds invalidated history before starting another workout day', async () => {
    const app = loadApp();
    app.crypto = globalThis.crypto;
    app.navigator.onLine = false;
    app.renderView = () => {};
    app.state.progressLoaded = false;
    app.state.user = { id: 'u1' };
    app.state.exercises = [{
      id: 'ex-row', day: 'Day 2', name: 'Seated Cable Row', image_key: 'seated-cable-row',
      sets_target: 3, reps_target: '12', sort_order: 1, instructions: [],
    }];
    app.state.sessions = [{
      id: 'sess-day4', day: 'Day 4', date: '2026-08-29', created_at: '2026-08-29T10:00:00Z',
    }];
    const recent = {
      id: 'row-day4', session_id: 'sess-day4', exercise_id: 'ex-row', set_number: 1,
      weight_lbs: 50, reps: 10, completed: true,
    };
    app.DB.getAll = async store => store === 'set_logs' ? [recent] : [];
    app.DB.put = async () => {};
    app.DB.queueSync = async () => {};

    await app.startSession('Day 2');

    expect(app.state.setLogs['ex-row'][0]).toMatchObject({ weight_lbs: 50, reps: 10 });
  });

  it('prefills reps-only history without creating a zero-volume PR', async () => {
    const app = loadApp();
    app.navigator.onLine = false;
    app.state.exercises = [{
      id: 'ex-bodyweight', day: 'Day 2', name: 'Jump Squats', image_key: 'jump-squats',
      sets_target: 3, reps_target: '15', sort_order: 1,
    }];
    app.state.sessions = [{ id: 'sess-day4', day: 'Day 4', date: '2026-08-20' }];
    app.DB.getAll = async store => store === 'set_logs' ? [
      {
        id: 'bodyweight-set', session_id: 'sess-day4', exercise_id: 'ex-bodyweight',
        set_number: 1, weight_lbs: null, reps: 15, completed: true,
      },
      {
        id: 'blank-set', session_id: 'sess-day4', exercise_id: 'ex-bodyweight',
        set_number: 2, weight_lbs: null, reps: null, notes: '', completed: true,
      },
    ] : [];

    await app.loadProgressData();
    await app.loadLastLogs('Day 2');

    expect(app.state.lastLogs['ex-bodyweight'][0]).toMatchObject({ weight_lbs: null, reps: 15 });
    expect(app.state.lastLogs['ex-bodyweight']).toHaveLength(1);
    expect(app.state.prCache['ex-bodyweight']).toBeUndefined();

    const progressHtml = app.renderProgress();
    app.state.progressExercise = 'ex-bodyweight';
    const detailHtml = app.renderProgressExercise();
    expect(progressHtml).toContain('15 reps');
    expect(detailHtml).toContain('15 reps');
    expect(progressHtml).not.toContain('null lbs');
    expect(detailHtml).not.toContain('null lbs');
  });
});

describe('Progress PR session identity', () => {
  it('marks only the actual PR workout when two sessions share a date', () => {
    const app = loadApp();
    const exercise = {
      id: 'ex-row', day: 'Day 2', name: 'Seated Cable Row', image_key: 'seated-cable-row',
      sets_target: 3, reps_target: '12', sort_order: 1,
    };
    const prSet = { weight_lbs: 40, reps: 12, completed: true };
    const laterSet = { weight_lbs: 50, reps: 5, completed: true };
    const history = [
      {
        sessionId: 'sess-other', date: '2026-08-29', createdAt: '2026-08-29T18:00:00Z',
        sets: [laterSet], bestSet: laterSet, displaySet: laterSet,
      },
      {
        sessionId: 'sess-pr', date: '2026-08-29', createdAt: '2026-08-29T08:00:00Z',
        sets: [prSet], bestSet: prSet, displaySet: prSet,
      },
    ];
    app.state.exercises = [exercise];
    app.state.routineDays = [{ label: 'Day 2', name: 'Day 2' }];
    app.state.historyCache = { 'ex-row': history };
    app.state.lastCache = { 'ex-row': history[0] };
    app.state.progressLoaded = true;
    app.state.prCache = {
      'ex-row': { ...prSet, date: '2026-08-29', sessionId: 'sess-pr' },
    };

    const progressHtml = app.renderProgress();
    expect(progressHtml.match(/<span class="pr-badge">/g) || []).toHaveLength(0);

    app.state.progressExercise = 'ex-row';
    app.state.progressRange = 'All';
    const detailHtml = app.renderProgressExercise();
    expect(detailHtml.match(/<div class="pr-badge">/g) || []).toHaveLength(1);
    expect(detailHtml.match(/>PR<\/text>/g) || []).toHaveLength(1);
  });
});

describe('weight set-row input (buildSetRow)', () => {
  it('does not restrict the weight field to a numeric-only keyboard', () => {
    const app = loadApp();
    const html = app.buildSetRow('ex-1', 0, { weight_lbs: null, reps: null, completed: false });

    const weightInputHtml = html.split('placeholder="lbs"')[0].split('<input').pop();
    expect(weightInputHtml).not.toContain('inputmode="decimal"');
  });

  it('still restricts the reps field to a numeric keyboard', () => {
    const app = loadApp();
    const html = app.buildSetRow('ex-1', 0, { weight_lbs: null, reps: null, completed: false });

    const repsInputHtml = html.split(/placeholder="(?:reps|secs)"/)[0].split('<input').pop();
    expect(repsInputHtml).toContain('inputmode="numeric"');
  });
});

describe('bar weight reference (Supabase-backed, not localStorage-only)', () => {
  let app;
  const ezBarCurl = {
    id: 'ex-ez-bar-curl', day: 'Day 2', section: 'Warmup + core',
    name: 'EZ Bar Curl', image_key: 'ez-bar-curl', equipment: 'EZ Bar',
    sets_target: 3, reps_target: '10', bar_weight_lbs: null,
  };

  beforeEach(() => {
    app = loadApp();
    app.state.exercises = [{ ...ezBarCurl }];
    app.state.sessionExercises = [{ ...ezBarCurl }];
    app.DB.put = async () => {};
    app.DB.queueSync = async () => {};
  });

  it('reads the saved value straight off the exercise row', () => {
    app.state.exercises[0].bar_weight_lbs = 25;
    expect(app.getBarWeight(app.state.exercises[0])).toBe('25');
  });

  it('persists to the exercises row, independent of localStorage', () => {
    app.saveBarWeight('ex-ez-bar-curl', '25');

    // Old bug: bar weight lived ONLY in localStorage, so a PWA reinstall or
    // Safari data purge silently wiped it. Clearing it here must not matter.
    app.localStorage.clear();

    expect(app.getBarWeight(app.state.exercises[0])).toBe('25');
  });

  it('updates every in-memory copy of the exercise (session + catalog)', () => {
    app.saveBarWeight('ex-ez-bar-curl', '25');
    expect(app.state.exercises[0].bar_weight_lbs).toBe(25);
    expect(app.state.sessionExercises[0].bar_weight_lbs).toBe(25);
  });

  it('clears the value when the field is emptied', () => {
    app.state.exercises[0].bar_weight_lbs = 25;
    app.state.sessionExercises[0].bar_weight_lbs = 25;
    app.saveBarWeight('ex-ez-bar-curl', '');
    expect(app.getBarWeight(app.state.exercises[0])).toBe('');
  });

  it('one-time migrates a legacy localStorage value onto the exercise row', () => {
    app.localStorage.setItem('wt_barweight_ez-bar-curl', '20');

    const got = app.getBarWeight(app.state.exercises[0]);

    expect(got).toBe('20');
    expect(app.state.exercises[0].bar_weight_lbs).toBe(20);
    expect(app.localStorage.getItem('wt_barweight_ez-bar-curl')).toBeNull();
  });

  it('includes bar_weight_lbs in the Supabase sync payload', () => {
    const ex = { ...ezBarCurl, bar_weight_lbs: 25 };
    expect(app.toExerciseRow(ex)).toMatchObject({ bar_weight_lbs: 25 });
  });
});

// Regression: non-superset (named or heading-less) sections had no way to
// delete/dissolve the heading — only rename. Supersets already had "Ungroup
// all exercises" via the ⋮ menu; dissolveSection is the equivalent for plain
// sections (drop the heading, merge exercises into the flat list).
describe('dissolveSection', () => {
  const warmup1 = {
    id: 'ex-warmup-1', day: 'Day 1', section: 'Warmup', name: 'Jumping Jacks',
    sets_target: 3, reps_target: '20', equipment: '', instructions: [],
    image_key: null, superset_group: null, sort_order: 0,
  };
  const warmup2 = {
    id: 'ex-warmup-2', day: 'Day 1', section: 'Warmup', name: 'High Knees',
    sets_target: 3, reps_target: '20', equipment: '', instructions: [],
    image_key: null, superset_group: null, sort_order: 1,
  };
  const mainLift = {
    id: 'ex-main-1', day: 'Day 1', section: 'Main', name: 'Squat',
    sets_target: 5, reps_target: '5', equipment: 'Barbell', instructions: [],
    image_key: null, superset_group: null, sort_order: 2,
  };

  it('clears the section on every exercise in that section during an active session', () => {
    const app = loadApp();
    app.state.view = 'workout';
    app.state.sessionExercises = [{ ...warmup1 }, { ...warmup2 }, { ...mainLift }];

    app.dissolveSection('Warmup');

    expect(app.state.sessionExercises.find(e => e.id === 'ex-warmup-1').section).toBe('');
    expect(app.state.sessionExercises.find(e => e.id === 'ex-warmup-2').section).toBe('');
    expect(app.state.sessionExercises.find(e => e.id === 'ex-main-1').section).toBe('Main');
  });

  it('clears the section on the edit-day draft and marks it dirty', () => {
    const app = loadApp();
    app.state.view = 'edit-day';
    app.state.editDay = 'Day 1';
    app.state.editDirty = false;
    app.state.editDraft = [{ ...warmup1 }, { ...warmup2 }, { ...mainLift }];

    app.dissolveSection('Warmup');

    expect(app.state.editDraft.find(e => e.id === 'ex-warmup-1').section).toBe('');
    expect(app.state.editDraft.find(e => e.id === 'ex-warmup-2').section).toBe('');
    expect(app.state.editDraft.find(e => e.id === 'ex-main-1').section).toBe('Main');
    expect(app.state.editDirty).toBe(true);
  });
});

// Regression: unescaped user text (custom exercise names, notes) in
// renderExerciseDetail — found by /qa on 2026-07-04. exercise names/notes
// are user-typed free text (custom exercises are user-renamed, notes are
// free-form), so rendering them straight into innerHTML without esc()
// breaks display (or worse) whenever the text contains "<", "&", or a
// stray closing tag. Every other render site in this file already used
// esc() for the same fields; these two were the odd ones out.
describe('exercise name / notes escaping (renderExerciseDetail)', () => {
  const baseSetup = (app, ex, notes = {}) => {
    app.state.detailExercise = ex;
    app.state.setLogs = { [ex.id]: [] };
    app.state.skipped = new Set();
    app.state.exerciseNotes = notes;
    app.state.sessionExercises = [ex];
  };

  it('escapes a custom exercise name in the detail page title / rename input', () => {
    const app = loadApp();
    const dangerousName = 'Curl<img src=x onerror=alert(1)>';
    const ex = {
      id: 'custom-1', name: dangerousName, day: 'Day 2', section: 'Custom',
      sets_target: 3, reps_target: '10', equipment: '', instructions: [],
      image_key: null, superset_group: null, sort_order: 9000, _custom: true,
    };
    baseSetup(app, ex);

    const html = app.renderExerciseDetail();

    expect(html).not.toContain(dangerousName);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes exercise notes in the notes textarea', () => {
    const app = loadApp();
    const dangerousNote = 'felt good </textarea><script>bad</script> today';
    const ex = {
      id: 'ex-1', name: 'Bench Press', day: 'Day 1', section: 'Main',
      sets_target: 3, reps_target: '10', equipment: 'Barbell', instructions: [],
      image_key: 'bench-press', superset_group: null, sort_order: 1,
    };
    baseSetup(app, ex, { [ex.id]: dangerousNote });

    const html = app.renderExerciseDetail();

    expect(html).not.toContain('</textarea><script>');
  });

  it('escapes a user-entered equipment value in the equipment chips', () => {
    const app = loadApp();
    const ex = {
      id: 'ex-2', name: 'Cable Crunch', day: 'Library', section: '',
      sets_target: 3, reps_target: '10', equipment: '<b>Cable Machine</b>',
      instructions: [], image_key: null, superset_group: null, sort_order: 0,
    };
    baseSetup(app, ex);

    const html = app.renderExerciseDetail();

    expect(html).not.toContain('<b>Cable Machine</b>');
    expect(html).toContain('&lt;b&gt;Cable Machine&lt;/b&gt;');
  });
});
