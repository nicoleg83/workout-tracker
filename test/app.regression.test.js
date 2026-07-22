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
