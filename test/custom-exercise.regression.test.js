// Adding a NON-library (custom) exercise must work in both entry points and
// stay private to the account that creates it:
//   - routine edit view: create form targeting the day (submitNewExercise)
//   - workout view:       addCustomExercise (existing; session-scoped)
import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp } from './helpers/load-app.js';

describe('create a custom exercise into the day being edited (full form)', () => {
  let app, queued, nav;

  beforeEach(() => {
    app = loadApp();
    app.crypto = { randomUUID: () => 'ex-new-1' };
    app.Supabase.getUser = () => ({ id: 'U1' });
    app.toast = () => {};
    nav = null;
    app.navigateTo = (view) => { nav = view; };
    app.syncIfOnline = () => {};
    queued = null;
    app.DB.put = async () => {};
    app.DB.queueSync = async (table, op, payload) => { queued = { table, op, payload }; };
    app.state.routineDays = [{ label: 'Day 2', name: 'Pull' }];
    app.state.editDay = 'Day 2';
    app.state.exercises = [];
    app.state.editDraft = [];
    app.state.createExerciseTarget = 'editDay'; // opened from the routine editor
    const fields = {
      'ne-name': { value: 'Cable Crunch' },
      'ne-equipment': { value: 'Cable Machine' },
      'ne-instructions': { value: 'Step A\nStep B' },
      'ne-assisted': { checked: false },
    };
    app.document.getElementById = id => fields[id] || null;
  });

  it('saves a user-owned exercise into the edited day, then returns to it', () => {
    app.submitNewExercise();

    // Persisted into the day (not the Library), owned by the account.
    expect(queued.table).toBe('exercises');
    expect(queued.op).toBe('insert');
    expect(queued.payload.day).toBe('Day 2');
    expect(queued.payload.user_id).toBe('U1');
    expect(queued.payload.instructions).toEqual(['Step A', 'Step B']);
    expect(queued.payload.image_key ?? null).toBeNull();

    // Shows in the day's draft immediately and lands back on the edit view.
    expect(app.state.exercises).toHaveLength(1);
    expect(app.state.editDraft).toHaveLength(1);
    expect(app.state.editDraft[0].name).toBe('Cable Crunch');
    expect(app.state.editDirty).toBe(true);
    expect(app.state.createExerciseTarget).toBeNull();
    expect(nav).toBe('edit-day');
  });
});

describe('create-exercise form (name, equipment, instructions — no image)', () => {
  let app, queued;

  beforeEach(() => {
    app = loadApp();
    app.crypto = { randomUUID: () => 'ex-created-1' };
    app.Supabase.getUser = () => ({ id: 'U1' });
    app.toast = () => {};
    app.navigateTo = () => {};
    app.syncIfOnline = () => {};
    app.state.exercises = [];
    queued = null;
    app.DB.put = async () => {};
    app.DB.queueSync = async (table, op, payload) => { queued = { table, op, payload }; };
    const fields = {
      'ne-name': { value: 'Cable Crunch' },
      'ne-equipment': { value: 'Cable Machine' },
      'ne-instructions': { value: 'Kneel below the cable\nCrunch down\n\n   ' },
      'ne-assisted': { checked: false },
    };
    app.document.getElementById = id => fields[id] || null;
  });

  it('saves instructions as a step list, no image, owned by the account', () => {
    app.submitNewExercise();

    expect(queued.table).toBe('exercises');
    expect(queued.op).toBe('insert');
    expect(queued.payload.name).toBe('Cable Crunch');
    expect(queued.payload.equipment).toBe('Cable Machine');
    expect(queued.payload.instructions).toEqual(['Kneel below the cable', 'Crunch down']);
    expect(queued.payload.image_key ?? null).toBeNull();
    expect(queued.payload.user_id).toBe('U1');
  });
});

describe('add a custom exercise in the workout view (existing path, unaffected)', () => {
  let app;

  beforeEach(() => {
    app = loadApp();
    app.renderView = () => {};
    app.saveSessionSnapshotSoon = () => {};
    app.state.activeDay = 'Day 1';
    app.state.activeSession = { id: 'sess-1' };
    app.state.sessionExercises = [];
    app.state.setLogs = {};
  });

  it('adds a blank custom exercise into the active session with set rows', () => {
    app.addCustomExercise();

    const custom = app.state.sessionExercises.filter(e => e._custom);
    expect(custom).toHaveLength(1);
    expect(custom[0].name).toBe('New Exercise');
    expect(app.state.setLogs[custom[0].id].length).toBeGreaterThan(0);
  });
});
