// ── State ────────────────────────────────────────────────────────
const state = {
  tab: 'home',
  user: null,
  exercises: [],
  sessions: [],
  activeSession: null,
  activeDay: null,
  sessionExercises: [],
  defaultExerciseIds: [],
  setLogs: {},
  lastLogs: {},
  skipped: new Set(),
  exerciseNotes: {},
  restTimer: { active: false, remaining: 0, duration: 60, exerciseName: '' },
  view: 'home',
  detailExercise: null,
  historySession: null,
  historyLogs: [],
  progressDay: null,
  progressExercise: null,
  progressRange: '3M',
  detailSupersetId: null,
  prCache: null,
  lastCache: null,
  historyCache: null,
  progressLoaded: false,
  sessionPRCount: 0,
  loading: false,
  seeding: false,
};
let timerInterval = null;

// ── Helpers ──────────────────────────────────────────────────────
function uuid() { return crypto.randomUUID(); }
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
}
function daysAgo(d) {
  // Compare midnight-to-midnight so "Today" never flips to "Yesterday" mid-day
  const todayMs = new Date(today() + 'T00:00:00').getTime();
  const dMs = new Date(d + 'T00:00:00').getTime();
  const diff = Math.round((todayMs - dMs) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return `${diff} days ago`;
}
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
function startingWeight(range) {
  if (!range) return '';
  const parts = range.split('→');
  if (parts.length < 2) return range;
  const low = parts[0].trim();
  return /^\d+(\.\d+)?$/.test(low) ? `${low} lbs` : low;
}
function buildSectionGroups(exercises) {
  const groups = [];
  const idx = {};
  for (const ex of exercises) {
    const s = ex.section || 'Other';
    if (!(s in idx)) { idx[s] = groups.length; groups.push({ section: s, exercises: [] }); }
    groups[idx[s]].exercises.push(ex);
  }
  return groups;
}
function rebuildSessionExercisesFromDOM() {
  const view = document.getElementById('main-view');
  if (!view) return;
  const newOrder = [];
  view.querySelectorAll('#section-sortable .section-group').forEach(group => {
    group.querySelectorAll('.exercise-row[data-ex-id]').forEach(row => {
      const ex = state.sessionExercises.find(e => e.id === row.dataset.exId);
      if (ex) newOrder.push(ex);
    });
  });
  if (newOrder.length) state.sessionExercises = newOrder;
}
function resetExerciseOrder() {
  const ids = state.defaultExerciseIds;
  if (!ids.length) return;
  const byId = new Map(state.sessionExercises.map(e => [e.id, e]));
  const originalMap = new Map(state.exercises.map(e => [e.id, e]));
  state.sessionExercises = ids.map(id => {
    const ex = byId.get(id);
    if (!ex) return null;
    const orig = originalMap.get(id);
    if (orig) {
      ex.superset_group = orig.superset_group ?? null;
      ex.section = orig.section;
    }
    return ex;
  }).filter(Boolean);
  renderView();
}

// ── Toast ────────────────────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  setTimeout(() => { el.className = ''; }, 2500);
}

// ── Sync dot ─────────────────────────────────────────────────────
function updateSyncDot() {
  const dot = document.getElementById('sync-dot');
  if (!dot) return;
  if (!navigator.onLine) { dot.className = 'offline'; return; }
  DB.count('pending_sync').then(n => {
    dot.className = n > 0 ? 'pending' : '';
  });
}

// ── Data bootstrap ───────────────────────────────────────────────
async function loadExercises() {
  // Always fetch from Supabase when online so real UUIDs replace any stale local-* cache
  if (navigator.onLine) {
    try {
      let exs = await Supabase.getExercises();
      if (exs.length === 0) {
        await seedExercises();
        exs = await Supabase.getExercises();
      }
      // Remove any stale local-* entries before caching real UUIDs
      const cached = await DB.getAll('exercises');
      for (const ex of cached) {
        if (typeof ex.id === 'string' && ex.id.startsWith('local-')) {
          await DB.del('exercises', ex.id);
        }
      }
      await DB.bulkPut('exercises', exs);
      state.exercises = exs;
      return;
    } catch (_) {}
  }

  // Offline: use IndexedDB cache, or static fallback if nothing cached
  const cached = await DB.getAll('exercises');
  if (cached.length > 0) {
    state.exercises = cached;
  } else {
    state.exercises = EXERCISES.map((e, i) => ({ ...e, id: `local-${i}` }));
  }
}

async function seedExercises() {
  state.seeding = true;
  renderSeedingOverlay();
  const batches = chunk(EXERCISES, 25);
  for (const batch of batches) {
    try { await Supabase.insertExercises(batch); } catch (_) {}
  }
  state.seeding = false;
}

async function loadSessions() {
  if (navigator.onLine) {
    try {
      const sessions = await Supabase.getSessions();
      const remoteIds = new Set(sessions.map(s => s.id));
      // Remove sessions deleted on another device (bulkPut only adds/updates, never removes)
      const cached = await DB.getAll('sessions');
      for (const s of cached) {
        if (s.user_id === state.user?.id && !remoteIds.has(s.id)) {
          await DB.del('sessions', s.id);
          const logs = await DB.getAll('set_logs', 'session_id', s.id);
          for (const l of logs) await DB.del('set_logs', l.id);
        }
      }
      await DB.bulkPut('sessions', sessions);
    } catch (_) {}
  }

  const all = await DB.getAll('sessions');

  // Remove orphaned sessions created before auth (user_id='default')
  if (state.user?.id) {
    const stale = all.filter(s => s.user_id !== state.user.id);
    for (const s of stale) {
      await DB.del('sessions', s.id);
      const logs = await DB.getAll('set_logs', 'session_id', s.id);
      for (const l of logs) await DB.del('set_logs', l.id);
    }
    state.sessions = all
      .filter(s => s.user_id === state.user.id)
      .sort((a, b) => b.date.localeCompare(a.date));
  } else {
    state.sessions = all.sort((a, b) => b.date.localeCompare(a.date));
  }
}

async function loadLastLogs(day) {
  const sessionsByDay = state.sessions
    .filter(s => s.day === day)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (!sessionsByDay.length) return;
  const lastSession = sessionsByDay[0];
  if (state.activeSession && lastSession.id === state.activeSession.id) {
    if (sessionsByDay.length < 2) return;
    // Use the one before current
  }

  let logs;
  try {
    logs = await Supabase.getSetLogs(lastSession.id);
  } catch (_) {
    logs = await DB.getAll('set_logs', 'session_id', lastSession.id);
  }

  state.lastLogs = {};
  for (const log of logs) {
    if (!state.lastLogs[log.exercise_id]) state.lastLogs[log.exercise_id] = [];
    state.lastLogs[log.exercise_id].push(log);
  }
}

