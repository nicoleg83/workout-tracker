// Adding a NON-library (custom) exercise must work in both entry points and
// stay private to the account that creates it:
//   - routine edit view: addBlankExerciseToDraft (new; created into the day)
//   - workout view:       addCustomExercise (existing; session-scoped)
import { describe, it, expect, beforeEach } from 'vitest';
import { loadApp } from './helpers/load-app.js';

describe('add a custom exercise in the routine edit view', () => {
  let app, queued;

  beforeEach(() => {
    app = loadApp();
    app.crypto = { randomUUID: () => 'ex-new-1' };
    app.Supabase.getUser = () => ({ id: 'U1' });
    app.renderView = () => {};
    app.syncIfOnline = () => {};
    queued = null;
    app.DB.put = async () => {};
    app.DB.queueSync = async (table, op, payload) => { queued = { table, op, payload }; };
    app.state.editDay = 'Day 2';
    app.state.exercises = [];
    app.state.editDraft = [];
  });

  it('creates a named, user-owned exercise directly in the edited day', async () => {
    app.prompt = () => 'Cable Crunch';

    await app.addBlankExerciseToDraft();

    expect(app.state.editDraft).toHaveLength(1);
    const row = app.state.editDraft[0];
    expect(row.name).toBe('Cable Crunch');
    expect(row.day).toBe('Day 2');           // lands in the day, not the Library
    expect(app.state.editDirty).toBe(true);

    // Synced as an insert stamped with the current account's id.
    expect(queued.table).toBe('exercises');
    expect(queued.op).toBe('insert');
    expect(queued.payload.user_id).toBe('U1');
    expect(queued.payload.name).toBe('Cable Crunch');
  });

  it('is a no-op when the name prompt is cancelled/blank', async () => {
    app.prompt = () => '';

    await app.addBlankExerciseToDraft();

    expect(app.state.editDraft).toHaveLength(0);
    expect(queued).toBeNull();
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
