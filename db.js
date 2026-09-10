const DB = (() => {
  const DB_NAME = 'workout-tracker';
  const DB_VERSION = 2;
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('exercises')) {
          const ex = db.createObjectStore('exercises', { keyPath: 'id' });
          ex.createIndex('day', 'day');
        }
        if (!db.objectStoreNames.contains('sessions')) {
          const s = db.createObjectStore('sessions', { keyPath: 'id' });
          s.createIndex('day', 'day');
          s.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('set_logs')) {
          const sl = db.createObjectStore('set_logs', { keyPath: 'id' });
          sl.createIndex('session_id', 'session_id');
          sl.createIndex('exercise_id', 'exercise_id');
        }
        if (!db.objectStoreNames.contains('pending_sync')) {
          db.createObjectStore('pending_sync', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('routine_days')) {
          db.createObjectStore('routine_days', { keyPath: 'id' });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  async function getAll(store, indexName, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const s = tx.objectStore(store);
      const req = indexName ? s.index(indexName).getAll(value) : s.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(store, id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(store, record) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function bulkPut(store, records) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const s = tx.objectStore(store);
      records.forEach(r => s.put(r));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function del(store, id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function count(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Local records may carry private bookkeeping fields. Never send those to
  // Supabase, whose tables intentionally do not have matching columns.
  function remotePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
    return Object.fromEntries(Object.entries(payload).filter(([key]) => !key.startsWith('_')));
  }

  async function setSyncPending(table, id, pending) {
    if (!id || (table !== 'sessions' && table !== 'set_logs')) return;
    const local = await get(table, id);
    if (local) await put(table, { ...local, _sync_pending: pending });
  }

  // Queue a write for later sync. A newer write to the same row supersedes any
  // still-queued one (same table + operation + payload id), so an offline
  // session doesn't pile up dozens of stale snapshots of the same record —
  // only the latest payload flushes.
  async function queueSync(table, operation, payload) {
    const queuedPayload = remotePayload(payload);
    if (queuedPayload?.id) {
      const pending = await getAll('pending_sync');
      for (const p of pending) {
        if (p.table === table && p.operation === operation && p.payload?.id === queuedPayload.id) {
          await del('pending_sync', p.id);
        }
      }
      if (operation !== 'delete') await setSyncPending(table, queuedPayload.id, true);
    }
    const id = crypto.randomUUID();
    await put('pending_sync', { id, table, operation, payload: queuedPayload, created_at: Date.now(), attempts: 0 });
  }

  // Drop every queued write belonging to a session (the session row itself and
  // its set_logs). Used when a never-synced session is discarded so a pending
  // insert can't resurrect it on the next flush.
  async function purgePendingForSession(sessionId) {
    const pending = await getAll('pending_sync');
    for (const p of pending) {
      if (p.payload?.id === sessionId || p.payload?.session_id === sessionId) {
        await del('pending_sync', p.id);
      }
    }
  }

  async function completeSyncItem(item) {
    if (item.operation !== 'delete') await setSyncPending(item.table, item.payload?.id, false);
    await del('pending_sync', item.id);
  }

  async function failSyncItem(item) {
    item.attempts += 1;
    await put('pending_sync', item);
  }

  async function flushOne(item) {
    try {
      if (item.operation === 'insert') {
        await Supabase.insert(item.table, remotePayload(item.payload));
      } else if (item.operation === 'update') {
        await Supabase.update(item.table, remotePayload(item.payload));
      } else if (item.operation === 'delete') {
        await Supabase.deleteRecord(item.table, item.payload.id);
      }
      await completeSyncItem(item);
    } catch (err) {
      await failSyncItem(item);
    }
  }

  // Flush pending_sync to Supabase. Large insert backlogs are sent in bounded
  // batches, with an item-by-item fallback so one bad row cannot block the rest.
  async function flushSync() {
    const pending = await getAll('pending_sync');
    if (!pending.length) return;
    // Sessions must be inserted before set_logs (FK dependency)
    pending.sort((a, b) => {
      const order = { sessions: 0, set_logs: 1 };
      return (order[a.table] ?? 2) - (order[b.table] ?? 2) || a.created_at - b.created_at;
    });

    const completed = new Set();
    for (const table of ['sessions', 'set_logs']) {
      const items = pending.filter(item => item.table === table && item.operation === 'insert');
      for (let i = 0; i < items.length; i += 100) {
        const batch = items.slice(i, i + 100);
        try {
          await Supabase.insert(table, batch.map(item => remotePayload(item.payload)));
          for (const item of batch) {
            await completeSyncItem(item);
            completed.add(item.id);
          }
        } catch (_) {
          // A batch is atomic. Retry rows separately so valid data still drains
          // while the exact failing row remains queued for recovery.
          for (const item of batch) {
            await flushOne(item);
            const stillQueued = await get('pending_sync', item.id);
            if (!stillQueued) completed.add(item.id);
          }
        }
      }
    }

    for (const item of pending) {
      if (!completed.has(item.id) && !(item.operation === 'insert' && (item.table === 'sessions' || item.table === 'set_logs'))) {
        await flushOne(item);
      }
    }
  }

  return { open, getAll, get, put, bulkPut, del, count, queueSync, purgePendingForSession, flushSync, setSyncPending };
})();