async function loadProgressData() {
  let allLogs = await DB.getAll('set_logs');

  // On a new device/browser, local IndexedDB has sessions but not their set_logs
  // (logs were only recorded on another device). Fetch any missing ones in one batch.
  if (navigator.onLine && state.sessions.length > 0) {
    const localSessionIds = new Set(allLogs.map(l => l.session_id));
    const missingIds = state.sessions.map(s => s.id).filter(id => !localSessionIds.has(id));
    if (missingIds.length > 0) {
      try {
        const fetched = await Supabase.getAllSetLogs(missingIds);
        if (fetched.length > 0) {
          await DB.bulkPut('set_logs', fetched);
          allLogs = allLogs.concat(fetched);
        }
      } catch (_) {}
    }
  }

  const completed = allLogs.filter(l => l.completed && l.weight_lbs != null);
  const sessionDateMap = {};
  for (const s of state.sessions) sessionDateMap[s.id] = s.date;

  const byEx = {};
  for (const log of completed) {
    const date = sessionDateMap[log.session_id];
    if (!date) continue;
    if (!byEx[log.exercise_id]) byEx[log.exercise_id] = {};
    if (!byEx[log.exercise_id][log.session_id]) {
      byEx[log.exercise_id][log.session_id] = { date, sets: [] };
    }
    byEx[log.exercise_id][log.session_id].sets.push(log);
  }

  state.prCache = {};
  state.lastCache = {};
  state.historyCache = {};

  for (const [exId, sessMap] of Object.entries(byEx)) {
    const history = Object.entries(sessMap)
      .map(([sid, { date, sets }]) => {
        const best = sets.reduce((b, s) =>
          (!b || s.weight_lbs > b.weight_lbs) ? s : b, null);
        return { sessionId: sid, date, sets: sets.sort((a, b) => a.set_number - b.set_number), bestSet: best };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    state.historyCache[exId] = history;
    if (history.length > 0) state.lastCache[exId] = history[0];
    let pr = null;
    for (const sess of history) {
      if (!pr || sess.bestSet.weight_lbs > pr.weight_lbs) {
        pr = { weight_lbs: sess.bestSet.weight_lbs, reps: sess.bestSet.reps, date: sess.date };
      }
    }
    if (pr) state.prCache[exId] = pr;
  }
  state.progressLoaded = true;
}

function checkPR(exerciseId, weight, reps) {
  if (!weight || !state.prCache) return;
  const w = parseFloat(weight);
  if (!w) return;
  const pr = state.prCache[exerciseId];
  if (!pr || w > pr.weight_lbs) {
    state.prCache[exerciseId] = { weight_lbs: w, reps: parseInt(reps) || 0, date: today() };
    const ex = state.sessionExercises.find(e => e.id === exerciseId)
            || state.exercises.find(e => e.id === exerciseId);
    const name = ex?.name || 'Exercise';
    state.sessionPRCount = (state.sessionPRCount || 0) + 1;
    state.progressLoaded = false;
    toast(`New PR — ${name} 🏆`, 'success');
  }
}

// ── Init set logs for a session ──────────────────────────────────
function initSetLogs(exercises) {
  state.setLogs = {};
  for (const ex of exercises) {
    if (!ex.sets_target) { state.setLogs[ex.id] = []; continue; }
    const last = state.lastLogs[ex.id] || [];
    const rows = [];
    for (let i = 0; i < ex.sets_target; i++) {
      const prev = last.find(l => l.set_number === i + 1);
      rows.push({
        setNumber: i + 1,
        weight_lbs: prev ? prev.weight_lbs : null,
        reps: prev ? prev.reps : null,
        completed: false,
        is_pr: false,
        _logId: null,
      });
    }
    state.setLogs[ex.id] = rows;
  }
}

// ── Navigation ───────────────────────────────────────────────────
function setTab(tab) {
  if (tab === 'workout' && !state.activeSession) tab = 'home';
  state.tab = tab;
  state.view = tab;
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  renderView();
  // Background-refresh sessions when switching to History
  if (tab === 'history' && navigator.onLine) {
    loadSessions().then(() => { if (state.view === 'history') renderView(); });
  }
}

function navigateTo(view, data = {}) {
  state.view = view;
  if (data.exercise) state.detailExercise = data.exercise;
  if (data.day) state.activeDay = data.day;
  if (data.exId !== undefined) state.progressExercise = data.exId;
  if (data.supersetId !== undefined) state.detailSupersetId = data.supersetId;
  renderView();
}

// ── Session management ───────────────────────────────────────────
function makeWarmup(day, sessionId) {
  return { id: `warmup-${sessionId}`, name: 'Warmup', day, section: 'Warmup', sets_target: 0, reps_target: '', weight_range: '', equipment: '', instructions: [], image_key: null, superset_group: null, sort_order: -1, _custom: true };
}
function makeAbs(day, sessionId) {
  return { id: `abs-${sessionId}`, name: 'Abs', day, section: 'Abs', sets_target: 0, reps_target: '', weight_range: '', equipment: '', instructions: [], image_key: null, superset_group: null, sort_order: 9999, _custom: true };
}
function makeCustomExercise(day, sessionId, idx) {
  return { id: `custom-${sessionId}-${idx}`, name: 'New Exercise', day, section: 'Custom', sets_target: 3, reps_target: '10', weight_range: '', equipment: '', instructions: [], image_key: null, superset_group: null, sort_order: 9000 + idx, _custom: true };
}

async function startSession(day) {
  const base = state.exercises.filter(e => e.day === day).sort((a,b) => a.sort_order - b.sort_order);
  await loadLastLogs(day);
  state.skipped = new Set();
  state.exerciseNotes = {};

  const session = {
    id: uuid(),
    user_id: state.user?.id || 'default',
    day,
    date: today(),
    notes: null,
    created_at: new Date().toISOString(),
    synced_at: new Date().toISOString(),
  };
  state.activeSession = session;
  state.activeDay = day;

  state.sessionExercises = [
    makeWarmup(day, session.id),
    ...base,
    makeAbs(day, session.id),
  ];
  state.defaultExerciseIds = state.sessionExercises.map(e => e.id);
  initSetLogs(state.sessionExercises);

  await DB.put('sessions', session);
  await DB.queueSync('sessions', 'insert', session);
  syncIfOnline();

  state.view = 'workout';
  renderView();
}

async function finishSession() {
  const exercises = currentDayExercises();
  const counted = exercises.filter(ex => !state.skipped.has(ex.id) && !isExerciseEmpty(ex.id));
  const completedSets = counted.flatMap(ex =>
    (state.setLogs[ex.id] || []).filter(s => s.completed)
  ).length;
  const totalSets = counted.flatMap(ex => state.setLogs[ex.id] || []).length;

  state.view = 'summary';
  state.summaryData = { completedSets, totalSets, exercises };
  renderView();
}

async function endAndGoHome() {
  // Auto-discard sessions where nothing was logged
  if (state.activeSession) {
    const hasLogs = state.sessionExercises.some(ex =>
      (state.setLogs[ex.id] || []).some(s => s.completed)
    );
    if (!hasLogs) {
      const logs = await DB.getAll('set_logs', 'session_id', state.activeSession.id);
      for (const log of logs) await DB.del('set_logs', log.id);
      await DB.del('sessions', state.activeSession.id);
      try { await Supabase.deleteRecord('sessions', state.activeSession.id); } catch (_) {}
    }
  }
  state.activeSession = null;
  state.setLogs = {};
  state.skipped = new Set();
  state.activeDay = null;
  state.sessionExercises = [];
  state.defaultExerciseIds = [];
  state.exerciseNotes = {};
  state.progressLoaded = false;
  state.sessionPRCount = 0;
  stopRestTimer();
  await loadSessions();
  setTab('home');
}

async function cancelSession() {
  if (!confirm('Cancel this workout? All logged progress will be lost.')) return;
  if (state.activeSession) {
    const logs = await DB.getAll('set_logs', 'session_id', state.activeSession.id);
    for (const log of logs) await DB.del('set_logs', log.id);
    await DB.del('sessions', state.activeSession.id);
    try { await Supabase.deleteRecord('sessions', state.activeSession.id); } catch (_) {}
  }
  state.activeSession = null;
  state.setLogs = {};
  state.skipped = new Set();
  state.activeDay = null;
  state.sessionExercises = [];
  state.defaultExerciseIds = [];
  state.exerciseNotes = {};
  state.progressLoaded = false;
  state.sessionPRCount = 0;
  stopRestTimer();
  await loadSessions();
  setTab('home');
}

// ── Set logging ──────────────────────────────────────────────────
async function updateSet(exerciseId, setIndex, field, value) {
  if (!state.setLogs[exerciseId]) return;
  state.setLogs[exerciseId][setIndex][field] = value;
}

async function toggleComplete(exerciseId, setIndex) {
  const set = state.setLogs[exerciseId]?.[setIndex];
  if (!set) return;

  if (set.completed) {
    // Un-completing: remove the previously created set_log so it doesn't duplicate
    set.completed = false;
    if (set._logId) {
      await DB.del('set_logs', set._logId);
      const pending = await DB.getAll('pending_sync');
      for (const p of pending) {
        if (p.payload?.id === set._logId) await DB.del('pending_sync', p.id);
      }
      try { await Supabase.deleteRecord('set_logs', set._logId); } catch (_) {}
      set._logId = null;
    }
  } else {
    // Completing: create a fresh log entry
    set.completed = true;

    const log = {
      id: uuid(),
      session_id: state.activeSession.id,
      exercise_id: exerciseId,
      set_number: set.setNumber,
      weight_lbs: set.weight_lbs ? parseFloat(set.weight_lbs) : null,
      reps: set.reps ? parseInt(set.reps) : null,
      completed: true,
      is_pr: false,
      notes: null,
      logged_at: new Date().toISOString(),
      synced_at: new Date().toISOString(),
    };
    set._logId = log.id;
    await DB.put('set_logs', log);
    await DB.queueSync('set_logs', 'insert', log);
    syncIfOnline();
    if (log.weight_lbs) checkPR(exerciseId, log.weight_lbs, log.reps);
  }

  updateSyncDot();
  const row = document.querySelector(`.set-row[data-ex-id="${exerciseId}"][data-set-idx="${setIndex}"]`);
  if (row) renderSetRow(exerciseId, setIndex, row);
}

function skipExercise(exerciseId) {
  if (state.skipped.has(exerciseId)) {
    state.skipped.delete(exerciseId);
  } else {
    state.skipped.add(exerciseId);
  }
  renderView();
}

// ── Rest timer ───────────────────────────────────────────────────
function startRestTimer(duration) {
  stopRestTimer();
  state.restTimer = { active: true, remaining: duration, duration, exerciseName: '' };
  renderRestTimer();
  timerInterval = setInterval(() => {
    state.restTimer.remaining -= 1;
    if (state.restTimer.remaining <= 0) {
      stopRestTimer();
      notifyTimerDone();
    } else {
      renderRestTimer();
    }
  }, 1000);
}

function stopRestTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  state.restTimer.active = false;
  renderRestTimer();
}

function notifyTimerDone() {
  toast('Rest time done — next set!', 'success');
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Rest done!', { body: 'Time for your next set.' });
  }
}

function setTimerDuration(sec) {
  state.restTimer.duration = sec;
  if (state.restTimer.active) startRestTimer(sec);
  document.querySelectorAll('.timer-opt').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.sec) === sec);
  });
}

// ── Sync ─────────────────────────────────────────────────────────
async function remapLocalExerciseIds() {
  // When phone was offline, exercises got 'local-0', 'local-1' IDs instead of
  // real Supabase UUIDs. Those set_logs can't insert (UUID column + FK constraint).
  // Remap them to real UUIDs by matching exercise name + day before flushing.
  const pending = await DB.getAll('pending_sync');
  const stuck = pending.filter(
    p => p.table === 'set_logs' &&
    typeof p.payload?.exercise_id === 'string' &&
    p.payload.exercise_id.startsWith('local-')
  );
  if (!stuck.length) return;
  let remoteExs;
  try { remoteExs = await Supabase.getExercises(); } catch (_) { return; }
  for (const item of stuck) {
    const localIdx = parseInt(item.payload.exercise_id.replace('local-', ''));
    const localEx = EXERCISES[localIdx];
    if (!localEx) continue;
    const match = remoteExs.find(e => e.name === localEx.name && e.day === localEx.day);
    if (!match) continue;
    const fixed = { ...item, payload: { ...item.payload, exercise_id: match.id } };
    await DB.put('pending_sync', fixed);
    const log = await DB.get('set_logs', item.payload.id);
    if (log) await DB.put('set_logs', { ...log, exercise_id: match.id });
  }
}

async function requeueOrphanedSetLogs() {
  // Re-queue completed set_logs that are in local IndexedDB but have no pending_sync entry.
  // This recovers from cases where pending_sync was cleared, or entries were lost.
  // With merge-duplicates inserts, re-queuing is safe even if the log is already in Supabase.
  const allLogs = await DB.getAll('set_logs');
  const completedLogs = allLogs.filter(l => l.completed);
  if (!completedLogs.length) return;
  const pending = await DB.getAll('pending_sync');
  const queuedIds = new Set(
    pending.filter(p => p.table === 'set_logs').map(p => p.payload?.id)
  );
  for (const log of completedLogs) {
    if (!queuedIds.has(log.id)) {
      await DB.queueSync('set_logs', 'insert', log);
    }
  }
}

async function syncIfOnline() {
  if (!navigator.onLine) return;
  try {
    await requeueOrphanedSetLogs();
    await remapLocalExerciseIds();
    await DB.flushSync();
  } catch (_) {}
  updateSyncDot();
}

