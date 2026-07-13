// Regression tests for the 2026-07-13 investigation:
//  1. Mid-workout state (supersets, removals, order) survives a PWA kill+resume
//  2. Sessions don't reach Supabase (or History) until a set is completed
//  3. Discarded empty sessions can't be resurrected by a queued insert
//  4. Soft delete + Recently deleted recovery (restore / delete forever)
//  5. Pending local catalog edits win over a stale server fetch
//  6. Fixed 3-set default, no suggested sets/reps displays
import { describe, it, expect } from 'vitest';
import { loadApp } from './helpers/load-app.js';

const SNAPSHOT_DEBOUNCE_MS = 450; // saveSessionSnapshotSoon coalesces at 400ms

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function stubDb(ctx) {
  ctx.crypto = globalThis.crypto;
  ctx.confirm = () => true;
  const stores = { sessions: new Map(), set_logs: new Map(), pending_sync: new Map(), exercises: new Map() };
  let qn = 0;
  ctx.DB.put = async (store, rec) => { stores[store].set(rec.id, rec); return rec.id; };
  ctx.DB.get = async (store, id) => stores[store].get(id);
  ctx.DB.del = async (store, id) => { stores[store].delete(id); };
  ctx.DB.getAll = async (store, index, value) => {
    let all = [...stores[store].values()];
    if (index === 'session_id') all = all.filter(r => r.session_id === value);
    if (index === 'day') all = all.filter(r => r.day === value);
    return all;
  };
  ctx.DB.count = async (store) => stores[store].size;
  ctx.DB.bulkPut = async (store, records) => { records.forEach(r => stores[store].set(r.id, r)); };
  // Mirrors real queueSync semantics incl. same-row dedup (latest wins).
  ctx.DB.queueSync = async (table, operation, payload) => {
    if (payload?.id) {
      for (const [k, p] of stores.pending_sync) {
        if (p.table === table && p.operation === operation && p.payload?.id === payload.id) {
          stores.pending_sync.delete(k);
        }
      }
    }
    const id = `q-${qn++}`;
    stores.pending_sync.set(id, { id, table, operation, payload, created_at: Date.now(), attempts: 0 });
  };
  ctx.DB.purgePendingForSession = async (sessionId) => {
    for (const [k, p] of stores.pending_sync) {
      if (p.payload?.id === sessionId || p.payload?.session_id === sessionId) {
        stores.pending_sync.delete(k);
      }
    }
  };
  ctx.DB.flushSync = async () => {};
  return stores;
}

const CATALOG = [
  { id: 'ex-1', day: 'Day 1', section: '', name: 'Bench', sets_target: 3, reps_target: '10', superset_group: null, sort_order: 1, instructions: [], image_key: null },
  { id: 'ex-2', day: 'Day 1', section: '', name: 'Row', sets_target: 3, reps_target: '10', superset_group: null, sort_order: 2, instructions: [], image_key: null },
  { id: 'ex-3', day: 'Day 1', section: '', name: 'Curl', sets_target: 3, reps_target: '10', superset_group: null, sort_order: 3, instructions: [], image_key: null },
];

async function freshSession(ctx) {
  ctx.state.exercises = CATALOG.map(e => ({ ...e }));
  ctx.state.user = { id: 'u1' };
  await ctx.startSession('Day 1');
}

// Simulate the PWA being killed and reopened: state wiped, session + logs
// reloaded from the (stubbed) local DB, resume path re-run.
async function killAndResume(ctx, stores) {
  const savedId = ctx.state.activeSession.id;
  ctx.state.sessions = [...stores.sessions.values()];
  ctx.state.activeSession = null;
  ctx.state.sessionExercises = [];
  ctx.state.setLogs = {};
  ctx.localStorage.setItem('activeWorkoutSessionId', savedId);
  await ctx.tryResumeSession();
}

