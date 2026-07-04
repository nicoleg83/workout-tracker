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