// ── Render helpers ───────────────────────────────────────────────
function currentDayExercises() {
  if (state.sessionExercises.length > 0) return state.sessionExercises;
  return state.exercises
    .filter(e => e.day === state.activeDay)
    .sort((a,b) => a.sort_order - b.sort_order);
}

function addCustomExercise() {
  const idx = state.sessionExercises.filter(e => e._custom && e.name !== 'Warmup' && e.name !== 'Abs').length;
  const ex = makeCustomExercise(state.activeDay, state.activeSession.id, idx);
  // Insert before Abs
  const absIdx = state.sessionExercises.findIndex(e => e.name === 'Abs');
  if (absIdx >= 0) state.sessionExercises.splice(absIdx, 0, ex);
  else state.sessionExercises.push(ex);
  state.setLogs[ex.id] = Array.from({length: ex.sets_target}, (_, i) => ({ setNumber: i+1, weight_lbs: null, reps: null, completed: false, _logId: null }));
  renderView();
}

function toggleSuperset(exerciseId) {
  const ex = state.sessionExercises.find(e => e.id === exerciseId);
  if (!ex) return;
  if (ex.superset_group) {
    ex.superset_group = null;
  } else {
    // Group with adjacent exercise
    const idx = state.sessionExercises.indexOf(ex);
    const neighbor = state.sessionExercises[idx - 1] || state.sessionExercises[idx + 1];
    const group = neighbor?.superset_group || `superset-custom-${Date.now()}`;
    ex.superset_group = group;
    if (neighbor && !neighbor.superset_group) neighbor.superset_group = group;
  }
  renderView();
  // Navigate back to detail so user sees the change
  navigateTo('exercise-detail', { exercise: state.sessionExercises.find(e => e.id === exerciseId) });
}

function nextGroupName() {
  const existing = new Set(state.sessionExercises.map(e => e.section));
  let n = 1;
  while (existing.has(`Group ${n}`)) n++;
  return `Group ${n}`;
}