describe('mid-workout state survives app kill + resume', () => {
  it('persists a superset created mid-session (superset_group in meta + restored)', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    await freshSession(ctx);

    ctx.createNewGroup('ex-1'); // supersets Bench + Row via the group picker path
    const groupId = ctx.state.sessionExercises.find(e => e.id === 'ex-1').superset_group;
    expect(groupId).toBeTruthy();
    await sleep(SNAPSHOT_DEBOUNCE_MS); // let the debounced snapshot write

    const meta = JSON.parse(stores.sessions.get(ctx.state.activeSession.id).notes);
    expect(meta.exercises.find(e => e.id === 'ex-1').superset_group).toBe(groupId);
    expect(meta.exercises.find(e => e.id === 'ex-2').superset_group).toBe(groupId);

    await killAndResume(ctx, stores);
    expect(ctx.state.sessionExercises.find(e => e.id === 'ex-1').superset_group).toBe(groupId);
    expect(ctx.state.sessionExercises.find(e => e.id === 'ex-2').superset_group).toBe(groupId);
  });

  it('keeps a mid-session exercise removal after app kill (no default-list fallback)', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    await freshSession(ctx);

    ctx.removeExerciseFromSession('ex-3');
    await sleep(SNAPSHOT_DEBOUNCE_MS);

    await killAndResume(ctx, stores);
    expect(ctx.state.sessionExercises.find(e => e.id === 'ex-3')).toBeUndefined();
    expect(ctx.state.sessionExercises.find(e => e.id === 'ex-1')).toBeTruthy();
  });

  it('writes meta at session start, so notes is never null (no fallback window)', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    await freshSession(ctx);
    const row = stores.sessions.get(ctx.state.activeSession.id);
    expect(row.notes).toBeTruthy();
    expect(JSON.parse(row.notes).finished).toBe(false);
  });

  it('restores an ungrouped (empty) section faithfully instead of reverting to the catalog section', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    ctx.state.exercises = CATALOG.map(e => ({ ...e, section: 'Push' }));
    ctx.state.user = { id: 'u1' };
    await ctx.startSession('Day 1');
    ctx.dissolveSection('Push'); // clear the heading mid-session
    await sleep(SNAPSHOT_DEBOUNCE_MS);
    await killAndResume(ctx, stores);
    expect(ctx.state.sessionExercises.find(e => e.id === 'ex-1').section).toBe('');
  });
});

describe('sessions only sync once a set is completed', () => {
  it('queues nothing for Supabase at startSession', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    await freshSession(ctx);
    expect([...stores.pending_sync.values()].filter(p => p.table === 'sessions')).toHaveLength(0);
  });

  it('hides the not-yet-finished session from History', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    await freshSession(ctx);
    expect(ctx.isSessionFinished(stores.sessions.get(ctx.state.activeSession.id))).toBe(false);
  });

  it('queues the session upsert (with meta) together with the first completed set', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    await freshSession(ctx);
    ctx.state.setLogs['ex-1'][0].weight_lbs = 100;
    ctx.state.setLogs['ex-1'][0].reps = 8;
    await ctx.toggleComplete('ex-1', 0);
    const pending = [...stores.pending_sync.values()];
    const sessionOps = pending.filter(p => p.table === 'sessions');
    const logOps = pending.filter(p => p.table === 'set_logs');
    expect(sessionOps).toHaveLength(1);
    expect(sessionOps[0].operation).toBe('insert'); // upsert, never a blind PATCH
    expect(JSON.parse(sessionOps[0].payload.notes).finished).toBe(false);
    expect(logOps).toHaveLength(1);
  });

  it('discarding an empty session purges its queued writes and queues a server delete', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    ctx.navigator.onLine = false; // gym dead zone
    await freshSession(ctx);
    const sessionId = ctx.state.activeSession.id;
    await ctx.endAndGoHome();
    expect(stores.sessions.has(sessionId)).toBe(false);
    const leftover = [...stores.pending_sync.values()].filter(p => p.payload?.id === sessionId || p.payload?.session_id === sessionId);
    expect(leftover).toHaveLength(1);
    expect(leftover[0].operation).toBe('delete'); // cleanup survives offline; nothing can resurrect it
  });
});

describe('recently deleted sessions (soft delete + recovery)', () => {
  async function finishedSession(ctx, stores) {
    await freshSession(ctx);
    ctx.state.setLogs['ex-1'][0].weight_lbs = 100;
    ctx.state.setLogs['ex-1'][0].reps = 8;
    await ctx.toggleComplete('ex-1', 0);
    await ctx.saveSessionMeta(true);
    const id = ctx.state.activeSession.id;
    ctx.state.sessions = [...stores.sessions.values()];
    ctx.state.activeSession = null;
    ctx.localStorage.removeItem('activeWorkoutSessionId');
    return id;
  }

  it('deleteSession soft-deletes: keeps set_logs, stamps deleted_at, queues the sync', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    const id = await finishedSession(ctx, stores);
    await ctx.deleteSession(id);
    const row = stores.sessions.get(id);
    expect(row.deleted_at).toBeTruthy();
    expect((await ctx.DB.getAll('set_logs', 'session_id', id)).length).toBe(1);
    const op = [...stores.pending_sync.values()].find(p => p.table === 'sessions' && p.payload.id === id);
    expect(op.operation).toBe('insert');
    expect(op.payload.deleted_at).toBe(row.deleted_at);
  });

  it('soft-deleted sessions leave History/home but appear under Recently deleted', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    const id = await finishedSession(ctx, stores);
    await ctx.deleteSession(id);
    expect(ctx.renderHistory()).not.toContain(`data-session-id="${id}"`);
    expect(ctx.renderHistory()).toContain('Recently deleted (1)');
    expect(ctx.renderDeletedSessions()).toContain(`restoreDeletedSession('${id}')`);
  });

  it('restore clears deleted_at (explicit null so it syncs) and returns it to History', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    const id = await finishedSession(ctx, stores);
    await ctx.deleteSession(id);
    await ctx.restoreDeletedSession(id);
    expect(stores.sessions.get(id).deleted_at).toBe(null);
    const op = [...stores.pending_sync.values()].find(p => p.table === 'sessions' && p.payload.id === id);
    expect(op.payload.deleted_at).toBe(null); // must reach the server to clear it there
    expect(ctx.renderHistory()).toContain(`data-session-id="${id}"`);
  });

  it('delete forever removes the session + logs and queues a durable server delete', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    const id = await finishedSession(ctx, stores);
    await ctx.deleteSession(id);
    await ctx.purgeDeletedSession(id);
    expect(stores.sessions.has(id)).toBe(false);
    expect((await ctx.DB.getAll('set_logs', 'session_id', id)).length).toBe(0);
    const ops = [...stores.pending_sync.values()].filter(p => p.payload?.id === id);
    expect(ops).toHaveLength(1);
    expect(ops[0].operation).toBe('delete');
  });

  it('prunes soft-deleted sessions older than 30 days', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    const id = await finishedSession(ctx, stores);
    await ctx.deleteSession(id);
    const row = stores.sessions.get(id);
    row.deleted_at = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    ctx.state.sessions = [...stores.sessions.values()];
    await ctx.pruneDeletedSessions();
    expect(stores.sessions.has(id)).toBe(false);
  });

  it('excludes soft-deleted sessions from progress data (PRs, last-session prefill)', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    const id = await finishedSession(ctx, stores);
    ctx.navigator.onLine = false;
    await ctx.loadProgressData();
    expect(ctx.state.lastCache['ex-1']).toBeTruthy();
    await ctx.deleteSession(id);
    await ctx.loadProgressData();
    expect(ctx.state.lastCache['ex-1']).toBeUndefined();
  });
});

