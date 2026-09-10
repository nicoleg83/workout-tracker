import { describe, it, expect } from 'vitest';
import { loadApp } from './helpers/load-app.js';

function request(result, error = null) {
  const req = { result, error, onsuccess: null, onerror: null };
  queueMicrotask(() => {
    if (error) req.onerror?.();
    else req.onsuccess?.();
  });
  return req;
}

function memoryIndexedDb() {
  const stores = new Map([
    ['exercises', new Map()],
    ['routine_days', new Map()],
    ['sessions', new Map()],
    ['set_logs', new Map()],
    ['pending_sync', new Map()],
  ]);
  const database = {
    objectStoreNames: { contains: name => stores.has(name) },
    transaction(name) {
      const rows = stores.get(name);
      return {
        objectStore() {
          return {
            getAll: () => request([...rows.values()]),
            get: id => request(rows.get(id)),
            put: record => {
              rows.set(record.id, structuredClone(record));
              return request(record.id);
            },
            delete: id => {
              rows.delete(id);
              return request(undefined);
            },
            count: () => request(rows.size),
          };
        },
      };
    },
  };
  return {
    stores,
    indexedDB: {
      open() {
        const req = { result: database, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
        queueMicrotask(() => req.onsuccess?.({ target: { result: database } }));
        return req;
      },
    },
  };
}

async function liveDbApp() {
  const ctx = loadApp();
  const memory = memoryIndexedDb();
  ctx.indexedDB = memory.indexedDB;
  ctx.crypto = globalThis.crypto;
  await ctx.DB.open();
  return { ctx, stores: memory.stores };
}

describe('durable sync queue', () => {
  it('keeps local-only markers out of Supabase payloads', async () => {
    const { ctx } = await liveDbApp();
    const log = {
      id: 'log-1', session_id: 'session-1', exercise_id: 'exercise-1',
      completed: true, _sync_pending: true,
    };
    await ctx.DB.put('set_logs', log);
    await ctx.DB.queueSync('set_logs', 'insert', log);

    const [queued] = await ctx.DB.getAll('pending_sync');
    expect(queued.payload).not.toHaveProperty('_sync_pending');
    expect((await ctx.DB.get('set_logs', log.id))._sync_pending).toBe(true);
  });

  it('batches a large backlog and clears rows only after Supabase confirms them', async () => {
    const { ctx } = await liveDbApp();
    const calls = [];
    ctx.Supabase.insert = async (table, payload) => calls.push({ table, payload });

    const session = { id: 'session-1', day: 'Day 1' };
    await ctx.DB.put('sessions', session);
    await ctx.DB.queueSync('sessions', 'insert', session);
    for (let i = 0; i < 205; i += 1) {
      const log = { id: `log-${i}`, session_id: session.id, exercise_id: 'exercise-1', completed: true };
      await ctx.DB.put('set_logs', log);
      await ctx.DB.queueSync('set_logs', 'insert', log);
    }

    await ctx.DB.flushSync();

    expect(calls.map(call => [call.table, call.payload.length])).toEqual([
      ['sessions', 1], ['set_logs', 100], ['set_logs', 100], ['set_logs', 5],
    ]);
    expect(await ctx.DB.count('pending_sync')).toBe(0);
    expect((await ctx.DB.get('set_logs', 'log-204'))._sync_pending).toBe(false);
  });

  it('falls back to individual writes and leaves only the failing row queued', async () => {
    const { ctx } = await liveDbApp();
    ctx.Supabase.insert = async (_table, payload) => {
      if (Array.isArray(payload)) throw new Error('batch rejected');
      if (payload.id === 'bad-log') throw new Error('row rejected');
    };
    for (const id of ['good-log', 'bad-log']) {
      const log = { id, session_id: 'session-1', exercise_id: 'exercise-1', completed: true };
      await ctx.DB.put('set_logs', log);
      await ctx.DB.queueSync('set_logs', 'insert', log);
    }

    await ctx.DB.flushSync();

    const queued = await ctx.DB.getAll('pending_sync');
    expect(queued.map(item => item.payload.id)).toEqual(['bad-log']);
    expect(queued[0].attempts).toBe(1);
    expect(queued[0].last_error).toBe('row rejected');
    expect(queued[0].last_attempt_at).toBeTruthy();
    expect((await ctx.DB.get('set_logs', 'good-log'))._sync_pending).toBe(false);
    expect((await ctx.DB.get('set_logs', 'bad-log'))._sync_pending).toBe(true);
  });
});