function showSupersetMenu(supersetId, btn) {
  document.querySelectorAll('.ss-dropdown').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'ss-dropdown';
  menu.innerHTML = `
    <button class="ss-dropdown-item" data-rename-ss="${supersetId}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Rename
    </button>
    <button class="ss-dropdown-item danger" data-ungroup-ss="${supersetId}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6l-12 12M6 6l12 12"/></svg>
      Ungroup all exercises
    </button>`;
  btn.closest('.superset-card-header').appendChild(menu);
  menu.querySelector('[data-rename-ss]').addEventListener('click', e => {
    e.stopPropagation();
    startRenameSuperset(supersetId);
  });
  menu.querySelector('[data-ungroup-ss]').addEventListener('click', e => {
    e.stopPropagation();
    ungroupSuperset(supersetId);
  });
  const close = e => {
    if (!menu.contains(e.target) && e.target !== btn) {
      menu.remove();
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

function startRenameSuperset(supersetId) {
  document.querySelectorAll('.ss-dropdown').forEach(el => el.remove());
  const card = document.querySelector(`.superset-card[data-superset-id="${CSS.escape(supersetId)}"]`);
  if (!card) return;
  const labelEl = card.querySelector('.superset-card-label');
  if (!labelEl) return;
  const currentName = labelEl.textContent.trim();
  const wrap = document.createElement('div');
  wrap.className = 'ss-rename-wrap';
  wrap.innerHTML = `<input class="ss-rename-input" value="${currentName}" /><button class="ss-rename-confirm">✓</button>`;
  labelEl.replaceWith(wrap);
  const input = wrap.querySelector('.ss-rename-input');
  input.focus();
  input.select();
  let saved = false;
  const save = () => {
    if (saved) return;
    saved = true;
    renameSuperset(supersetId, input.value.trim() || currentName);
  };
  input.addEventListener('blur', save);
  wrap.querySelector('.ss-rename-confirm').addEventListener('click', save);
}

function renameSuperset(supersetId, newName) {
  state.sessionExercises.forEach(ex => {
    if (ex.superset_group === supersetId) ex.section = newName;
  });
  renderView();
}

function ungroupSuperset(supersetId) {
  document.querySelectorAll('.ss-dropdown').forEach(el => el.remove());
  state.sessionExercises.forEach(ex => {
    if (ex.superset_group === supersetId) ex.superset_group = null;
  });
  renderView();
}

function showGroupPicker(exId) {
  const ex = state.sessionExercises.find(e => e.id === exId);
  if (!ex) return;
  const groups = new Map();
  state.sessionExercises.forEach(e => {
    if (e.superset_group) {
      if (!groups.has(e.superset_group)) groups.set(e.superset_group, { label: e.section, names: [] });
      groups.get(e.superset_group).names.push(e.name);
    }
  });
  const existingOpts = [...groups.entries()].map(([id, { label, names }]) => `
    <button class="group-sheet-option" data-add-to="${id}">
      <div>
        <span class="group-sheet-label">${label}</span>
        <span class="group-sheet-meta">${names.join(', ')}</span>
      </div>
    </button>`).join('');
  const sheet = document.createElement('div');
  sheet.id = 'group-picker-sheet';
  sheet.innerHTML = `
    <div class="group-picker-backdrop"></div>
    <div class="group-picker-panel">
      <div class="group-picker-handle"></div>
      <div class="group-picker-title">Group with another exercise</div>
      <button class="group-sheet-option group-sheet-create" id="gp-create">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--pink)" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <div>
          <span class="group-sheet-label">Create new group</span>
          <span class="group-sheet-meta">Pairs with the next exercise in the list</span>
        </div>
      </button>
      ${existingOpts ? `<div class="group-picker-section-label">Add to existing group</div>${existingOpts}` : ''}
      <button class="group-picker-cancel">Cancel</button>
    </div>`;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.querySelector('.group-picker-panel').classList.add('open'));
  sheet.querySelector('.group-picker-backdrop').addEventListener('click', closeGroupPicker);
  sheet.querySelector('.group-picker-cancel').addEventListener('click', closeGroupPicker);
  sheet.querySelector('#gp-create').addEventListener('click', () => { closeGroupPicker(); createNewGroup(exId); });
  sheet.querySelectorAll('[data-add-to]').forEach(btn => {
    btn.addEventListener('click', () => { closeGroupPicker(); addExerciseToGroup(exId, btn.dataset.addTo); });
  });
}

function closeGroupPicker() {
  const sheet = document.getElementById('group-picker-sheet');
  if (!sheet) return;
  sheet.querySelector('.group-picker-panel').classList.remove('open');
  setTimeout(() => sheet.remove(), 260);
}

function createNewGroup(exId) {
  const ex = state.sessionExercises.find(e => e.id === exId);
  if (!ex) return;
  const idx = state.sessionExercises.indexOf(ex);
  const next = state.sessionExercises[idx + 1];
  if (!next) { toast('No next exercise to pair with'); return; }
  const groupId = `superset-custom-${Date.now()}`;
  const groupName = nextGroupName();
  ex.superset_group = groupId;
  ex.section = groupName;
  next.superset_group = groupId;
  next.section = groupName;
  renderView();
}

function addExerciseToGroup(exId, supersetId) {
  const ex = state.sessionExercises.find(e => e.id === exId);
  const ref = state.sessionExercises.find(e => e.superset_group === supersetId);
  if (!ex || !ref) return;
  ex.superset_group = supersetId;
  ex.section = ref.section;
  renderView();
}

function saveExerciseNote(exerciseId, note) {
  state.exerciseNotes[exerciseId] = note;
}

function isExerciseEmpty(exId) {
  const logs = state.setLogs[exId] || [];
  return logs.length > 0 && !logs.some(s => s.completed || s.weight_lbs || s.reps);
}

function exerciseProgress(exercises) {
  let done = 0, total = 0;
  for (const ex of exercises) {
    if (state.skipped.has(ex.id) || isExerciseEmpty(ex.id)) continue;
    const logs = state.setLogs[ex.id] || [];
    done += logs.filter(s => s.completed).length;
    total += logs.length;
  }
  return { done, total, pct: total ? Math.round((done/total)*100) : 0 };
}

// ── Seeding overlay ──────────────────────────────────────────────
function renderSeedingOverlay() {
  const el = document.getElementById('main-view');
  if (el) el.innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <div>Setting up your workout data…</div>
    </div>`;
}

// ── Main render ──────────────────────────────────────────────────
function renderView() {
  const el = document.getElementById('main-view');
  if (!el) return;
  switch (state.view) {
    case 'home':              el.innerHTML = renderHome(); break;
    case 'workout':           el.innerHTML = renderWorkout(); break;
    case 'exercise-detail':   el.innerHTML = renderExerciseDetail(); break;
    case 'summary':           el.innerHTML = renderSummary(); break;
    case 'history':           el.innerHTML = renderHistory(); break;
    case 'session-detail':    el.innerHTML = renderSessionDetail(); break;
    case 'progress':          el.innerHTML = renderProgress(); break;
    case 'progress-exercise': el.innerHTML = renderProgressExercise(); break;
    case 'superset-detail':   el.innerHTML = renderSupersetDetail(); break;
    default:                  el.innerHTML = renderHome();
  }
  el.scrollTop = 0;
  bindViewEvents();
}

// ── Home view ────────────────────────────────────────────────────
function renderHome() {
  const days = [
    { day: 'Day 1', name: 'Push', muscles: 'Chest · Shoulders · Triceps', color: '#E91E8C' },
    { day: 'Day 2', name: 'Pull', muscles: 'Back · Biceps · Rear Delts', color: '#9C27B0' },
    { day: 'Day 3', name: 'Legs', muscles: 'Glutes · Hamstrings · Quads', color: '#3F51B5' },
  ];
  const dayNameMap = Object.fromEntries(days.map(d => [d.day, d.name]));

  const last = state.sessions[0];
  const lastWidget = last ? `
    <div class="last-workout-widget">
      <div class="last-workout-dot">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M12 2v10l4 2"/>
          <circle cx="12" cy="12" r="10"/>
        </svg>
      </div>
      <div class="last-workout-text">
        <div style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">Last workout</div>
        <strong>${last.day}${dayNameMap[last.day] ? ' — ' + dayNameMap[last.day] : ''}</strong>
        <span>${daysAgo(last.date)} · ${fmtDate(last.date)}</span>
      </div>
    </div>` : '';

  const inProgress = state.activeSession ? `
    <div class="card mb16" style="border-color: var(--pink);">
      <div style="font-size:12px;color:var(--pink);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Workout in progress</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:12px;">${state.activeSession.day} — ${dayNameMap[state.activeSession.day] || ''}</div>
      <button class="btn btn-primary" onclick="navigateTo('workout')">Resume</button>
    </div>` : '';

  const cards = days.map(({ day, name, muscles }) => {
    const count = state.exercises.filter(e => e.day === day).length;
    return `<div class="day-card" data-day="${day}">
      <div class="day-card-label">${day}</div>
      <div class="day-card-name">${name}</div>
      <div class="day-card-meta">${muscles} · ${count} exercises</div>
      <button class="day-card-start" data-day-start="${day}">${state.activeSession?.day === day ? 'Resume Workout' : 'Start Workout'}</button>
    </div>`;
  }).join('');

  const userEmail = state.user?.email || '';
  return `
    <div class="page-header">
      <div style="flex:1">
        <div class="page-title">Workout Tracker</div>
        <div class="page-subtitle">Push · Pull · Legs</div>
      </div>
      <button class="logout-btn" onclick="handleLogout()" title="Sign out">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
      </button>
    </div>
    ${inProgress}
    ${lastWidget}
    <div class="day-cards">${cards}</div>`;
}

// ── Workout view ─────────────────────────────────────────────────
function renderWorkout() {
  if (!state.activeSession) { return ''; }
  const exercises = currentDayExercises();
  const prog = exerciseProgress(exercises);
  const dayNames = { 'Day 1':'Push', 'Day 2':'Pull', 'Day 3':'Legs' };
  const groups = buildSectionGroups(exercises);

  let html = `
    <div class="page-header">
      <button class="back-btn" aria-label="Back" onclick="endAndGoHome()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div style="flex:1">
        <div class="page-title">${state.activeDay} — ${dayNames[state.activeDay]}</div>
        <div class="page-subtitle">${fmtDate(state.activeSession?.date || today())}</div>
      </div>
      <button class="reset-order-btn" onclick="resetExerciseOrder()">Reset order</button>
    </div>
    <div class="workout-progress">
      <div class="workout-progress-bar-wrap">
        <div class="workout-progress-bar" style="width:${prog.pct}%"></div>
      </div>
      <div class="workout-progress-label">${prog.done} / ${prog.total} sets completed</div>
    </div>
    <div id="section-sortable">`;

  for (const { section, exercises: groupExs } of groups) {
    const displaySection = section === 'Warmup + core' ? 'Compound Lifts' : section;
    const supersetId = groupExs[0]?.superset_group && !groupExs[0]._custom ? groupExs[0].superset_group : null;
    const isSuperset = supersetId && groupExs.every(ex => ex.superset_group === supersetId);

    if (isSuperset) {
      // ── Superset card ─────────────────────────────────────────────
      const totalDone = groupExs.reduce((s, ex) => s + (state.setLogs[ex.id] || []).filter(l => l.completed).length, 0);
      const totalSets = groupExs.reduce((s, ex) => s + (state.setLogs[ex.id] || []).length, 0);
      const cardDone = totalDone === totalSets && totalSets > 0;
      html += `<div class="section-group" data-section="${section}">
        <div class="superset-card ${cardDone ? 'done' : ''}" data-superset-id="${supersetId}">
          <div class="superset-card-header section-draggable">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="section-drag-handle">⠿</span>
              <span class="superset-card-label">${displaySection}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <span class="superset-card-progress">${totalDone}/${totalSets} sets</span>
              <button class="ss-menu-btn" data-ss-menu="${supersetId}">⋮</button>
            </div>
          </div>
          <div class="exercise-sortable-inner">`;

      for (const ex of groupExs) {
        const logs = state.setLogs[ex.id] || [];
        const completed = logs.filter(s => s.completed).length;
        const allDone = ex.sets_target > 0 && completed === logs.length && logs.length > 0;
        const isSkipped = state.skipped.has(ex.id);
        const thumb = IMAGE_KEYS.has(ex.image_key)
          ? `<img class="superset-card-thumb-img" src="icons/exercises/${ex.image_key}.jpg" alt="" loading="lazy" />`
          : (ILLUSTRATIONS[ex.image_key] || ILLUSTRATIONS['_placeholder']).replace(/viewBox="[^"]*"/, 'viewBox="0 0 120 160"');
        const statusEl = allDone
          ? `<svg class="check-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>`
          : isSkipped
            ? `<svg class="skip-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6l-12 12M6 6l12 12"/></svg>`
            : `<span style="font-size:12px;color:var(--text3)">${completed}/${logs.length}</span>`;
        html += `<div class="exercise-row superset-card-ex" data-ex-id="${ex.id}">
          <div class="drag-handle">⠿</div>
          <div class="superset-card-thumb">${thumb}</div>
          <div class="superset-card-ex-info">
            <div class="superset-card-ex-name">${ex.name}</div>
            <div class="superset-card-ex-meta">${ex.sets_target}×${ex.reps_target}</div>
          </div>
          <div class="superset-card-ex-status">${statusEl}</div>
        </div>`;
      }

      html += `</div></div></div>`;
    } else {
      // ── Normal section ────────────────────────────────────────────
      html += `<div class="section-group" data-section="${section}">
        <div class="section-label section-draggable">
          <span class="section-drag-handle">⠿</span>
          ${displaySection}
        </div>
        <div class="exercise-sortable-inner">`;

      for (const ex of groupExs) {
        const logs = state.setLogs[ex.id] || [];
        const completed = logs.filter(s => s.completed).length;
        const allDone = ex.sets_target > 0 && completed === logs.length && logs.length > 0;
        const isSkipped = state.skipped.has(ex.id);
        const isNoteOnly = ex.sets_target === 0;
        const note = state.exerciseNotes[ex.id] || '';

        let thumb = '';
        if (!isNoteOnly) {
          thumb = IMAGE_KEYS.has(ex.image_key)
            ? `<img class="exercise-thumb-img" src="icons/exercises/${ex.image_key}.jpg" alt="" loading="lazy" />`
            : (ILLUSTRATIONS[ex.image_key] || ILLUSTRATIONS['_placeholder']).replace(/viewBox="[^"]*"/, 'viewBox="0 0 120 160"');
        } else {
          thumb = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
        }

        const statusEl = isNoteOnly
          ? (note ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>' : '')
          : (allDone ? '<svg class="check-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>'
              : isSkipped ? '<svg class="skip-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6l-12 12M6 6l12 12"/></svg>'
              : `<span style="font-size:13px;color:var(--text3)">${completed}/${logs.length}</span>`);

        const meta = isNoteOnly
          ? (note ? `<div class="exercise-row-meta" style="color:var(--text3);font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px">${note}</div>` : '<div class="exercise-row-meta">Tap to add notes</div>')
          : `<div class="exercise-row-meta">${ex.sets_target}×${ex.reps_target}${ex.weight_range ? ' · ' + startingWeight(ex.weight_range) : ''}</div>`;

        const lastSets = (state.lastLogs[ex.id] || []).filter(s => s.completed);
        let lastHint = '';
        if (!isNoteOnly && lastSets.length > 0) {
          const weight = lastSets.find(s => s.weight_lbs)?.weight_lbs;
          const reps = lastSets.find(s => s.reps)?.reps;
          const parts = [`${lastSets.length} sets`];
          if (reps) parts.push(`${reps} reps`);
          if (weight) parts.push(`${weight} lbs`);
          lastHint = `<div class="exercise-row-last">Last: ${parts.join(' · ')}</div>`;
        }

        const groupBtn = !isNoteOnly && state.activeSession
          ? `<button class="ex-group-btn" data-group-ex="${ex.id}" aria-label="Group"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg></button>`
          : '';
        html += `<div class="exercise-row ${allDone?'done':''} ${isSkipped?'skipped':''} ${isNoteOnly?'note-only':''}" data-ex-id="${ex.id}">
          <div class="drag-handle">⠿</div>
          <div class="exercise-row-thumb">${thumb}</div>
          <div class="exercise-row-info">
            <div class="exercise-row-name">${ex.name}</div>
            ${meta}
            ${lastHint}
          </div>
          <div class="exercise-row-end">
            <div class="exercise-row-status">${statusEl}</div>
            ${groupBtn}
          </div>
        </div>`;
      }

      html += `</div></div>`;
    }
  }

  html += `</div>
    <button class="add-exercise-btn" onclick="addCustomExercise()">+ Add exercise</button>
    <div style="margin-top:16px;">
      <button class="btn btn-primary" onclick="finishSession()">Finish Workout</button>
      <div class="btn-row mt8">
        <button class="btn btn-ghost" onclick="endAndGoHome()">Save &amp; Exit</button>
        <button class="btn btn-danger" onclick="cancelSession()">Cancel</button>
      </div>
    </div>`;

  return html;
}

