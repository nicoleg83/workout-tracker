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
  const reordered = ids.map(id => byId.get(id)).filter(Boolean);
  const defaultSet = new Set(ids);
  const extras = state.sessionExercises.filter(e => !defaultSet.has(e.id));
  state.sessionExercises = [...reordered, ...extras];
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
    case 'home':     el.innerHTML = renderHome(); break;
    case 'workout':  el.innerHTML = renderWorkout(); break;
    case 'exercise-detail': el.innerHTML = renderExerciseDetail(); break;
    case 'summary':  el.innerHTML = renderSummary(); break;
    case 'history':         el.innerHTML = renderHistory(); break;
    case 'session-detail':  el.innerHTML = renderSessionDetail(); break;
    default:         el.innerHTML = renderHome();
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
  if (!state.activeSession) { setTab('home'); return ''; }
  const exercises = currentDayExercises();
  const prog = exerciseProgress(exercises);
  const dayNames = { 'Day 1':'Push', 'Day 2':'Pull', 'Day 3':'Legs' };
  const groups = buildSectionGroups(exercises);

  let html = `
    <div class="page-header">
      <button class="back-btn" onclick="endAndGoHome()">
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

      // Last session hint
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

      html += `<div class="exercise-row ${allDone?'done':''} ${isSkipped?'skipped':''} ${isNoteOnly?'note-only':''}" data-ex-id="${ex.id}">
        <div class="drag-handle">⠿</div>
        <div class="exercise-row-thumb">${thumb}</div>
        <div class="exercise-row-info">
          <div class="exercise-row-name">${ex.name}</div>
          ${meta}
          ${lastHint}
        </div>
        <div class="exercise-row-status">${statusEl}</div>
      </div>`;
    }

    html += `</div></div>`;
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
      <button class="back-btn" onclick="navigateTo('workout')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div style="flex:1">
        ${nameEl}
      </div>
    </div>
    ${mediaEl}
    ${infoCard}
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

// ── Summary view ─────────────────────────────────────────────────
function renderSummary() {
  const { completedSets, totalSets, exercises } = state.summaryData || {};
  const prs = 0;
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
      <button class="back-btn" onclick="setTab('history')">
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

    const rows = sets.map(s => `
      <div class="sdet-set-row">
        <span class="sdet-set-num">${s.set_number}</span>
        <span class="sdet-set-weight">${s.weight_lbs != null ? s.weight_lbs + ' lbs' : '—'}</span>
        <span class="sdet-set-reps">${s.reps != null ? s.reps + ' reps' : '—'}</span>
      </div>`).join('');

    return `
      <div class="card">
        <div class="sdet-ex-name">${name}</div>
        <div class="sdet-set-header">
          <span>Set</span><span>Weight</span><span>Reps</span>
        </div>
        ${rows}
      </div>`;
  }).join('');

  return `${header}${statBar}${exerciseCards}`;
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

  // Exercise row click → detail (delegated)
  const sectionSortEl = view.querySelector('#section-sortable');
  if (sectionSortEl) {
    sectionSortEl.addEventListener('click', e => {
      if (e.target.closest('.drag-handle') || e.target.closest('.section-drag-handle')) return;
      const row = e.target.closest('.exercise-row[data-ex-id]');
      if (!row) return;
      const exId = row.dataset.exId;
      const ex = state.sessionExercises.find(ex => ex.id === exId)
             || state.exercises.find(ex => ex.id === exId);
      if (ex) navigateTo('exercise-detail', { exercise: ex });
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
  showLoginScreen();
}

async function finishAuth(session) {
  state.user = session.user;
  document.getElementById('tab-bar').style.display = '';
  document.getElementById('main-view').innerHTML = `<div class="loading"><div class="spinner"></div><div>Loading…</div></div>`;
  await loadExercises(); // Must run before syncIfOnline so exercises exist in Supabase for local-* remap
  await syncIfOnline();
  await loadSessions();
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

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });
  window.addEventListener('online', () => { updateSyncDot(); syncIfOnline(); });
  window.addEventListener('offline', () => updateSyncDot());

  renderView();
  renderRestTimer();
}

document.addEventListener('DOMContentLoaded', init);
