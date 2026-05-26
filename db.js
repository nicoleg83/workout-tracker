const DB = (() => {
  const DB_NAME = 'workout-tracker';
  const DB_VERSION = 1;
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

  // Queue a write for later sync
  async function queueSync(table, operation, payload) {
    const id = crypto.randomUUID();
    await put('pending_sync', { id, table, operation, payload, created_at: Date.now(), attempts: 0 });
  }

  // Flush pending_sync to Supabase
  async function flushSync() {
    const pending = await getAll('pending_sync');
    if (!pending.length) return;
    // Sessions must be inserted before set_logs (FK dependency)
    pending.sort((a, b) => {
      const order = { sessions: 0, set_logs: 1 };
      return (order[a.table] ?? 2) - (order[b.table] ?? 2) || a.created_at - b.created_at;
    });
    for (const item of pending) {
      try {
        if (item.operation === 'insert') {
          await Supabase.insert(item.table, item.payload);
        } else if (item.operation === 'update') {
          await Supabase.update(item.table, item.payload);
        }
        await del('pending_sync', item.id);
      } catch (err) {
        item.attempts += 1;
        await put('pending_sync', item);
      }
    }
  }

  return { open, getAll, get, put, bulkPut, del, count, queueSync, flushSync };
})();