// ── Exercise detail / logging view ───────────────────────────────
function renderExerciseDetail() {
  const ex = state.detailExercise;
  if (!ex) return '';
  const logs = state.setLogs[ex.id] || [];
  const isSkipped = state.skipped.has(ex.id);
  const inActiveSession = !!state.activeSession;
  const isNoteOnly = ex.sets_target === 0;
  const note = state.exerciseNotes[ex.id] || '';
  const inSuperset = !!ex.superset_group;

  const instructions = (ex.instructions || []).map(i => `<li>${i}</li>`).join('');

  // Equipment chips
  const equipChips = ex.equipment
    ? ex.equipment.split(',').map(e => `<span class="tag">${e.trim()}</span>`).join('')
    : '';

  // Editable name for custom exercises
  const nameEl = ex._custom
    ? `<input class="detail-name-input" value="${ex.name}" data-ex-id="${ex.id}" placeholder="Exercise name" />`
    : `<div class="page-title" style="font-size:18px">${ex.name}</div>`;

  let mediaEl = '';
  if (!isNoteOnly && ex.image_key) mediaEl = getExerciseMedia(ex.image_key);

  let infoCard = '';
  if (!isNoteOnly && (instructions || equipChips || ex.weight_range)) {
    infoCard = `<div class="card">
      ${(equipChips || ex.weight_range) ? `<div class="detail-section-label">Equipment</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">${equipChips}${ex.weight_range ? `<span class="tag tag-muted">~${startingWeight(ex.weight_range)}</span>` : ''}</div>` : ''}
      ${instructions ? `<div class="detail-section-label">Instructions</div><ol class="instructions-list">${instructions}</ol>` : ''}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
        <span class="tag">${ex.sets_target} sets</span>
        ${ex.reps_target ? `<span class="tag">${ex.reps_target} reps</span>` : ''}
      </div>
    </div>`;
  }

  // Last session card (shown during active workout when history exists)
  let lastSessionCard = '';
  if (inActiveSession && !isNoteOnly) {
    const lastSets = (state.lastLogs[ex.id] || []).filter(s => s.completed).sort((a, b) => a.set_number - b.set_number);
    if (lastSets.length > 0) {
      const prData = state.prCache?.[ex.id];
      const lastDate = state.lastCache?.[ex.id]?.date;
      const setRows = lastSets.map(s =>
        `<div class="last-set-row">
          <div class="last-set-num">Set ${s.set_number}</div>
          <div class="last-set-val">${s.weight_lbs != null ? s.weight_lbs + ' lbs' : '—'} &nbsp;×&nbsp; ${s.reps != null ? s.reps + ' reps' : '—'}</div>
        </div>`
      ).join('');
      const prRow = prData ? `
        <div class="last-pr-row">
          <div class="last-pr-left">
            <span class="last-pr-label">🏆 PR</span>
            <div>
              <div class="last-pr-val">${prData.weight_lbs} lbs × ${prData.reps}</div>
              <div class="last-pr-sub">${fmtDate(prData.date)}</div>
            </div>
          </div>
          <button class="last-see-history" data-prog-ex="${ex.id}">See history ›</button>
        </div>` : '';
      lastSessionCard = `
        <div class="last-session-card">
          <div class="last-session-header">
            <div class="last-session-title">Last session</div>
            ${lastDate ? `<div class="last-session-date">${fmtDate(lastDate)}</div>` : ''}
          </div>
          <div class="last-session-sets">${setRows}</div>
          ${prRow}
        </div>`;
    }
  }

  // Notes textarea (always shown)
  const notesCard = `<div class="card">
    <div class="detail-section-label">Notes</div>
    <textarea class="notes-textarea" data-ex-id="${ex.id}" placeholder="Form cues, how it felt, adjustments…" rows="3">${note}</textarea>
  </div>`;

  let setRows = '';
  if (inActiveSession && !isSkipped && !isNoteOnly) {
    setRows = `
      <div class="sets-header">
        <div>Set</div>
        <div style="text-align:center">Weight <span style="font-size:10px;opacity:.6">(lbs)</span></div>
        <div style="text-align:center">Reps</div>
        <div></div>
      </div>
      ${logs.map((s, i) => `<div class="set-row" data-ex-id="${ex.id}" data-set-idx="${i}">${buildSetRow(ex.id, i, s)}</div>`).join('')}
      <div class="btn-row mt8">
        <button class="btn btn-secondary" onclick="startRestTimer(${state.restTimer.duration})">Start Rest Timer</button>
        <button class="btn btn-danger" onclick="skipExercise('${ex.id}')">${isSkipped ? 'Unskip' : 'Skip'}</button>
      </div>`;
  }

  return `
    <div class="page-header">
      <button class="back-btn" aria-label="Back" onclick="navigateTo('workout')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div style="flex:1">
        ${nameEl}
      </div>
    </div>
    ${mediaEl}
    ${infoCard}
    ${lastSessionCard}
    ${notesCard}
    ${setRows}`;
}

function buildSetRow(exerciseId, i, s) {
  const wVal = s.weight_lbs ?? '';
  const rVal = s.reps ?? '';
  const eid = exerciseId;
  return `
    <div class="set-num">${i + 1}</div>
    <div class="set-input-wrap ${s.completed?'completed':''}">
      <button class="adj-btn" data-ex-id="${eid}" data-set-idx="${i}" data-field="w" data-dir="minus">−</button>
      <input class="set-input" type="number" inputmode="decimal" placeholder="lbs" step="any" min="0"
        value="${wVal}" data-ex-id="${eid}" data-set-idx="${i}" data-field="w" />
      <button class="adj-btn" data-ex-id="${eid}" data-set-idx="${i}" data-field="w" data-dir="plus">+</button>
    </div>
    <div class="set-input-wrap ${s.completed?'completed':''}">
      <button class="adj-btn" data-ex-id="${eid}" data-set-idx="${i}" data-field="r" data-dir="minus">−</button>
      <input class="set-input" type="number" inputmode="numeric" placeholder="reps"
        value="${rVal}" data-ex-id="${eid}" data-set-idx="${i}" data-field="r" />
      <button class="adj-btn" data-ex-id="${eid}" data-set-idx="${i}" data-field="r" data-dir="plus">+</button>
    </div>
    <button class="complete-btn ${s.completed?'done':''}" data-ex-id="${eid}" data-set-idx="${i}">
      ${s.completed ?
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>' :
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>'}
    </button>`;
}

function renderSetRow(exerciseId, i, rowEl) {
  const s = state.setLogs[exerciseId]?.[i];
  if (!s || !rowEl) return;
  rowEl.innerHTML = buildSetRow(exerciseId, i, s);
  bindSetRowEvents(rowEl, exerciseId, i);
}

// ── Superset detail view ──────────────────────────────────────────
function renderSupersetDetail() {
  const supersetId = state.detailSupersetId;
  const exercises = state.sessionExercises.filter(e => e.superset_group === supersetId);
  if (!exercises.length) return '';

  // Derive display label from section name (e.g. "Superset A")
  const label = exercises[0].section || 'Superset';

  const exBlocks = exercises.map((ex, idx) => {
    const logs = state.setLogs[ex.id] || [];
    const isSkipped = state.skipped.has(ex.id);

    const thumb = IMAGE_KEYS.has(ex.image_key)
      ? `<img class="ss-ex-thumb-img" src="icons/exercises/${ex.image_key}.jpg" alt="" loading="lazy" />`
      : (ILLUSTRATIONS[ex.image_key] || ILLUSTRATIONS['_placeholder']).replace(/viewBox="[^"]*"/, 'viewBox="0 0 120 160"');

    // Compact last-session hint
    const lastSets = (state.lastLogs[ex.id] || []).filter(s => s.completed);
    let lastHint = '';
    if (lastSets.length > 0) {
      const w = lastSets.find(s => s.weight_lbs)?.weight_lbs;
      const r = lastSets.find(s => s.reps)?.reps;
      const parts = [];
      if (w) parts.push(`${w} lbs`);
      if (r) parts.push(`${r} reps`);
      lastHint = parts.length
        ? `<div class="ss-ex-last">Last: ${parts.join(' × ')}</div>`
        : '';
    }

    const setTable = !isSkipped ? `
      <div class="sets-header">
        <div>Set</div>
        <div style="text-align:center">Weight <span style="font-size:10px;opacity:.6">(lbs)</span></div>
        <div style="text-align:center">Reps</div>
        <div></div>
      </div>
      ${logs.map((s, i) => `<div class="set-row" data-ex-id="${ex.id}" data-set-idx="${i}">${buildSetRow(ex.id, i, s)}</div>`).join('')}` : `
      <div style="text-align:center;padding:12px 0;color:var(--text3);font-size:14px">Skipped</div>`;

    const skipBtn = `<button class="ss-skip-btn" onclick="skipExercise('${ex.id}')">${isSkipped ? 'Unskip' : 'Skip'}</button>`;

    const divider = idx < exercises.length - 1 ? `<div class="ss-divider"></div>` : '';

    return `
      <div class="ss-ex-block">
        <div class="ss-ex-header">
          <div class="ss-ex-thumb">${thumb}</div>
          <div class="ss-ex-info">
            <div class="ss-ex-name">${ex.name}</div>
            <div class="ss-ex-meta">${ex.sets_target}×${ex.reps_target}${ex.weight_range ? ' · ~' + startingWeight(ex.weight_range) : ''}</div>
            ${lastHint}
          </div>
          ${skipBtn}
        </div>
        <div class="ss-ex-sets">
          ${setTable}
        </div>
      </div>${divider}`;
  }).join('');

  return `
    <div class="page-header">
      <button class="back-btn" aria-label="Back" onclick="navigateTo('workout')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div class="page-title" style="font-size:18px">${label}</div>
    </div>
    <div class="card" style="padding:0;overflow:hidden">
      ${exBlocks}
    </div>
    <div class="btn-row mt8" style="padding:0 16px">
      <button class="btn btn-secondary" onclick="startRestTimer(${state.restTimer.duration})">Start Rest Timer</button>
    </div>`;
}

// ── Summary view ─────────────────────────────────────────────────
function renderSummary() {
  const { completedSets, totalSets, exercises } = state.summaryData || {};
  const prs = state.sessionPRCount || 0;
  const skippedCount = state.skipped.size;
  const pct = totalSets ? Math.round((completedSets/totalSets)*100) : 0;
  const dayNames = { 'Day 1':'Push', 'Day 2':'Pull', 'Day 3':'Legs' };

  return `
    <div class="page-header">
      <div class="page-title">Workout Complete 🎉</div>
    </div>
    <div class="summary-grid">
      <div class="summary-stat">
        <div class="summary-stat-value">${completedSets}</div>
        <div class="summary-stat-label">Sets completed</div>
      </div>
      <div class="summary-stat">
        <div class="summary-stat-value">${pct}%</div>
        <div class="summary-stat-label">Completion</div>
      </div>
      <div class="summary-stat">
        <div class="summary-stat-value" style="color:var(--gold)">${prs}</div>
        <div class="summary-stat-label">Personal records</div>
      </div>
      <div class="summary-stat">
        <div class="summary-stat-value" style="color:var(--text2)">${skippedCount}</div>
        <div class="summary-stat-label">Exercises skipped</div>
      </div>
    </div>
    <div class="card">
      <div class="section-label" style="margin-top:0">Session</div>
      <div style="font-size:16px;font-weight:700">${state.activeDay} — ${dayNames[state.activeDay]}</div>
      <div style="font-size:13px;color:var(--text2);margin-top:4px">${fmtDate(state.activeSession?.date || today())}</div>
    </div>
    <div style="margin-top:20px;">
      <button class="btn btn-primary" onclick="endAndGoHome()">Done</button>
    </div>`;
}

// ── Session detail ────────────────────────────────────────────────
async function openSessionDetail(sessionId) {
  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return;
  state.historySession = session;
  state.historyLogs = null;
  state.view = 'session-detail';
  renderView();

  try {
    let logs = [];
    try { logs = await Supabase.getSetLogs(sessionId); } catch (_) {}
    if (!logs.length) {
      try { logs = await DB.getAll('set_logs', 'session_id', sessionId); } catch (_) {}
    }
    state.historyLogs = logs;
  } catch (_) {
    state.historyLogs = [];
  } finally {
    // Guarantee we never stay stuck on the loading screen
    if (state.historyLogs === null) state.historyLogs = [];
    if (state.view === 'session-detail') renderView();
  }
}

async function deleteSession(sessionId) {
  if (!confirm('Delete this workout? This cannot be undone.')) return;

  // Remove set_logs from IndexedDB
  const logs = await DB.getAll('set_logs', 'session_id', sessionId);
  for (const log of logs) await DB.del('set_logs', log.id);
  await DB.del('sessions', sessionId);

  // Remove from Supabase: delete set_logs first (FK constraint), then session
  try { await Supabase.deleteSetLogsBySession(sessionId); } catch (_) {}
  try { await Supabase.deleteRecord('sessions', sessionId); } catch (_) {}

  state.sessions = state.sessions.filter(s => s.id !== sessionId);
  state.historySession = null;
  state.historyLogs = [];
  toast('Workout deleted');
  setTab('history');
}

function renderSessionDetail() {
  const session = state.historySession;
  if (!session) return renderHistory();

  const dayNames = { 'Day 1': 'Push', 'Day 2': 'Pull', 'Day 3': 'Legs' };
  const header = `
    <div class="page-header">
      <button class="back-btn" aria-label="Back" onclick="setTab('history')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div style="flex:1">
        <div class="page-title">${session.day} — ${dayNames[session.day] || ''}</div>
        <div class="page-subtitle">${fmtDate(session.date)} · ${daysAgo(session.date)}</div>
      </div>
      <button class="icon-btn-danger" data-delete-session="${session.id}" title="Delete workout">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>`;

  // Still fetching
  if (state.historyLogs === null) {
    return `${header}<div class="empty"><div class="empty-icon">⏳</div><div class="empty-body">Loading…</div></div>`;
  }

  const rawCompleted = state.historyLogs.filter(l => l.completed);

  if (!rawCompleted.length) {
    return `${header}<div class="empty"><div class="empty-icon">📋</div><div class="empty-body">No sets were logged for this session.</div></div>`;
  }

  // Deduplicate: keep latest log per (exercise_id, set_number)
  const dedupSeen = new Set();
  const completedLogs = rawCompleted
    .sort((a, b) => (b.logged_at || '').localeCompare(a.logged_at || ''))
    .filter(l => {
      const k = `${l.exercise_id}:${l.set_number}`;
      if (dedupSeen.has(k)) return false;
      dedupSeen.add(k);
      return true;
    });

  // Group completed logs by exercise, preserving set order
  const grouped = {};
  const order = [];
  for (const log of completedLogs) {
    if (!grouped[log.exercise_id]) {
      grouped[log.exercise_id] = [];
      order.push(log.exercise_id);
    }
    grouped[log.exercise_id].push(log);
  }

  const totalSets = completedLogs.length;
  const totalVolume = completedLogs.reduce((sum, l) => sum + (l.weight_lbs || 0) * (l.reps || 0), 0);

  const statBar = `
    <div class="sdet-stats">
      <div class="sdet-stat"><div class="sdet-stat-val">${totalSets}</div><div class="sdet-stat-label">Sets</div></div>
      <div class="sdet-stat"><div class="sdet-stat-val">${order.length}</div><div class="sdet-stat-label">Exercises</div></div>
      ${totalVolume ? `<div class="sdet-stat"><div class="sdet-stat-val">${(totalVolume/1000).toFixed(1)}k</div><div class="sdet-stat-label">lbs volume</div></div>` : ''}
    </div>`;

  const exerciseCards = order.map(exId => {
    const ex = state.exercises.find(e => e.id === exId);
    const name = ex?.name || 'Exercise';
    const sets = grouped[exId].sort((a, b) => a.set_number - b.set_number);

    const prWeight = state.prCache?.[exId]?.weight_lbs;
    const rows = sets.map(s => {
      const isPR = prWeight != null && s.weight_lbs != null && s.weight_lbs >= prWeight;
      return `
        <div class="sdet-set-row">
          <span class="sdet-set-num">${s.set_number}</span>
          <span class="sdet-set-weight">${s.weight_lbs != null ? s.weight_lbs + ' lbs' : '—'}</span>
          <span class="sdet-set-reps">${s.reps != null ? s.reps + ' reps' : '—'}</span>
          <span>${isPR ? '<span class="pr-badge">🏆 PR</span>' : ''}</span>
        </div>`;
    }).join('');

    return `
      <div class="card">
        <div class="sdet-ex-name">${name}</div>
        <div class="sdet-set-header">
          <span>Set</span><span>Weight</span><span>Reps</span><span></span>
        </div>
        ${rows}
      </div>`;
  }).join('');

  return `${header}${statBar}${exerciseCards}`;
}

// ── Progress tab ──────────────────────────────────────────────────
function renderProgress() {
  if (!state.progressLoaded) {
    loadProgressData().then(() => { if (state.view === 'progress') renderView(); });
    return `<div class="page-header"><div class="page-title">Progress</div></div>
      <div class="loading"><div class="spinner"></div><div>Loading…</div></div>`;
  }

  const dayDefs = [
    { key: null, label: 'All' },
    { key: 'Day 1', label: 'Push' },
    { key: 'Day 2', label: 'Pull' },
    { key: 'Day 3', label: 'Legs' },
  ];
  const chips = dayDefs.map(d =>
    `<button class="prog-chip ${state.progressDay === d.key ? 'active' : ''}" data-prog-day="${d.key || ''}">${d.label}</button>`
  ).join('');

  let exercises = state.exercises.filter(e => !e._custom && e.sets_target > 0);
  if (state.progressDay) exercises = exercises.filter(e => e.day === state.progressDay);
  exercises.sort((a, b) => a.sort_order - b.sort_order);

  const dayNames = { 'Day 1': 'Push', 'Day 2': 'Pull', 'Day 3': 'Legs' };
  const grouped = {};
  const dayOrder = [];
  for (const ex of exercises) {
    if (!grouped[ex.day]) { grouped[ex.day] = []; dayOrder.push(ex.day); }
    grouped[ex.day].push(ex);
  }

  let rowsHtml = '';
  for (const day of dayOrder) {
    rowsHtml += `<div class="section-label" style="margin-top:16px">${dayNames[day] || day} · ${day}</div>`;
    for (const ex of grouped[day]) {
      const last = state.lastCache?.[ex.id];
      const pr = state.prCache?.[ex.id];
      const history = state.historyCache?.[ex.id] || [];

      let trendEl = '';
      if (history.length >= 2) {
        const lastW = history[0].bestSet?.weight_lbs || 0;
        const prevW = history[1].bestSet?.weight_lbs || 0;
        if (lastW > prevW) trendEl = `<div class="prog-trend up">↑</div>`;
        else if (lastW < prevW) trendEl = `<div class="prog-trend down">↓</div>`;
        else trendEl = `<div class="prog-trend flat">→</div>`;
      }

      const thumb = IMAGE_KEYS.has(ex.image_key)
        ? `<img class="prog-thumb-img" src="icons/exercises/${ex.image_key}.jpg" alt="" loading="lazy">`
        : `<div class="prog-thumb-icon">💪</div>`;

      const isPR = pr && last && pr.date === last.date;
      const prBadge = isPR ? ` <span class="pr-badge">🏆 PR</span>` : '';

      const lastVal = last
        ? `${last.bestSet.weight_lbs} lbs × ${last.bestSet.reps}${prBadge}`
        : `<span class="prog-no-data">No data yet</span>`;

      rowsHtml += `
        <div class="prog-row" data-prog-ex="${ex.id}">
          <div class="prog-thumb">${thumb}</div>
          <div class="prog-info">
            <div class="prog-name">${ex.name}</div>
            <div class="prog-stats">
              <div class="prog-stat">
                <div class="prog-stat-label">Last</div>
                <div class="prog-stat-value">${lastVal}</div>
              </div>
              ${pr ? `<div class="prog-stat">
                <div class="prog-stat-label">PR 🏆</div>
                <div class="prog-stat-value prog-pr-val">${pr.weight_lbs} lbs × ${pr.reps}</div>
              </div>` : ''}
            </div>
          </div>
          <div class="prog-right">
            ${trendEl}
            <div class="prog-chevron">›</div>
          </div>
        </div>`;
    }
  }

  if (!rowsHtml) {
    rowsHtml = `<div class="empty">
      <div class="empty-icon">📊</div>
      <div class="empty-title">No data yet</div>
      <div class="empty-body">Complete a workout to track your progress here.</div>
    </div>`;
  }

  return `
    <div class="page-header">
      <div class="page-title">Progress</div>
    </div>
    <div class="prog-chip-row">${chips}</div>
    ${rowsHtml}`;
}

function buildProgressChart(history, pr, range) {
  if (history.length < 1) return '';

  const svgW = 328, svgH = 140;
  const leftPad = 28, rightPad = 12, topPad = 16, bottomPad = 22;
  const chartW = svgW - leftPad - rightPad;
  const chartH = svgH - topPad - bottomPad;

  const weights = history.map(h => h.bestSet.weight_lbs);
  const rawMax = Math.max(...weights, pr?.weight_lbs || 0);
  const rawMin = Math.min(...weights);
  const span = rawMax - rawMin || 1;
  const yStep = Math.max(5, Math.ceil(span / 3 / 5) * 5);
  const yMin = Math.floor(rawMin / yStep) * yStep;
  const yMax = yMin + yStep * 4;
  const yRange = yMax - yMin || 1;

  const toY = w => topPad + chartH - ((w - yMin) / yRange) * chartH;
  const toX = i => leftPad + (history.length === 1 ? chartW / 2 : (i / (history.length - 1)) * chartW);

  const yLabels = [yMin + yStep * 3, yMin + yStep * 2, yMin + yStep, yMin];
  const yAxisHtml = yLabels.map(v =>
    `<text x="0" y="${(toY(v) + 4).toFixed(1)}" fill="#606060" font-size="10" font-family="-apple-system,sans-serif">${v}</text>`
  ).join('');
  const gridLines = yLabels.map(v =>
    `<line x1="${leftPad}" y1="${toY(v).toFixed(1)}" x2="${svgW}" y2="${toY(v).toFixed(1)}" stroke="#242424" stroke-width="1"/>`
  ).join('');

  let prLine = '';
  if (pr && pr.weight_lbs >= yMin && pr.weight_lbs <= yMax) {
    const py = toY(pr.weight_lbs).toFixed(1);
    prLine = `<line x1="${leftPad}" y1="${py}" x2="${svgW}" y2="${py}" stroke="#f59e0b" stroke-width="1" stroke-dasharray="4,3" opacity="0.4"/>`;
  }

  const pts = history.map((h, i) => `${toX(i).toFixed(1)},${toY(h.bestSet.weight_lbs).toFixed(1)}`);
  const polyPoints = pts.join(' ');
  const bottomY = topPad + chartH;
  const fillPoints = `${pts.join(' ')} ${toX(history.length - 1).toFixed(1)},${bottomY} ${toX(0).toFixed(1)},${bottomY}`;

  const prDate = pr?.date;
  const dots = history.map((h, i) => {
    const cx = toX(i).toFixed(1), cy = toY(h.bestSet.weight_lbs).toFixed(1);
    if (h.date === prDate) {
      return `<circle cx="${cx}" cy="${cy}" r="7" fill="#f59e0b" stroke="#f59e0b" stroke-width="2"/>
        <text x="${cx}" y="${(parseFloat(cy) - 11).toFixed(1)}" fill="#f59e0b" font-size="10" font-family="-apple-system,sans-serif" text-anchor="middle" font-weight="700">PR</text>`;
    }
    return `<circle cx="${cx}" cy="${cy}" r="5" fill="#1a1a1a" stroke="#E91E8C" stroke-width="2"/>`;
  }).join('');

  const maxLabels = 5;
  const step = Math.max(1, Math.ceil(history.length / maxLabels));
  const xLabels = history.map((h, i) => {
    if (i % step !== 0 && i !== history.length - 1) return '';
    const d = new Date(h.date + 'T00:00:00');
    const label = `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`;
    const fill = h.date === prDate ? '#f59e0b' : '#606060';
    const fw = h.date === prDate ? '700' : '400';
    return `<text x="${toX(i).toFixed(1)}" y="${svgH - 4}" fill="${fill}" font-size="9" font-family="-apple-system,sans-serif" text-anchor="middle" font-weight="${fw}">${label}</text>`;
  }).join('');

  const rangeBtns = ['1M', '3M', 'All'].map(r =>
    `<button class="prog-range-btn ${state.progressRange === r ? 'active' : ''}" data-prog-range="${r}">${r}</button>`
  ).join('');

  return `
    <div class="prog-chart-wrap">
      <div class="prog-chart-title-row">
        <div class="prog-chart-title">Top set weight</div>
        <div class="prog-range-row">${rangeBtns}</div>
      </div>
      <svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%;overflow:visible" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="prog-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#E91E8C"/>
            <stop offset="100%" stop-color="#E91E8C" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${yAxisHtml}${gridLines}${prLine}
        ${history.length > 1 ? `<polyline points="${polyPoints}" fill="none" stroke="#E91E8C" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.7"/>` : ''}
        ${history.length > 1 ? `<polygon points="${fillPoints}" fill="url(#prog-grad)" opacity="0.12"/>` : ''}
        ${dots}${xLabels}
      </svg>
    </div>`;
}

function renderProgressExercise() {
  const exId = state.progressExercise;
  const ex = state.exercises.find(e => e.id === exId);
  if (!ex) return renderProgress();

  const history = state.historyCache?.[exId] || [];
  const pr = state.prCache?.[exId];

  const sessionCount = history.length;
  const firstDate = history.length > 0 ? fmtDate(history[history.length - 1].date) : null;

  const prBar = `
    <div class="prog-pr-summary">
      <div class="prog-pr-item">
        <div class="prog-pr-label">All-Time PR 🏆</div>
        <div class="prog-pr-value" style="color:var(--gold)">${pr ? `${pr.weight_lbs} lbs × ${pr.reps}` : '—'}</div>
        ${pr ? `<div class="prog-pr-sub">${fmtDate(pr.date)}</div>` : ''}
      </div>
      <div class="prog-pr-divider"></div>
      <div class="prog-pr-item" style="text-align:right">
        <div class="prog-pr-label">Sessions</div>
        <div class="prog-pr-value">${sessionCount}</div>
        ${firstDate ? `<div class="prog-pr-sub">since ${firstDate}</div>` : ''}
      </div>
    </div>`;

  const range = state.progressRange || '3M';
  const cutoffDays = { '1M': 30, '3M': 90, 'All': Infinity };
  const maxDays = cutoffDays[range] ?? 90;
  const nowMs = new Date(today() + 'T00:00:00').getTime();
  const chartHistory = history
    .filter(h => (nowMs - new Date(h.date + 'T00:00:00').getTime()) / 86400000 <= maxDays)
    .slice().reverse();

  const chartHtml = buildProgressChart(chartHistory, pr, range);

  const histRows = history.map(h => {
    const isPR = pr && h.date === pr.date;
    return `
      <div class="prog-hist-row">
        <div class="prog-hist-date">${fmtDate(h.date)}</div>
        <div class="prog-hist-info">
          <div class="prog-hist-best">${h.bestSet.weight_lbs} lbs × ${h.bestSet.reps}</div>
          <div class="prog-hist-sub">${h.sets.length} set${h.sets.length !== 1 ? 's' : ''} total</div>
        </div>
        ${isPR ? `<div class="pr-badge">🏆 PR</div>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="page-header">
      <button class="back-btn" aria-label="Back" onclick="navigateTo('progress')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div class="page-title" style="font-size:18px">${ex.name}</div>
    </div>
    ${prBar}
    ${chartHtml}
    <div class="section-label" style="margin-top:16px">Session history</div>
    ${histRows || `<div class="empty"><div class="empty-icon">📋</div><div class="empty-body">No sessions yet.</div></div>`}`;
}

// ── History view ──────────────────────────────────────────────────
function renderHistory() {
  if (!state.sessions.length) {
    return `
      <div class="page-header"><div class="page-title">History</div></div>
      <div class="empty">
        <div class="empty-icon">📋</div>
        <div class="empty-title">No workouts yet</div>
        <div class="empty-body">Complete your first workout to see it here.</div>
      </div>`;
  }

  const dayNames = { 'Day 1': 'Push', 'Day 2': 'Pull', 'Day 3': 'Legs' };
  const cards = state.sessions.map(s => `
    <div class="session-card" data-session-id="${s.id}">
      <div class="session-card-header">
        <div>
          <div class="session-card-day">${s.day} — ${dayNames[s.day] || ''}</div>
          <div class="session-card-date">${fmtDate(s.date)}</div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="color:var(--text3);flex-shrink:0"><path d="M9 18l6-6-6-6"/></svg>
      </div>
      <div class="session-card-stats">${daysAgo(s.date)}</div>
    </div>`).join('');

  return `
    <div class="page-header">
      <div class="page-title">History</div>
    </div>
    ${cards}`;
}

// ── Rest timer render ─────────────────────────────────────────────
function renderRestTimer() {
  const el = document.getElementById('rest-timer');
  if (!el) return;
  if (!state.restTimer.active) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const { remaining, duration } = state.restTimer;
  const pct = Math.round((remaining / duration) * 100);
  const mm = String(Math.floor(remaining / 60)).padStart(2,'0');
  const ss = String(remaining % 60).padStart(2,'0');
  el.innerHTML = `
    <div>
      <div class="timer-label">Rest timer</div>
    </div>
    <div class="timer-bar-wrap">
      <div class="timer-bar" style="width:${pct}%"></div>
    </div>
    <div class="timer-text">${mm}:${ss}</div>
    <button class="timer-stop" onclick="stopRestTimer()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
    </button>`;
}

// ── Event binding ─────────────────────────────────────────────────
function bindViewEvents() {
  const view = document.getElementById('main-view');
  if (!view) return;

  // Day card start buttons
  view.querySelectorAll('[data-day-start]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const day = btn.dataset.dayStart;
      if (state.activeSession?.day === day) {
        navigateTo('workout');
      } else {
        startSession(day);
      }
    });
  });

  // Exercise row click → detail or superset-detail (delegated)
  const sectionSortEl = view.querySelector('#section-sortable');
  if (sectionSortEl) {
    sectionSortEl.addEventListener('click', e => {
      if (e.target.closest('.drag-handle') || e.target.closest('.section-drag-handle')) return;
      if (e.target.closest('.ex-group-btn') || e.target.closest('.ss-menu-btn')) return;
      const row = e.target.closest('.exercise-row[data-ex-id]');
      if (!row) return;
      const exId = row.dataset.exId;
      const ex = state.sessionExercises.find(ex => ex.id === exId)
             || state.exercises.find(ex => ex.id === exId);
      if (!ex) return;
      if (ex.superset_group) {
        navigateTo('superset-detail', { supersetId: ex.superset_group });
      } else {
        navigateTo('exercise-detail', { exercise: ex });
      }
    });
  }

  // Set input events — fire on every keystroke so tapping Complete right after typing works
  view.querySelectorAll('.set-input[data-ex-id]').forEach(input => {
    const exId = input.dataset.exId;
    const idx = parseInt(input.dataset.setIdx);
    const field = input.dataset.field;
    const save = () => updateSet(exId, idx, field === 'w' ? 'weight_lbs' : 'reps', input.value);
    input.addEventListener('input', save);
    input.addEventListener('change', save);
  });

  // +/− adj buttons
  view.querySelectorAll('.adj-btn[data-ex-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const exId = btn.dataset.exId;
      const idx = parseInt(btn.dataset.setIdx);
      const field = btn.dataset.field;
      const dir = btn.dataset.dir;
      const input = view.querySelector(`.set-input[data-ex-id="${CSS.escape(exId)}"][data-set-idx="${idx}"][data-field="${field}"]`);
      if (!input) return;
      let val = parseFloat(input.value) || 0;
      if (field === 'w') val = dir === 'plus' ? val + 5 : Math.max(0, val - 5);
      else val = dir === 'plus' ? val + 1 : Math.max(0, val - 1);
      input.value = val;
      updateSet(exId, idx, field === 'w' ? 'weight_lbs' : 'reps', val);
    });
  });

  // Complete set button
  view.querySelectorAll('.complete-btn[data-ex-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const exId = btn.dataset.exId;
      const idx = parseInt(btn.dataset.setIdx);
      const esc = CSS.escape(exId);
      const input_w = view.querySelector(`.set-input[data-ex-id="${esc}"][data-set-idx="${idx}"][data-field="w"]`);
      const input_r = view.querySelector(`.set-input[data-ex-id="${esc}"][data-set-idx="${idx}"][data-field="r"]`);
      if (input_w) updateSet(exId, idx, 'weight_lbs', input_w.value);
      if (input_r) updateSet(exId, idx, 'reps', input_r.value);
      toggleComplete(exId, idx);
    });
  });

  // Timer options
  view.querySelectorAll('.timer-opt').forEach(btn => {
    btn.addEventListener('click', () => setTimerDuration(parseInt(btn.dataset.sec)));
  });

  // Session card click → detail
  view.querySelectorAll('.session-card[data-session-id]').forEach(card => {
    card.addEventListener('click', () => openSessionDetail(card.dataset.sessionId));
  });

  // Session detail delete button
  view.querySelectorAll('[data-delete-session]').forEach(btn => {
    btn.addEventListener('click', () => deleteSession(btn.dataset.deleteSession));
  });

  // Notes textarea
  view.querySelectorAll('.notes-textarea').forEach(ta => {
    ta.addEventListener('input', () => saveExerciseNote(ta.dataset.exId, ta.value));
  });

  // Custom exercise name edit
  view.querySelectorAll('.detail-name-input').forEach(input => {
    input.addEventListener('change', () => {
      const ex = state.sessionExercises.find(e => e.id === input.dataset.exId);
      if (ex) { ex.name = input.value; state.detailExercise = ex; }
    });
  });

  // Progress filter chips
  view.querySelectorAll('.prog-chip[data-prog-day]').forEach(chip => {
    chip.addEventListener('click', () => {
      const val = chip.dataset.progDay;
      state.progressDay = val || null;
      renderView();
    });
  });

  // Progress exercise row → drill-in
  view.querySelectorAll('.prog-row[data-prog-ex]').forEach(row => {
    row.addEventListener('click', () => {
      state.progressExercise = row.dataset.progEx;
      state.view = 'progress-exercise';
      renderView();
    });
  });

  // Chart range buttons
  view.querySelectorAll('.prog-range-btn[data-prog-range]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.progressRange = btn.dataset.progRange;
      renderView();
    });
  });

  // ⋮ menu on superset card headers
  view.querySelectorAll('.ss-menu-btn[data-ss-menu]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showSupersetMenu(btn.dataset.ssMenu, btn);
    });
  });

  // Chain icon → group picker bottom sheet
  view.querySelectorAll('.ex-group-btn[data-group-ex]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showGroupPicker(btn.dataset.groupEx);
    });
  });

  // "See history" from exercise detail → progress drill-in
  view.querySelectorAll('.last-see-history[data-prog-ex]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.progressExercise = btn.dataset.progEx;
      state.tab = 'progress';
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === 'progress');
      });
      state.view = 'progress-exercise';
      renderView();
    });
  });

  // Drag-and-drop: nested SortableJS (sections + exercises within sections)
  if (sectionSortEl && typeof Sortable !== 'undefined') {
    Sortable.create(sectionSortEl, {
      handle: '.section-drag-handle',
      animation: 150,
      delay: 120,
      delayOnTouchOnly: true,
      draggable: '.section-group',
      onEnd() { rebuildSessionExercisesFromDOM(); },
    });
    sectionSortEl.querySelectorAll('.exercise-sortable-inner').forEach(innerEl => {
      Sortable.create(innerEl, {
        handle: '.drag-handle',
        animation: 150,
        delay: 120,
        delayOnTouchOnly: true,
        onEnd() { rebuildSessionExercisesFromDOM(); },
      });
    });
  }
}