describe('pending local catalog edits win over a stale server fetch', () => {
  it('overlays still-queued exercise updates onto the fetched rows', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    ctx.state.user = { id: 'u1' };
    // Local edit queued but not flushable (flushSync stubbed as a no-op)
    await ctx.DB.queueSync('exercises', 'update', { id: 'ex-1', day: 'Library', section: '', superset_group: null, sort_order: 99 });
    ctx.Supabase.getExercises = async () => CATALOG.map(e => ({ ...e })); // stale server rows
    await ctx.loadExercises();
    const bench = ctx.state.exercises.find(e => e.id === 'ex-1');
    expect(bench.day).toBe('Library'); // the pending removal-to-Library wins on screen
  });
});

describe('fixed 3-set default, no suggested targets', () => {
  it('pre-populates exactly 3 sets regardless of sets_target', async () => {
    const ctx = loadApp();
    stubDb(ctx);
    ctx.state.exercises = CATALOG.map(e => ({ ...e, sets_target: 5 }));
    ctx.state.user = { id: 'u1' };
    await ctx.startSession('Day 1');
    expect(ctx.state.setLogs['ex-1']).toHaveLength(3);
  });

  it('keeps note-only rows (Warmup/Abs, sets_target 0) at zero sets', async () => {
    const ctx = loadApp();
    stubDb(ctx);
    await freshSession(ctx);
    const warmupId = ctx.state.sessionExercises.find(e => e.name === 'Warmup').id;
    expect(ctx.state.setLogs[warmupId]).toHaveLength(0);
  });

  it('resume keeps sets the user added beyond the default 3', async () => {
    const ctx = loadApp();
    const stores = stubDb(ctx);
    await freshSession(ctx);
    ctx.addSet('ex-1'); // set 4
    ctx.state.setLogs['ex-1'][3].weight_lbs = 50;
    ctx.state.setLogs['ex-1'][3].reps = 10;
    await ctx.toggleComplete('ex-1', 3);
    await sleep(SNAPSHOT_DEBOUNCE_MS);
    await killAndResume(ctx, stores);
    expect(ctx.state.setLogs['ex-1']).toHaveLength(4);
    expect(ctx.state.setLogs['ex-1'][3].completed).toBe(true);
  });

  it('shows no sets×reps target in the workout list or detail info card', async () => {
    const ctx = loadApp();
    stubDb(ctx);
    await freshSession(ctx);
    expect(ctx.renderWorkout()).not.toContain('3×10');
    ctx.state.detailExercise = ctx.state.sessionExercises.find(e => e.id === 'ex-1');
    ctx.state.view = 'exercise-detail';
    const detail = ctx.renderExerciseDetail();
    expect(detail).not.toContain('3 sets');
    expect(detail).not.toContain('10 reps');
  });

  it('offers − Remove set once more than one row exists (no target gating)', async () => {
    const ctx = loadApp();
    stubDb(ctx);
    await freshSession(ctx);
    ctx.state.detailExercise = ctx.state.sessionExercises.find(e => e.id === 'ex-1');
    ctx.state.view = 'exercise-detail';
    expect(ctx.renderExerciseDetail()).toContain('− Remove set');
  });
});