function bindSetRowEvents(rowEl, exerciseId, i) {
  const esc = CSS.escape(exerciseId);
  rowEl.querySelectorAll('.set-input[data-ex-id]').forEach(input => {
    const field = input.dataset.field;
    const save = () => updateSet(exerciseId, i, field === 'w' ? 'weight_lbs' : 'reps', input.value);
    input.addEventListener('input', save);
    input.addEventListener('change', save);
  });
  rowEl.querySelectorAll('.adj-btn[data-ex-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.field;
      const dir = btn.dataset.dir;
      const input = rowEl.querySelector(`.set-input[data-ex-id="${esc}"][data-set-idx="${i}"][data-field="${field}"]`);
      if (!input) return;
      let val = parseFloat(input.value) || 0;
      if (field === 'w') val = dir === 'plus' ? val + 5 : Math.max(0, val - 5);
      else val = dir === 'plus' ? val + 1 : Math.max(0, val - 1);
      input.value = val;
      updateSet(exerciseId, i, field === 'w' ? 'weight_lbs' : 'reps', val);
    });
  });
  const completeBtn = rowEl.querySelector('.complete-btn[data-ex-id]');
  if (completeBtn) {
    completeBtn.addEventListener('click', () => {
      const input_w = rowEl.querySelector(`.set-input[data-ex-id="${esc}"][data-set-idx="${i}"][data-field="w"]`);
      const input_r = rowEl.querySelector(`.set-input[data-ex-id="${esc}"][data-set-idx="${i}"][data-field="r"]`);
      if (input_w) updateSet(exerciseId, i, 'weight_lbs', input_w.value);
      if (input_r) updateSet(exerciseId, i, 'reps', input_r.value);
      toggleComplete(exerciseId, i);
    });
  }
}

// ── Auth UI ───────────────────────────────────────────────────────
function showLoginScreen(msg = '') {
  document.getElementById('tab-bar').style.display = 'none';
  document.getElementById('main-view').innerHTML = `
    <div class="login-screen">
      <div class="login-logo">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--pink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
        </svg>
      </div>
      <div class="login-title">Workout Tracker</div>
      <div class="login-subtitle">Sign in to sync your workouts</div>
      ${msg ? `<div class="login-msg">${msg}</div>` : ''}
      <div id="login-error" class="login-error" style="display:none"></div>
      <input id="login-email" type="email" class="login-input" placeholder="Email" autocomplete="email" inputmode="email" />
      <input id="login-password" type="password" class="login-input" placeholder="Password (min 6 chars)" autocomplete="current-password" />
      <button class="btn btn-primary" style="width:100%" onclick="handleLogin()">Sign In</button>
      <button class="btn btn-secondary" style="width:100%;margin-top:8px" onclick="handleSignup()">Create Account</button>
    </div>`;

  // Allow enter key to submit
  document.getElementById('main-view').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
}

async function handleLogin() {
  const email = document.getElementById('login-email')?.value?.trim();
  const password = document.getElementById('login-password')?.value;
  const errEl = document.getElementById('login-error');
  if (!email || !password) { showLoginError('Enter your email and password.'); return; }
  const btn = document.querySelector('.login-screen .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  try {
    const session = await Supabase.signIn(email, password);
    await finishAuth(session);
  } catch (e) {
    showLoginError(e.message || 'Sign in failed. Check your email and password.');
    if (btn) { btn.disabled = false; btn.textContent = 'Sign In'; }
  }
}

async function handleSignup() {
  const email = document.getElementById('login-email')?.value?.trim();
  const password = document.getElementById('login-password')?.value;
  if (!email || !password) { showLoginError('Enter an email and password.'); return; }
  if (password.length < 6) { showLoginError('Password must be at least 6 characters.'); return; }
  const btn = document.querySelector('.login-screen .btn-secondary');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating account…'; }
  try {
    const result = await Supabase.signUp(email, password);
    if (result?.access_token) {
      await finishAuth(result);
    } else {
      // Email confirmation required
      showLoginScreen('Account created! Check your email for a confirmation link, then sign in.');
    }
  } catch (e) {
    showLoginError(e.message || 'Sign up failed.');
    if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

async function handleLogout() {
  await Supabase.signOut();
  state.user = null;
  state.sessions = [];
  state.exercises = [];
  state.activeSession = null;
  state.activeDay = null;
  state.setLogs = {};
  state.lastLogs = {};
  state.prCache = null;
  state.lastCache = null;
  state.historyCache = null;
  state.progressLoaded = false;
  state.sessionPRCount = 0;
  showLoginScreen();
}

async function finishAuth(session) {
  state.user = session.user;
  document.getElementById('tab-bar').style.display = '';
  document.getElementById('main-view').innerHTML = `<div class="loading"><div class="spinner"></div><div>Loading…</div></div>`;
  await loadExercises(); // Must run before syncIfOnline so exercises exist in Supabase for local-* remap
  await syncIfOnline();
  await loadSessions();
  await loadProgressData();
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });
  window.addEventListener('online', () => { updateSyncDot(); syncIfOnline(); });
  window.addEventListener('offline', () => updateSyncDot());
  renderView();
  renderRestTimer();
}

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  await DB.open();
  updateSyncDot();

  const session = await Supabase.restoreSession();
  if (!session) {
    showLoginScreen();
    return;
  }
  state.user = session.user;

  document.getElementById('main-view').innerHTML = `<div class="loading"><div class="spinner"></div><div>Loading…</div></div>`;

  await loadExercises(); // Must run before syncIfOnline so exercises exist in Supabase for local-* remap
  await syncIfOnline();
  await loadSessions();
  await loadProgressData();

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });
  window.addEventListener('online', () => { updateSyncDot(); syncIfOnline(); });
  window.addEventListener('offline', () => updateSyncDot());

  renderView();
  renderRestTimer();
}

document.addEventListener('DOMContentLoaded', init);
