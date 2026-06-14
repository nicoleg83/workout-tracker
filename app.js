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
  editDay: null,
  editDraft: null,
  editDirty: false,
  routineDays: [],
  librarySearch: '',
  libraryFilter: null,
  prCache: null,
  lastCache: null,
  historyCache: null,
  progressLoaded: false,
  sessionPRCount: 0,
  sessionPRExercises: new Set(),
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
// Haptic feedback — degrades silently on devices/browsers without vibrate support
function haptic(pattern = 10) {
  try { navigator.vibrate?.(pattern); } catch (_) {}
}
// Resolve an exercise's muscles. Runtime rows loaded from Supabase predate the
// muscles field, so fall back to the bundled EXERCISES constant by image_key.
function exerciseMuscles(ex) {
  if (!ex) return null;
  if (ex.muscles) return ex.muscles;
  if (ex.image_key && typeof EXERCISES !== 'undefined') {
    const match = EXERCISES.find(e => e.image_key === ex.image_key);
    if (match && match.muscles) return match.muscles;
  }
  return null;
}
function fmtDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
}
// Collapse duplicate set_number entries (e.g. an offline un-complete that left
// an orphan row in Supabase) keeping the most recently logged one. Without this,
// a prior session can render the same set number twice in the "Last session" card.
function dedupeSetLogs(logs) {
  const bySet = new Map();
  for (const l of (logs || [])) {
    const cur = bySet.get(l.set_number);
    if (!cur || (l.logged_at || '') > (cur.logged_at || '')) bySet.set(l.set_number, l);
  }
  return Array.from(bySet.values()).sort((a, b) => a.set_number - b.set_number);
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
function isTimeBased(exId) {
  const ex = state.sessionExercises.find(e => e.id === exId) || state.exercises.find(e => e.id === exId);
  return ex ? /^\d+s$/.test(ex.reps_target || '') : false;
}
// Escape user-entered text before injecting into innerHTML (notes, etc.)
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
// Bar-based exercises get a saved "bar weight" reference field.
function usesBar(ex) { return /bar/i.test(ex?.equipment || ''); }
function barWeightKey(ex) { return `wt_barweight_${ex.image_key || ex.id}`; }
function getBarWeight(ex) {
  try { return localStorage.getItem(barWeightKey(ex)) || ''; } catch (_) { return ''; }
}
function saveBarWeight(exId, value) {
  const ex = state.sessionExercises.find(e => e.id === exId) || state.exercises.find(e => e.id === exId);
  if (!ex) return;
  try {
    const v = String(value).trim();
    if (v) localStorage.setItem(barWeightKey(ex), v);
    else localStorage.removeItem(barWeightKey(ex));
  } catch (_) {}
}

// Assisted exercises (e.g. assisted pull-ups): LOWER weight = better, so PRs
// and "best set" invert. Auto-detected from name/equipment, override saved locally.
function assistedKey(ex) { return `wt_assisted_${ex.image_key || ex.id}`; }
function isAssisted(ex) {
  if (!ex) return false;
  try {
    const o = localStorage.getItem(assistedKey(ex));
    if (o === '1') return true;
    if (o === '0') return false;
  } catch (_) {}
  return /assist/i.test(`${ex.name || ''} ${ex.equipment || ''}`);
}
function isAssistedById(exId) {
  return isAssisted(state.exercises.find(e => e.id === exId) || state.sessionExercises.find(e => e.id === exId));
}
function setAssistedOverride(exId, value) {
  const ex = state.sessionExercises.find(e => e.id === exId) || state.exercises.find(e => e.id === exId);
  if (!ex) return;
  try { localStorage.setItem(assistedKey(ex), value ? '1' : '0'); } catch (_) {}
}
function toggleAssisted(exId) {
  setAssistedOverride(exId, !isAssistedById(exId));
  state.progressLoaded = false; // recompute PRs/best-sets with the new direction
  renderView();
}
function buildSectionGroups(exercises) {
  // Group by section. An empty section ('') is a heading-less flat list — this
  // is where ungrouped exercises land so they "merge into one long list."
  const groups = [];
  const idx = {};
  for (const ex of exercises) {
    const s = ex.section || '';
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

// ── Workout days (data-driven, with creator mode) ────────────────────
const DEFAULT_ROUTINE_DAYS = [
  { label:'Day 1', name:'Push', muscles:'Chest · Shoulders · Triceps', color:'#E91E8C', sort_order:1 },
  { label:'Day 2', name:'Pull', muscles:'Back · Biceps · Rear Delts', color:'#9C27B0', sort_order:2 },
  { label:'Day 3', name:'Legs', muscles:'Glutes · Hamstrings · Quads', color:'#3F51B5', sort_order:3 },
  { label:'Day 4', name:'Full Body', muscles:'Legs · Core · Shoulder Stability', color:'#00897B', sort_order:4 },
];

async function loadRoutineDays() {
  if (navigator.onLine) {
    try {
      let days = await Supabase.getRoutineDays();
      if (!days || days.length === 0) {
        days = DEFAULT_ROUTINE_DAYS.map(d => ({ id: uuid(), archived: false, ...d }));
        for (const d of days) { try { await Supabase.insert('routine_days', d); } catch (_) {} }
      }
      await DB.bulkPut('routine_days', days);
      state.routineDays = days.filter(d => !d.archived).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      return;
    } catch (_) {}
  }
  const cached = await DB.getAll('routine_days');
  state.routineDays = (cached.length ? cached : DEFAULT_ROUTINE_DAYS.map((d, i) => ({ id: `local-day-${i}`, archived: false, ...d })))
    .filter(d => !d.archived).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
}

function dayMeta(label) { return (state.routineDays || []).find(d => d.label === label) || null; }
function dayName(label) { return dayMeta(label)?.name || ''; }

// Create a new workout day (creator mode). Returns the new day label.
async function createNewDay() {
  const name = (prompt('Name your new day (e.g. "Arms", "Conditioning"):') || '').trim();
  if (!name) return;
  const nums = (state.routineDays || []).map(d => parseInt((d.label || '').replace(/\D/g, '')) || 0);
  const label = `Day ${Math.max(0, ...nums) + 1}`;
  const sort_order = (state.routineDays || []).reduce((m, d) => Math.max(m, d.sort_order || 0), 0) + 1;
  const row = { id: uuid(), label, name, muscles: '', color: '#00897B', sort_order, archived: false };
  state.routineDays.push(row);
  await DB.put('routine_days', row);
  await DB.queueSync('routine_days', 'insert', row);
  syncIfOnline();
  openEditDay(label); // start adding exercises from the Library
}

async function persistRoutineDay(row) {
  await DB.put('routine_days', row);
  await DB.queueSync('routine_days', 'update', row);
  syncIfOnline();
}

// Rename a day (changes the display name; the internal label/key is unchanged).
async function renameDay(label) {
  const d = dayMeta(label);
  if (!d) return;
  const name = (prompt('Rename this day:', d.name || '') || '').trim();
  if (!name || name === d.name) return;
  d.name = name;
  await persistRoutineDay(d);
  renderView();
}

// Persist a drag-reorder of the home day cards into routine_days.sort_order.
function reorderDaysFromDOM() {
  const view = document.getElementById('main-view');
  if (!view) return;
  const labels = [...view.querySelectorAll('.day-cards .day-card[data-day]')].map(el => el.dataset.day);
  labels.forEach((label, i) => {
    const d = dayMeta(label);
    if (d && d.sort_order !== i + 1) { d.sort_order = i + 1; persistRoutineDay(d); }
  });
  state.routineDays.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  renderView();
}

// Reset all logged history + PRs for one exercise (deletes its set_logs everywhere).
async function deleteExerciseHistory(exId) {
  const ex = state.exercises.find(e => e.id === exId);
  const name = ex?.name || 'this exercise';
  if (!confirm(`Reset all history & PRs for "${name}"? This permanently deletes every logged set for it and can't be undone.`)) return;
  const logs = await DB.getAll('set_logs', 'exercise_id', exId);
  for (const l of logs) {
    await DB.del('set_logs', l.id);
    try { await Supabase.deleteRecord('set_logs', l.id); } catch (_) {}
  }
  const ids = new Set(logs.map(l => l.id));
  const pending = await DB.getAll('pending_sync');
  for (const p of pending) { if (p.payload && ids.has(p.payload.id)) await DB.del('pending_sync', p.id); }
  if (state.prCache) delete state.prCache[exId];
  if (state.historyCache) delete state.historyCache[exId];
  if (state.lastCache) delete state.lastCache[exId];
  state.progressLoaded = false;
  await loadProgressData();
  toast('History reset');
  navigateTo('progress', {}, 'back');
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
  // Collapse any duplicate set_number rows (orphans from offline un-completes)
  // so both the prefill and the "Last session" card show each set once.
  for (const exId of Object.keys(state.lastLogs)) {
    state.lastLogs[exId] = dedupeSetLogs(state.lastLogs[exId]);
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
    const assisted = isAssistedById(exId); // lower weight is better
    const history = Object.entries(sessMap)
      .map(([sid, { date, sets }]) => {
        const best = sets.reduce((b, s) => {
          if (!b) return s;
          if (assisted ? s.weight_lbs < b.weight_lbs : s.weight_lbs > b.weight_lbs) return s;
          if (s.weight_lbs === b.weight_lbs && (s.reps || 0) > (b.reps || 0)) return s;
          return b;
        }, null);
        return { sessionId: sid, date, sets: sets.sort((a, b) => a.set_number - b.set_number), bestSet: best };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    state.historyCache[exId] = history;
    if (history.length > 0) state.lastCache[exId] = history[0];
    let pr = null;
    for (const sess of history) {
      if (!pr || (assisted ? sess.bestSet.weight_lbs < pr.weight_lbs : sess.bestSet.weight_lbs > pr.weight_lbs)) {
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
  const assisted = isAssistedById(exerciseId);
  if (!pr || (assisted ? w < pr.weight_lbs : w > pr.weight_lbs)) {
    state.prCache[exerciseId] = { weight_lbs: w, reps: parseInt(reps) || 0, date: today() };
    const ex = state.sessionExercises.find(e => e.id === exerciseId)
            || state.exercises.find(e => e.id === exerciseId);
    const name = ex?.name || 'Exercise';
    // Count one PR per exercise per session — beating your own new best on a
    // later set in the same session shouldn't inflate the summary's PR tally.
    state.sessionPRExercises.add(exerciseId);
    state.sessionPRCount = state.sessionPRExercises.size;
    state.progressLoaded = false;
    toast(`New PR — ${name} 🏆`, 'success');
    haptic([10, 60, 20]);
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
  renderView('tab');
  // Background-refresh sessions when switching to History
  if (tab === 'history' && navigator.onLine) {
    loadSessions().then(() => { if (state.view === 'history') renderView(); });
  }
}

function navigateTo(view, data = {}, direction = 'forward') {
  state.view = view;
  if (data.exercise) state.detailExercise = data.exercise;
  if (data.day) state.activeDay = data.day;
  if (data.exId !== undefined) state.progressExercise = data.exId;
  if (data.supersetId !== undefined) state.detailSupersetId = data.supersetId;
  renderView(direction);
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
  state.sessionPRCount = 0;
  state.sessionPRExercises = new Set();

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
  localStorage.setItem('activeWorkoutSessionId', session.id);

  state.sessionExercises = [
    makeWarmup(day, session.id),
    ...base.map(e => ({ ...e })),
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

// Snapshot the current session's exercise order, notes, and skipped state
// into session.notes (JSON) so history can show the full picture.
async function saveSessionMeta(finished = false) {
  if (!state.activeSession) return;
  const meta = {
    v: 1,
    finished,
    exercises: state.sessionExercises.map(ex => ({
      id: ex.id,
      name: ex.name,
      section: ex.section || '',
      sets_target: ex.sets_target,
      reps_target: ex.reps_target || '',
      note: state.exerciseNotes[ex.id] || '',
    })),
    skipped: Array.from(state.skipped),
  };
  const updated = { ...state.activeSession, notes: JSON.stringify(meta) };
  state.activeSession = updated;
  await DB.put('sessions', updated);
  await DB.queueSync('sessions', 'update', updated);
  syncIfOnline();
}

async function finishSession() {
  const exercises = currentDayExercises();
  // Completion = sets you checked off / all planned sets across every exercise
  // you didn't skip (warmup/abs note-only items excluded). This matches the
  // progress bar shown during the workout — untouched exercises count against
  // you, so 100% means you actually finished everything you set out to do.
  const { done: completedSets, total: totalSets } = exerciseProgress(exercises);

  // Mark as finished so it appears in history; localStorage cleared in completeAndGoHome
  await saveSessionMeta(true);
  state.view = 'summary';
  state.summaryData = { completedSets, totalSets, exercises };
  renderView();
}

// Called from summary Done button — session already finished and saved
async function completeAndGoHome() {
  localStorage.removeItem('activeWorkoutSessionId');
  state.activeSession = null;
  state.setLogs = {};
  state.skipped = new Set();
  state.activeDay = null;
  state.sessionExercises = [];
  state.defaultExerciseIds = [];
  state.exerciseNotes = {};
  state.progressLoaded = false;
  state.sessionPRCount = 0;
  state.sessionPRExercises = new Set();
  stopRestTimer();
  await loadSessions();
  setTab('home');
}

async function endAndGoHome() {
  if (state.activeSession) {
    const hasLogs = state.sessionExercises.some(ex =>
      (state.setLogs[ex.id] || []).some(s => s.completed)
    );
    if (hasLogs) {
      // Keep session alive for resume — save meta but do NOT mark finished,
      // and do NOT remove activeWorkoutSessionId from localStorage
      await saveSessionMeta(false);
    } else {
      // Truly empty — delete entirely
      localStorage.removeItem('activeWorkoutSessionId');
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
  state.sessionPRExercises = new Set();
  stopRestTimer();
  await loadSessions();
  setTab('home');
}

async function cancelSession() {
  if (!confirm('Cancel this workout? All logged progress will be lost.')) return;
  localStorage.removeItem('activeWorkoutSessionId');
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
  state.sessionPRExercises = new Set();
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
    haptic(10);

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

// Append an extra set (set 4, 5, …) to an exercise for this session only —
// the default stays at sets_target. Prefills from last session if available.
function addSet(exerciseId) {
  const rows = state.setLogs[exerciseId];
  if (!rows) return;
  const n = rows.length;
  const prev = (state.lastLogs[exerciseId] || []).find(l => l.set_number === n + 1);
  rows.push({ setNumber: n + 1, weight_lbs: prev ? prev.weight_lbs : null, reps: prev ? prev.reps : null, completed: false, _logId: null });
  haptic(5);
  renderView();
}
// Remove the last (extra) set. Deletes its persisted log if it was completed.
async function removeLastSet(exerciseId) {
  const rows = state.setLogs[exerciseId];
  if (!rows || rows.length <= 1) return;
  const set = rows[rows.length - 1];
  if (set._logId) {
    await DB.del('set_logs', set._logId);
    const pending = await DB.getAll('pending_sync');
    for (const p of pending) { if (p.payload?.id === set._logId) await DB.del('pending_sync', p.id); }
    try { await Supabase.deleteRecord('set_logs', set._logId); } catch (_) {}
  }
  rows.pop();
  haptic(5);
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

// The working exercise list for editing context: the catalog rows for the day
// being edited, or the active session's exercises during a workout.
function routineList() {
  if (state.view === 'edit-day') {
    return state.exercises
      .filter(e => e.day === state.editDay)
      .sort((a, b) => a.sort_order - b.sort_order);
  }
  return state.sessionExercises;
}

function nextGroupName() {
  const existing = new Set(routineList().map(e => e.section));
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
  const changed = [];
  routineList().forEach(ex => {
    if (ex.superset_group === supersetId) { ex.section = newName; changed.push(ex); }
  });
  if (state.view === 'edit-day') markEditDirty();
  renderView();
}

function startRenameSection(sectionName) {
  const view = document.getElementById('main-view');
  if (!view) return;
  const sectionGroup = view.querySelector(`.section-group[data-section="${CSS.escape(sectionName)}"]`);
  if (!sectionGroup) return;
  const nameLabel = sectionGroup.querySelector('.section-name-label');
  if (!nameLabel) return;
  const currentName = nameLabel.textContent.trim();
  const renameBtn = sectionGroup.querySelector('.section-rename-btn');
  const wrap = document.createElement('div');
  wrap.className = 'ss-rename-wrap';
  wrap.innerHTML = `<input class="ss-rename-input" value="${currentName}" /><button class="ss-rename-confirm">✓</button>`;
  if (renameBtn) renameBtn.style.display = 'none';
  nameLabel.replaceWith(wrap);
  const input = wrap.querySelector('.ss-rename-input');
  input.focus();
  input.select();
  let saved = false;
  const save = () => {
    if (saved) return;
    saved = true;
    const newName = input.value.trim() || currentName;
    const changed = [];
    routineList().forEach(ex => {
      if (ex.section === sectionName) { ex.section = newName; changed.push(ex); }
    });
    if (state.view === 'edit-day') markEditDirty();
    renderView();
  };
  input.addEventListener('blur', () => setTimeout(save, 120));
  wrap.querySelector('.ss-rename-confirm').addEventListener('click', save);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
}

function ungroupSuperset(supersetId) {
  document.querySelectorAll('.ss-dropdown').forEach(el => el.remove());
  // Ungroup → drop the section heading and merge into the flat list (set
  // section=''), so the exercises become one continuous list.
  const changed = [];
  routineList().forEach(ex => {
    if (ex.superset_group === supersetId) { ex.superset_group = null; ex.section = ''; changed.push(ex); }
  });
  if (state.view === 'edit-day') markEditDirty();
  renderView();
}

function showGroupPicker(exId) {
  const list = routineList();
  const ex = list.find(e => e.id === exId);
  if (!ex) return;
  const groups = new Map();
  list.forEach(e => {
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
  const list = routineList();
  const ex = list.find(e => e.id === exId);
  if (!ex) return;
  const idx = list.indexOf(ex);
  const next = list[idx + 1];
  if (!next) { toast('No next exercise to pair with'); return; }
  const groupId = `superset-custom-${Date.now()}`;
  const groupName = nextGroupName();
  ex.superset_group = groupId;
  ex.section = groupName;
  next.superset_group = groupId;
  next.section = groupName;
  if (state.view === 'edit-day') markEditDirty();
  renderView();
}

function addExerciseToGroup(exId, supersetId) {
  const list = routineList();
  const ex = list.find(e => e.id === exId);
  const ref = list.find(e => e.superset_group === supersetId);
  if (!ex || !ref) return;
  ex.superset_group = supersetId;
  ex.section = ref.section;
  if (state.view === 'edit-day') markEditDirty();
  renderView();
}

// ── Routine editing: persistence to the exercises catalog ────────────
// Supabase `exercises` columns (note: `muscles` is NOT a column — it lives in
// the bundled EXERCISES constant only, so we must never send it in a payload).
const EXERCISE_COLUMNS = ['id','day','section','name','equipment','weight_range','sets_target','reps_target','instructions','image_key','superset_group','sort_order'];
function toExerciseRow(ex) {
  const row = {};
  for (const k of EXERCISE_COLUMNS) if (ex[k] !== undefined) row[k] = ex[k];
  return row;
}
async function persistExercise(ex) {
  await DB.put('exercises', ex);
  await DB.queueSync('exercises', 'update', toExerciseRow(ex));
  syncIfOnline();
}
function persistExercises(list) { (list || []).forEach(ex => persistExercise(ex)); }

function editDayExercises() {
  // Edit mode works on a draft (array order = display order); nothing persists
  // until "Save".
  return state.editDraft || [];
}

// Enter the edit screen with a fresh draft (clones of the day's catalog rows).
function openEditDay(day) {
  state.editDay = day;
  state.editDraft = state.exercises
    .filter(e => e.day === day)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(e => ({ ...e }));
  state.editDirty = false;
  navigateTo('edit-day', {}, 'forward');
}

function markEditDirty() { state.editDirty = true; }

// Remove from the draft (moves to Library only once saved).
function removeFromDraft(exId) {
  const d = (state.editDraft || []).find(e => e.id === exId);
  if (!d) return;
  if (!confirm(`Remove "${d.name}" from ${state.editDay}? It moves to your Library (with its history) when you save.`)) return;
  state.editDraft = state.editDraft.filter(e => e.id !== exId);
  state.editDirty = true;
  renderView();
}

// Add a Library exercise into the draft (ungrouped, at the end).
function addExerciseToDraft(exId) {
  const ex = state.exercises.find(e => e.id === exId);
  if (!ex) return;
  if ((state.editDraft || []).some(e => e.id === exId)) { toast('Already in this day'); return; }
  state.editDraft.push({ ...ex, day: state.editDay, section: '', superset_group: null });
  state.editDirty = true;
  renderView();
}

// After a drag, rebuild the draft order + section/group from the DOM (no save).
function rebuildDraftFromDOM() {
  const view = document.getElementById('main-view');
  if (!view) return;
  const next = [];
  view.querySelectorAll('#edit-sortable .section-group').forEach(group => {
    const section = group.dataset.section || '';
    const ssId = group.dataset.supersetId || null;
    group.querySelectorAll('.exercise-row[data-ex-id]').forEach(row => {
      const d = (state.editDraft || []).find(e => e.id === row.dataset.exId);
      if (!d) return;
      d.section = section; d.superset_group = ssId || null;
      next.push(d);
    });
  });
  if (next.length) state.editDraft = next;
  state.editDirty = true;
  renderView();
}

// Discard the draft (confirm only if there are unsaved changes).
function cancelEditDay() {
  if (state.editDirty && !confirm('Discard unsaved changes to this day?')) return;
  state.editDraft = null;
  state.editDirty = false;
  setTab('home');
}

// Commit the draft to the catalog — this is the ONLY place edits persist.
// Kept exercises get their new order/section/group; removed ones go to Library.
function saveEditDay() {
  const day = state.editDay;
  const draft = state.editDraft || [];
  const draftIds = new Set(draft.map(d => d.id));
  draft.forEach((d, i) => {
    const ex = state.exercises.find(e => e.id === d.id);
    if (!ex) return;
    ex.day = day;
    ex.section = d.section || '';
    ex.superset_group = d.superset_group || null;
    ex.sort_order = i + 1;
    persistExercise(ex);
  });
  state.exercises
    .filter(e => e.day === day && !draftIds.has(e.id))
    .forEach(ex => { ex.day = 'Library'; ex.superset_group = null; ex.section = ''; persistExercise(ex); });
  state.editDraft = null;
  state.editDirty = false;
  toast('Routine saved');
  setTab('home');
}

// From the active workout: persist the current exercise order + grouping as the
// default for this day. Only real catalog exercises are saved (Warmup/Abs and
// unsaved custom exercises are skipped).
function saveSessionAsDefault() {
  const day = state.activeDay;
  if (!day) return;
  if (!confirm(`Save this exercise order & grouping as your default for ${day}?`)) return;
  let order = 0;
  state.sessionExercises.forEach(se => {
    const ex = state.exercises.find(e => e.id === se.id);
    if (!ex) return; // synthetic warmup/abs/custom — not in the catalog
    order++;
    ex.sort_order = order;
    ex.section = se.section || '';
    ex.superset_group = se.superset_group || null;
    persistExercise(ex);
  });
  toast('Saved as your default');
}

// ── Edit-day view ────────────────────────────────────────────────────
function editRow(ex) {
  const thumb = IMAGE_KEYS.has(ex.image_key)
    ? `<img class="exercise-thumb-img" src="icons/exercises/${ex.image_key}.webp" alt="" loading="lazy" />`
    : (ILLUSTRATIONS[ex.image_key] || ILLUSTRATIONS['_placeholder']).replace(/viewBox="[^"]*"/, 'viewBox="0 0 120 160"');
  return `<div class="exercise-row" data-ex-id="${ex.id}">
    <div class="drag-handle">⠿</div>
    <div class="exercise-row-thumb">${thumb}</div>
    <div class="exercise-row-info">
      <div class="exercise-row-name">${esc(ex.name)}</div>
      <div class="exercise-row-meta">${ex.sets_target}×${esc(ex.reps_target || '')}${ex.equipment ? ' · ' + esc(ex.equipment) : ''}</div>
    </div>
    <div class="exercise-row-end" style="gap:6px">
      <button class="ex-group-btn" data-group-ex="${ex.id}" aria-label="Group"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg></button>
      <button class="ex-remove-btn" data-remove-ex="${ex.id}" aria-label="Remove from day"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6l-12 12M6 6l12 12"/></svg></button>
    </div>
  </div>`;
}

function renderEditDay() {
  const day = state.editDay;
  const exercises = editDayExercises();
  const groups = buildSectionGroups(exercises);

  let html = `
    <div class="page-header">
      <button class="back-btn" aria-label="Back" onclick="cancelEditDay()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div style="flex:1">
        <div class="page-title" style="font-size:18px;display:flex;align-items:center;gap:8px">
          ${esc(dayName(day) || day)}
          <button aria-label="Rename day" onclick="renameDay('${day}')" style="background:none;border:none;color:var(--text3);padding:2px;cursor:pointer;-webkit-tap-highlight-color:transparent;">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
        <div class="page-subtitle">Drag to reorder · tap Save to keep changes</div>
      </div>
    </div>
    <div id="edit-sortable">`;

  for (const { section, exercises: groupExs } of groups) {
    const supersetId = groupExs[0]?.superset_group ? groupExs[0].superset_group : null;
    const isSuperset = supersetId && groupExs.every(ex => ex.superset_group === supersetId);
    const rows = groupExs.map(editRow).join('');

    if (isSuperset) {
      html += `<div class="section-group" data-section="${esc(section)}" data-superset-id="${esc(supersetId)}">
        <div class="superset-card" data-superset-id="${esc(supersetId)}">
          <div class="superset-card-header section-draggable">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="section-drag-handle">⠿</span>
              <span class="superset-card-label">${esc(section || 'Superset')}</span>
            </div>
            <button class="ss-menu-btn" data-ss-menu="${esc(supersetId)}">⋮</button>
          </div>
          <div class="exercise-sortable-inner">${rows}</div>
        </div>
      </div>`;
    } else {
      const label = section === '' ? '' : `
        <div class="section-label section-draggable">
          <span class="section-drag-handle">⠿</span>
          <span class="section-name-label">${esc(section)}</span>
          <button class="section-rename-btn" data-rename-section="${esc(section)}" aria-label="Rename section"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        </div>`;
      html += `<div class="section-group" data-section="${esc(section)}" data-superset-id="">
        ${label}
        <div class="exercise-sortable-inner">${rows}</div>
      </div>`;
    }
  }

  html += `</div>
    <button class="add-exercise-btn" data-edit-add-day="${esc(day)}">+ Add exercise</button>`;
  if (!exercises.length) {
    html += `<div class="empty"><div class="empty-icon">🗂️</div><div class="empty-body">No exercises in this day yet. Tap “+ Add exercise” to pull from your Library.</div></div>`;
  }
  html += `<div style="margin-top:20px;">
      <button class="btn btn-primary" onclick="saveEditDay()">Save changes</button>
      <div class="btn-row mt8"><button class="btn btn-ghost" onclick="cancelEditDay()">Cancel</button></div>
    </div>`;
  return html;
}

// Bottom sheet: pick a Library exercise to add into the day being edited.
function showAddToDayPicker(day) {
  const libs = state.exercises.filter(e => e.day === 'Library').sort((a, b) => a.name.localeCompare(b.name));
  const opts = libs.map(ex => `
    <button class="group-sheet-option" data-add-lib="${ex.id}">
      <div><span class="group-sheet-label">${esc(ex.name)}</span><span class="group-sheet-meta">${esc(ex.equipment || '')}</span></div>
    </button>`).join('');
  const sheet = document.createElement('div');
  sheet.id = 'group-picker-sheet';
  sheet.innerHTML = `
    <div class="group-picker-backdrop"></div>
    <div class="group-picker-panel">
      <div class="group-picker-handle"></div>
      <div class="group-picker-title">Add to ${esc(day)}</div>
      ${opts || '<div style="padding:8px 4px;color:var(--text2);font-size:14px">Your Library is empty. Remove an exercise from a day, or create new ones in the Library tab.</div>'}
      <button class="group-picker-cancel">Cancel</button>
    </div>`;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.querySelector('.group-picker-panel').classList.add('open'));
  sheet.querySelector('.group-picker-backdrop').addEventListener('click', closeGroupPicker);
  sheet.querySelector('.group-picker-cancel').addEventListener('click', closeGroupPicker);
  sheet.querySelectorAll('[data-add-lib]').forEach(btn => {
    btn.addEventListener('click', () => { closeGroupPicker(); addExerciseToDraft(btn.dataset.addLib); });
  });
}

// ── Library browser + create exercise (Phase 2) ──────────────────────
function libRow(ex) {
  const thumb = IMAGE_KEYS.has(ex.image_key)
    ? `<img class="exercise-thumb-img" src="icons/exercises/${ex.image_key}.webp" alt="" loading="lazy" />`
    : (ILLUSTRATIONS[ex.image_key] || ILLUSTRATIONS['_placeholder']).replace(/viewBox="[^"]*"/, 'viewBox="0 0 120 160"');
  return `<div class="exercise-row" data-lib-ex="${ex.id}">
    <div class="exercise-row-thumb">${thumb}</div>
    <div class="exercise-row-info">
      <div class="exercise-row-name">${esc(ex.name)}</div>
      <div class="exercise-row-meta">${ex.sets_target}×${esc(ex.reps_target || '')}${ex.equipment ? ' · ' + esc(ex.equipment) : ''}</div>
    </div>
    <div class="exercise-row-end"><span style="color:var(--text3);font-size:18px">›</span></div>
  </div>`;
}

function renderLibrary() {
  const q = (state.librarySearch || '').toLowerCase().trim();
  const all = state.exercises.filter(e => !e._custom);
  const dayLabels = (state.routineDays || []).map(d => d.label);
  const f = state.libraryFilter || null; // null = All, a day label, or 'Other'
  const match = e => {
    if (q && !(e.name.toLowerCase().includes(q) || (e.equipment || '').toLowerCase().includes(q))) return false;
    if (!f) return true;
    if (f === 'Other') return !dayLabels.includes(e.day);
    return e.day === f;
  };
  const list = all.filter(match).sort((a, b) => a.name.localeCompare(b.name));

  const chip = (key, label) =>
    `<button class="prog-chip ${(state.libraryFilter || null) === key ? 'active' : ''}" data-lib-filter="${key == null ? '' : esc(key)}">${esc(label)}</button>`;
  const chips = [
    chip(null, 'All'),
    ...(state.routineDays || []).map(d => chip(d.label, d.name || d.label)),
    chip('Other', 'Other'),
  ].join('');

  const body = list.length
    ? list.map(libRow).join('')
    : `<div class="empty"><div class="empty-icon">🔍</div><div class="empty-body">No exercises match.</div></div>`;

  return `
    <div class="page-header">
      <button class="back-btn" aria-label="Back" onclick="setTab('home')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div style="flex:1"><div class="page-title" style="font-size:18px">Exercise Library</div></div>
    </div>
    <input id="lib-search" class="set-input" style="width:100%;box-sizing:border-box;margin-bottom:10px" placeholder="Search exercises…" value="${esc(state.librarySearch || '')}" />
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${chips}</div>
    <button class="add-exercise-btn" onclick="navigateTo('create-exercise', {}, 'forward')">+ Create new exercise</button>
    ${body}`;
}

// Action sheet: move a library/catalog exercise into a day (or back to Library).
function showMoveToDayPicker(exId) {
  const ex = state.exercises.find(e => e.id === exId);
  if (!ex) return;
  const dayOpts = (state.routineDays || [])
    .filter(d => d.label !== ex.day)
    .map(d => `<button class="group-sheet-option" data-move-day="${esc(d.label)}"><div><span class="group-sheet-label">Add to ${esc(d.label)} — ${esc(d.name || '')}</span></div></button>`)
    .join('');
  const libOpt = ex.day !== 'Library'
    ? `<button class="group-sheet-option" data-move-day="Library"><div><span class="group-sheet-label">Move to Library</span><span class="group-sheet-meta">Remove from ${esc(ex.day)} (keeps history)</span></div></button>`
    : '';
  const sheet = document.createElement('div');
  sheet.id = 'group-picker-sheet';
  sheet.innerHTML = `
    <div class="group-picker-backdrop"></div>
    <div class="group-picker-panel">
      <div class="group-picker-handle"></div>
      <div class="group-picker-title">${esc(ex.name)}</div>
      ${dayOpts}${libOpt}
      <button class="group-picker-cancel">Cancel</button>
    </div>`;
  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.querySelector('.group-picker-panel').classList.add('open'));
  sheet.querySelector('.group-picker-backdrop').addEventListener('click', closeGroupPicker);
  sheet.querySelector('.group-picker-cancel').addEventListener('click', closeGroupPicker);
  sheet.querySelectorAll('[data-move-day]').forEach(btn => {
    btn.addEventListener('click', () => { closeGroupPicker(); moveExerciseToDay(exId, btn.dataset.moveDay); });
  });
}

// Library actions persist directly (explicit, one-off — not the edit-day draft).
function moveExerciseToDay(exId, day) {
  const ex = state.exercises.find(e => e.id === exId);
  if (!ex) return;
  if (day === 'Library') {
    ex.day = 'Library'; ex.section = ''; ex.superset_group = null;
  } else {
    const maxOrder = state.exercises.filter(e => e.day === day).reduce((m, e) => Math.max(m, e.sort_order || 0), 0);
    ex.day = day; ex.section = ''; ex.superset_group = null; ex.sort_order = maxOrder + 1;
  }
  persistExercise(ex);
  toast(day === 'Library' ? 'Moved to Library' : `Added to ${day}`);
  renderView();
}

function renderCreateExercise() {
  const field = (label, id, attrs = '', ph = '') =>
    `<div style="margin-bottom:12px">
      <div class="detail-section-label">${label}</div>
      <input id="${id}" class="set-input" style="width:100%;box-sizing:border-box" placeholder="${ph}" ${attrs} />
    </div>`;
  return `
    <div class="page-header">
      <button class="back-btn" aria-label="Back" onclick="navigateTo('library', {}, 'back')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div style="flex:1"><div class="page-title" style="font-size:18px">New exercise</div></div>
    </div>
    <div class="card">
      ${field('Name', 'ne-name', '', 'e.g. Cable Crunch')}
      ${field('Equipment', 'ne-equipment', '', 'e.g. Cable Machine')}
      ${field('Sets (default 3)', 'ne-sets', 'type="number" min="1" value="3"')}
      ${field('Reps / time', 'ne-reps', '', 'e.g. 12 or 30s')}
      ${field('Image key (optional)', 'ne-image', '', 'leave blank for an illustration')}
      <label style="display:flex;align-items:center;gap:10px;font-size:14px;cursor:pointer">
        <input id="ne-assisted" type="checkbox" style="width:18px;height:18px" />
        Assisted (lower weight = better)
      </label>
    </div>
    <button class="btn btn-primary" onclick="submitNewExercise()">Create exercise</button>
    <div style="font-size:12px;color:var(--text3);margin-top:10px;text-align:center">It lands in your Library — add it to a day from there.</div>`;
}

function submitNewExercise() {
  const val = id => (document.getElementById(id)?.value || '').trim();
  const name = val('ne-name');
  if (!name) { toast('Name is required', 'error'); return; }
  const ex = {
    id: uuid(), day: 'Library', section: '', name,
    equipment: val('ne-equipment'), weight_range: '',
    sets_target: parseInt(val('ne-sets')) || 3, reps_target: val('ne-reps') || '10',
    instructions: [], image_key: val('ne-image') || null, superset_group: null, sort_order: 0,
  };
  state.exercises.push(ex);
  DB.put('exercises', ex);
  DB.queueSync('exercises', 'insert', toExerciseRow(ex));
  if (document.getElementById('ne-assisted')?.checked) setAssistedOverride(ex.id, true);
  syncIfOnline();
  toast('Created — in your Library');
  navigateTo('library', {}, 'back');
}

// ── Weekly schedule (in-app plan; no device reminders) ───────────────
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function getSchedule() {
  try { return JSON.parse(localStorage.getItem('wt_schedule') || '{}'); } catch (_) { return {}; }
}
function setScheduleDay(idx, label) {
  const s = getSchedule();
  s[idx] = label;
  try { localStorage.setItem('wt_schedule', JSON.stringify(s)); } catch (_) {}
}

function renderSchedule() {
  const s = getSchedule();
  const choices = ['Rest', ...(state.routineDays || []).map(d => d.label)];
  const rows = WEEKDAYS.map((wd, i) => {
    const cur = s[i] || 'Rest';
    const opts = choices.map(v =>
      `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${v === 'Rest' ? 'Rest' : esc(`${v} — ${dayName(v) || ''}`)}</option>`).join('');
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--border)">
      <div style="font-weight:600">${wd}</div>
      <select class="set-input" style="width:auto;min-width:150px" data-sched-day="${i}">${opts}</select>
    </div>`;
  }).join('');
  return `
    <div class="page-header">
      <button class="back-btn" aria-label="Back" onclick="setTab('home')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div style="flex:1">
        <div class="page-title" style="font-size:18px">Weekly Schedule</div>
        <div class="page-subtitle">Your plan at a glance — phone reminders aren't sent</div>
      </div>
    </div>
    <div class="card">${rows}</div>`;
}

function saveExerciseNote(exerciseId, note) {
  state.exerciseNotes[exerciseId] = note;
}

// Save an edited note from session history back to session.notes JSON.
// Works for both new-format sessions (already have meta) and legacy sessions
// (reconstructs meta from master exercise list on first edit).
async function saveHistoryNote(exerciseId, note) {
  const session = state.historySession;
  if (!session) return;

  // Parse existing meta or build it fresh for legacy sessions
  let meta = null;
  if (session.notes) {
    try { meta = JSON.parse(session.notes); } catch (_) {}
    if (!meta?.exercises) meta = null;
  }

  if (!meta) {
    // Legacy session: reconstruct full exercise list so we can store notes going forward
    const dayExercises = state.exercises
      .filter(e => e.day === session.day)
      .sort((a, b) => a.sort_order - b.sort_order);
    const loggedExIds = new Set(
      (state.historyLogs || []).filter(l => l.completed).map(l => l.exercise_id)
    );
    const knownIds = new Set(dayExercises.map(e => e.id));
    const unknownIds = [...loggedExIds].filter(id => !knownIds.has(id));

    const exList = [
      { id: `warmup-${session.id}`, name: 'Warmup', sets_target: 0, section: 'Warmup', reps_target: '', note: '' },
      ...dayExercises
        .filter(e => loggedExIds.has(e.id))
        .map(e => ({ id: e.id, name: e.name, sets_target: e.sets_target, section: e.section || '', reps_target: e.reps_target || '', note: '' })),
      ...unknownIds.map(id => ({ id, name: 'Custom Exercise', sets_target: 1, section: '', reps_target: '', note: '' })),
      { id: `abs-${session.id}`, name: 'Abs', sets_target: 0, section: 'Abs', reps_target: '', note: '' },
    ];
    meta = { v: 1, exercises: exList, skipped: [] };
  }

  // Update the note for this exercise (add entry if somehow missing)
  const entry = meta.exercises.find(e => e.id === exerciseId);
  if (entry) {
    entry.note = note;
  } else {
    meta.exercises.push({ id: exerciseId, name: exerciseId, sets_target: 1, section: '', reps_target: '', note });
  }

  const updated = { ...session, notes: JSON.stringify(meta) };
  state.historySession = updated;
  await DB.put('sessions', updated);
  await DB.queueSync('sessions', 'update', updated);
  syncIfOnline();
}

function isExerciseEmpty(exId) {
  const logs = state.setLogs[exId] || [];
  return logs.length > 0 && !logs.some(s => s.completed || s.weight_lbs || s.reps);
}

function exerciseProgress(exercises) {
  let done = 0, total = 0;
  for (const ex of exercises) {
    // Skip explicitly-skipped exercises and note-only items (Warmup, Abs)
    if (state.skipped.has(ex.id) || ex.sets_target === 0) continue;
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
function renderView(direction = 'none') {
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
    case 'edit-day':          el.innerHTML = renderEditDay(); break;
    case 'library':           el.innerHTML = renderLibrary(); break;
    case 'create-exercise':   el.innerHTML = renderCreateExercise(); break;
    case 'schedule':          el.innerHTML = renderSchedule(); break;
    default:                  el.innerHTML = renderHome();
  }
  el.scrollTop = 0;
  bindViewEvents();
  // Navigation transition — subtle slide+fade (single-container safe, no overflow flash)
  el.classList.remove('view-anim-forward', 'view-anim-back', 'view-anim-tab');
  if (direction === 'forward' || direction === 'back' || direction === 'tab') {
    void el.offsetWidth; // force reflow so re-adding the class restarts the animation
    el.classList.add(`view-anim-${direction}`);
  }
}

// ── Home view ────────────────────────────────────────────────────
function renderHome() {
  const days = (state.routineDays || []).map(d => ({ day: d.label, name: d.name, muscles: d.muscles || '', color: d.color }));
  const dayNameMap = Object.fromEntries(days.map(d => [d.day, d.name]));

  const last = state.sessions.find(isSessionFinished);
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

  // Today's plan from the weekly schedule
  const schedToday = getSchedule()[new Date().getDay()];
  let todayWidget = '';
  if (schedToday && schedToday !== 'Rest' && dayMeta(schedToday)) {
    todayWidget = `<div class="card mb16" style="border-color:var(--pink)">
      <div style="font-size:12px;color:var(--pink);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Today's plan</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:12px;">${schedToday} — ${esc(dayName(schedToday))}</div>
      <button class="day-card-start" data-day-start="${schedToday}" style="width:100%">Start Workout</button>
    </div>`;
  } else if (schedToday === 'Rest') {
    todayWidget = `<div class="card mb16"><div style="font-size:13px;color:var(--text2)">Today's plan: Rest day 🌙</div></div>`;
  }

  // Show resume card if actively in a workout OR if a saved-but-exited session exists
  const savedId = localStorage.getItem('activeWorkoutSessionId');
  const resumableSession = state.activeSession
    || (!state.activeSession && savedId ? state.sessions.find(s => s.id === savedId) : null);
  const inProgress = resumableSession ? `
    <div class="card mb16" style="border-color: var(--pink);">
      <div style="font-size:12px;color:var(--pink);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Workout in progress</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:12px;">${resumableSession.day} — ${dayNameMap[resumableSession.day] || ''}</div>
      <button class="btn btn-primary" onclick="navigateTo('workout')">Resume</button>
    </div>` : '';

  const cards = days.map(({ day, name, muscles }) => {
    const count = state.exercises.filter(e => e.day === day).length;
    const isResumable = resumableSession?.day === day;
    return `<div class="day-card" data-day="${day}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <span class="day-drag-handle" style="cursor:grab;color:var(--text3);font-size:14px;-webkit-tap-highlight-color:transparent;">⠿</span>
          <div class="day-card-name" style="margin:0">${esc(name || day)}</div>
        </div>
        <button class="day-card-edit" data-edit-day="${day}" aria-label="Edit ${esc(name || day)}" style="background:none;border:none;color:var(--text3);padding:4px;cursor:pointer;-webkit-tap-highlight-color:transparent;flex-shrink:0;">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>
      <div class="day-card-meta">${esc(muscles)} · ${count} exercises</div>
      <button class="day-card-start" data-day-start="${day}">${isResumable ? 'Resume Workout' : 'Start Workout'}</button>
    </div>`;
  }).join('');

  const userEmail = state.user?.email || '';
  return `
    <div class="page-header">
      <div style="flex:1">
        <div class="page-title">Workout Tracker</div>
        <div class="page-subtitle">${days.map(d => d.name).filter(Boolean).join(' · ') || 'Your routine'}</div>
      </div>
      <button class="logout-btn" onclick="handleLogout()" title="Sign out">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
      </button>
    </div>
    ${inProgress}
    ${todayWidget}
    ${lastWidget}
    <div class="day-cards">${cards}
      <div class="day-card" data-newday="1" style="display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px dashed var(--border);color:var(--text3);cursor:pointer;min-height:118px;-webkit-tap-highlight-color:transparent;" onclick="createNewDay()">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <div style="font-size:13px;font-weight:600;margin-top:6px;">New day</div>
      </div>
    </div>
    <button class="add-exercise-btn" style="margin-top:14px" onclick="navigateTo('library', {}, 'forward')">⊞ Exercise Library</button>
    <button class="add-exercise-btn" style="margin-top:8px" onclick="navigateTo('schedule', {}, 'forward')">📅 Weekly Schedule</button>`;
}

// ── Workout view ─────────────────────────────────────────────────
function renderWorkout() {
  if (!state.activeSession) { return ''; }
  const exercises = currentDayExercises();
  const prog = exerciseProgress(exercises);
  const dayNames = Object.fromEntries((state.routineDays || []).map(d => [d.label, d.name]));
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
              <span style="color:var(--text3);font-size:16px;line-height:1">›</span>
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
          ? `<img class="superset-card-thumb-img" src="icons/exercises/${ex.image_key}.webp" alt="" loading="lazy" />`
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
      // ── Normal section (empty section name = heading-less flat list) ──
      const sectionLabel = section === '' ? '' : `
        <div class="section-label section-draggable">
          <span class="section-drag-handle">⠿</span>
          <span class="section-name-label">${displaySection}</span>
          ${state.activeSession ? `<button class="section-rename-btn" data-rename-section="${section}" aria-label="Rename section"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : ''}
        </div>`;
      html += `<div class="section-group" data-section="${section}">
        ${sectionLabel}
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
            ? `<img class="exercise-thumb-img" src="icons/exercises/${ex.image_key}.webp" alt="" loading="lazy" />`
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
    <button class="btn btn-ghost" style="margin-top:8px" onclick="saveSessionAsDefault()">⤓ Save current order as my default</button>
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

  // Muscle chips — resolve from the EXERCISES constant by image_key when the
  // runtime row lacks muscles (Supabase rows predate the muscles field).
  const _m = exerciseMuscles(ex);
  const muscleChips = _m
    ? [
        ...(_m.primary || []).map(m => `<span class="tag tag-muscle-primary">${m}</span>`),
        ...(_m.secondary || []).map(m => `<span class="tag tag-muscle-secondary">${m}</span>`),
      ].join('')
    : '';

  let infoCard = '';
  if (!isNoteOnly && (instructions || equipChips || ex.weight_range || muscleChips)) {
    infoCard = `<div class="card">
      ${(equipChips || ex.weight_range) ? `<div class="detail-section-label">Equipment</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">${equipChips}${ex.weight_range ? `<span class="tag tag-muted">~${startingWeight(ex.weight_range)}</span>` : ''}</div>` : ''}
      ${muscleChips ? `<div class="detail-section-label">Muscles</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">${muscleChips}</div>` : ''}
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

  // Bar weight reference (only for bar-based exercises) — saved for next time.
  let barCard = '';
  if (usesBar(ex) && !isNoteOnly) {
    const bw = getBarWeight(ex);
    barCard = `<div class="card">
      <div class="detail-section-label">Bar weight</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <input class="set-input" type="number" inputmode="decimal" step="any" min="0" style="max-width:110px"
          value="${esc(bw)}" placeholder="e.g. 45" onchange="saveBarWeight('${ex.id}', this.value)" />
        <span style="font-size:12px;color:var(--text2)">lbs — saved for reference next time</span>
      </div>
    </div>`;
  }

  let assistedCard = '';
  if (!isNoteOnly) {
    const on = isAssisted(ex);
    assistedCard = `<div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:10px">
      <div>
        <div style="font-weight:700;font-size:14px">Assisted exercise</div>
        <div style="font-size:12px;color:var(--text2)">Lower weight counts as a new record</div>
      </div>
      <button class="btn ${on ? 'btn-primary' : 'btn-secondary'}" style="width:auto;padding:8px 16px;white-space:nowrap" onclick="toggleAssisted('${ex.id}')">${on ? 'On' : 'Off'}</button>
    </div>`;
  }

  let setRows = '';
  if (inActiveSession && !isSkipped && !isNoteOnly) {
    const repsCol = isTimeBased(ex.id) ? 'Secs' : 'Reps';
    setRows = `
      <div class="sets-header">
        <div>Set</div>
        <div style="text-align:center">Weight <span style="font-size:10px;opacity:.6">(lbs)</span></div>
        <div style="text-align:center">${repsCol}</div>
        <div></div>
      </div>
      ${logs.map((s, i) => `<div class="set-row" data-ex-id="${ex.id}" data-set-idx="${i}">${buildSetRow(ex.id, i, s)}</div>`).join('')}
      <div class="btn-row mt8">
        <button class="btn btn-secondary" onclick="addSet('${ex.id}')">+ Add set</button>
        ${logs.length > ex.sets_target ? `<button class="btn btn-secondary" onclick="removeLastSet('${ex.id}')">− Remove set</button>` : ''}
      </div>
      <div class="btn-row mt8">
        <button class="btn btn-secondary" onclick="startRestTimer(${state.restTimer.duration})">Start Rest Timer</button>
        <button class="btn btn-danger" onclick="skipExercise('${ex.id}')">${isSkipped ? 'Unskip' : 'Skip'}</button>
      </div>`;
  }

  const supersetLabel = inSuperset
    ? (state.sessionExercises.find(e => e.superset_group === ex.superset_group)?.section || 'Superset')
    : null;
  const supersetBreadcrumb = inSuperset && supersetLabel
    ? `<div style="font-size:11px;color:var(--pink);margin-top:2px;cursor:pointer;-webkit-tap-highlight-color:transparent" onclick="navigateTo('superset-detail',{supersetId:'${ex.superset_group}'})">↑ ${supersetLabel}</div>`
    : '';

  const backDest = inSuperset
    ? `navigateTo('superset-detail',{supersetId:'${ex.superset_group}'})`
    : `navigateTo('workout')`;

  return `
    <div class="page-header">
      <button class="back-btn" aria-label="Back" onclick="${backDest}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div style="flex:1">
        ${nameEl}
        ${supersetBreadcrumb}
      </div>
    </div>
    ${mediaEl}
    ${infoCard}
    ${barCard}
    ${assistedCard}
    ${lastSessionCard}
    ${notesCard}
    ${setRows}`;
}

function buildSetRow(exerciseId, i, s) {
  const wVal = s.weight_lbs ?? '';
  const rVal = s.reps ?? '';
  const eid = exerciseId;
  const timeBased = isTimeBased(exerciseId);
  const rPlaceholder = timeBased ? 'secs' : 'reps';
  const rStep = timeBased ? 5 : 1;
  return `
    <div class="set-num">${i + 1}</div>
    <div class="set-input-wrap ${s.completed?'completed':''}">
      <button class="adj-btn" data-ex-id="${eid}" data-set-idx="${i}" data-field="w" data-dir="minus" data-step="5">−</button>
      <input class="set-input" type="number" inputmode="decimal" placeholder="lbs" step="any" min="0"
        value="${wVal}" data-ex-id="${eid}" data-set-idx="${i}" data-field="w" />
      <button class="adj-btn" data-ex-id="${eid}" data-set-idx="${i}" data-field="w" data-dir="plus" data-step="5">+</button>
    </div>
    <div class="set-input-wrap ${s.completed?'completed':''}">
      <button class="adj-btn" data-ex-id="${eid}" data-set-idx="${i}" data-field="r" data-dir="minus" data-step="${rStep}">−</button>
      <input class="set-input" type="number" inputmode="numeric" placeholder="${rPlaceholder}"
        value="${rVal}" data-ex-id="${eid}" data-set-idx="${i}" data-field="r" />
      <button class="adj-btn" data-ex-id="${eid}" data-set-idx="${i}" data-field="r" data-dir="plus" data-step="${rStep}">+</button>
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
      ? `<img class="ss-ex-thumb-img" src="icons/exercises/${ex.image_key}.webp" alt="" loading="lazy" />`
      : (ILLUSTRATIONS[ex.image_key] || ILLUSTRATIONS['_placeholder']).replace(/viewBox="[^"]*"/, 'viewBox="0 0 120 160"');

    // Full last-session card (mirrors exercise-detail)
    let lastSessionCard = '';
    if (state.activeSession) {
      const prevSets = (state.lastLogs[ex.id] || []).filter(s => s.completed).sort((a, b) => a.set_number - b.set_number);
      if (prevSets.length > 0) {
        const prData = state.prCache?.[ex.id];
        const lastDate = state.lastCache?.[ex.id]?.date;
        const setRows = prevSets.map(s =>
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
          <div class="last-session-card" style="margin:0 0 12px">
            <div class="last-session-header">
              <div class="last-session-title">Last session</div>
              ${lastDate ? `<div class="last-session-date">${fmtDate(lastDate)}</div>` : ''}
            </div>
            <div class="last-session-sets">${setRows}</div>
            ${prRow}
          </div>`;
      }
    }

    const repsCol = isTimeBased(ex.id) ? 'Secs' : 'Reps';
    const setTable = !isSkipped ? `
      <div class="sets-header">
        <div>Set</div>
        <div style="text-align:center">Weight <span style="font-size:10px;opacity:.6">(lbs)</span></div>
        <div style="text-align:center">${repsCol}</div>
        <div></div>
      </div>
      ${logs.map((s, i) => `<div class="set-row" data-ex-id="${ex.id}" data-set-idx="${i}">${buildSetRow(ex.id, i, s)}</div>`).join('')}` : `
      <div style="text-align:center;padding:12px 0;color:var(--text3);font-size:14px">Skipped</div>`;

    const skipBtn = `<button class="ss-skip-btn" onclick="skipExercise('${ex.id}')">${isSkipped ? 'Unskip' : 'Skip'}</button>`;

    const divider = idx < exercises.length - 1 ? `<div class="ss-divider"></div>` : '';

    return `
      <div class="ss-ex-block">
        <div class="ss-ex-header">
          <div class="ss-ex-thumb-wrap" data-ss-drill-ex="${ex.id}" style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer;-webkit-tap-highlight-color:transparent">
            <div class="ss-ex-thumb">${thumb}</div>
            <div class="ss-ex-info">
              <div class="ss-ex-name">${ex.name}</div>
              <div class="ss-ex-meta">${ex.sets_target}×${ex.reps_target}${ex.weight_range ? ' · ~' + startingWeight(ex.weight_range) : ''}</div>
              <div class="ss-ex-drill-hint">Details ›</div>
            </div>
          </div>
          ${skipBtn}
        </div>
        ${lastSessionCard}
        <div class="ss-ex-sets">
          ${setTable}
        </div>
      </div>${divider}`;
  }).join('');

  return `
    <div class="page-header">
      <button class="back-btn" aria-label="Back" onclick="navigateTo('workout', {}, 'back')">
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
  const dayNames = Object.fromEntries((state.routineDays || []).map(d => [d.label, d.name]));

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
      <button class="btn btn-primary" onclick="completeAndGoHome()">Done</button>
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
  await loadProgressData();
  toast('Workout deleted');
  setTab('history');
}

function renderSessionDetail() {
  const session = state.historySession;
  if (!session) return renderHistory();

  const dayNames = Object.fromEntries((state.routineDays || []).map(d => [d.label, d.name]));
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

  // Parse session meta (saved since the new version; older sessions won't have it)
  let sessionMeta = null;
  if (session.notes) {
    try { sessionMeta = JSON.parse(session.notes); } catch (_) {}
    // Guard: must be the structured format, not a plain-text note
    if (!sessionMeta?.exercises) sessionMeta = null;
  }

  // Deduplicate and group completed set-logs by exercise
  const rawCompleted = state.historyLogs.filter(l => l.completed);
  const dedupSeen = new Set();
  const completedLogs = rawCompleted
    .sort((a, b) => (b.logged_at || '').localeCompare(a.logged_at || ''))
    .filter(l => {
      const k = `${l.exercise_id}:${l.set_number}`;
      if (dedupSeen.has(k)) return false;
      dedupSeen.add(k);
      return true;
    });
  const logsByEx = {};
  for (const log of completedLogs) {
    if (!logsByEx[log.exercise_id]) logsByEx[log.exercise_id] = [];
    logsByEx[log.exercise_id].push(log);
  }

  if (!completedLogs.length && !sessionMeta) {
    return `${header}<div class="empty"><div class="empty-icon">📋</div><div class="empty-body">No sets were logged for this session.</div></div>`;
  }

  const totalSets = completedLogs.length;
  const totalVolume = completedLogs.reduce((sum, l) => sum + (l.weight_lbs || 0) * (l.reps || 0), 0);
  const loggedExCount = Object.keys(logsByEx).length;

  const statBar = `
    <div class="sdet-stats">
      <div class="sdet-stat"><div class="sdet-stat-val">${totalSets}</div><div class="sdet-stat-label">Sets</div></div>
      <div class="sdet-stat"><div class="sdet-stat-val">${loggedExCount}</div><div class="sdet-stat-label">Exercises</div></div>
      ${totalVolume ? `<div class="sdet-stat"><div class="sdet-stat-val">${(totalVolume/1000).toFixed(1)}k</div><div class="sdet-stat-label">lbs volume</div></div>` : ''}
    </div>`;

  // Helper: render a set-log card for one exercise
  function renderSetCard(exId, name, sets, exNote) {
    const prData = state.prCache?.[exId];
    const isThePRSession = !!(prData?.date && session.date === prData.date);
    let prSetIdx = -1;
    if (isThePRSession && prData?.weight_lbs != null) {
      let bestW = -1, bestR = -1;
      sets.forEach((s, idx) => {
        const w = s.weight_lbs ?? 0; const r = s.reps ?? 0;
        if (w > bestW || (w === bestW && r > bestR)) { bestW = w; bestR = r; prSetIdx = idx; }
      });
      if ((sets[prSetIdx]?.weight_lbs ?? 0) !== prData.weight_lbs) prSetIdx = -1;
    }
    const rows = sets.map((s, idx) => `
      <div class="sdet-set-row">
        <span class="sdet-set-num">${s.set_number}</span>
        <span class="sdet-set-weight">${s.weight_lbs != null ? s.weight_lbs + ' lbs' : '—'}</span>
        <span class="sdet-set-reps">${s.reps != null ? s.reps + ' reps' : '—'}</span>
        <span>${idx === prSetIdx ? '<span class="pr-badge">🏆 PR</span>' : ''}</span>
      </div>`).join('');
    return `
      <div class="card">
        <div class="sdet-ex-name">${name}</div>
        <div class="sdet-set-header"><span>Set</span><span>Weight</span><span>Reps</span><span></span></div>
        ${rows}
        <textarea class="sdet-note-edit" data-edit-ex-id="${exId}" placeholder="Add notes…" rows="2">${exNote || ''}</textarea>
      </div>`;
  }

  let exerciseCards = '';

  // Helper: render a note-only exercise card (Warmup, Abs, etc.) with editable note
  function renderNoteCard(exId, name, note) {
    return `
      <div class="card">
        <div class="sdet-ex-name" style="color:var(--text2)">${name}</div>
        <textarea class="sdet-note-edit" data-edit-ex-id="${exId}" placeholder="Add notes…" rows="2">${note || ''}</textarea>
      </div>`;
  }

  if (sessionMeta) {
    // ── New format: render full workout in saved session order ────────
    for (const exMeta of sessionMeta.exercises) {
      const { id, name, sets_target, note } = exMeta;
      const sets = (logsByEx[id] || []).sort((a, b) => a.set_number - b.set_number);
      const isNoteOnly = sets_target === 0;

      if (isNoteOnly) {
        // Warmup, Abs, or any note-only exercise
        exerciseCards += renderNoteCard(id, name, note);
      } else if (sets.length) {
        // Regular exercise with logged sets
        const resolvedName = state.exercises.find(e => e.id === id)?.name || name;
        exerciseCards += renderSetCard(id, resolvedName, sets, note);
      } else if (note) {
        // No sets logged but has a note — still show editable card
        exerciseCards += renderNoteCard(id, name, note);
      }
      // Silently omit exercises with no sets and no note
    }
  } else {
    // ── Legacy format: reconstruct structure from master exercise list ─
    // Notes weren't saved for old sessions, but we can at least show
    // Warmup, the exercises in day-order, and Abs.
    const dayExercises = state.exercises
      .filter(e => e.day === session.day)
      .sort((a, b) => a.sort_order - b.sort_order);

    const loggedIds = new Set(Object.keys(logsByEx));

    // Warmup (editable note — empty until user adds one)
    exerciseCards += renderNoteCard(`warmup-${session.id}`, 'Warmup', '');

    // Day exercises that have set logs, in their natural sort order
    for (const ex of dayExercises) {
      if (!loggedIds.has(ex.id)) continue;
      const sets = logsByEx[ex.id].sort((a, b) => a.set_number - b.set_number);
      exerciseCards += renderSetCard(ex.id, ex.name, sets, '');
    }

    // Any custom / unrecognised exercises (IDs not in master list)
    const unknownIds = [...loggedIds].filter(id => !dayExercises.find(e => e.id === id));
    for (const id of unknownIds) {
      const sets = logsByEx[id].sort((a, b) => a.set_number - b.set_number);
      exerciseCards += renderSetCard(id, 'Custom Exercise', sets, '');
    }

    // Abs (editable note — empty until user adds one)
    exerciseCards += renderNoteCard(`abs-${session.id}`, 'Abs', '');
  }

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
    ...(state.routineDays || []).map(d => ({ key: d.label, label: d.name || d.label })),
  ];
  const chips = dayDefs.map(d =>
    `<button class="prog-chip ${state.progressDay === d.key ? 'active' : ''}" data-prog-day="${d.key || ''}">${d.label}</button>`
  ).join('');

  let exercises = state.exercises.filter(e => !e._custom && e.sets_target > 0);
  if (state.progressDay) exercises = exercises.filter(e => e.day === state.progressDay);
  exercises.sort((a, b) => a.sort_order - b.sort_order);

  const dayNames = Object.fromEntries((state.routineDays || []).map(d => [d.label, d.name]));
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
        ? `<img class="prog-thumb-img" src="icons/exercises/${ex.image_key}.webp" alt="" loading="lazy">`
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

  const coords = history.map((h, i) => [toX(i), toY(h.bestSet.weight_lbs)]);
  const bottomY = topPad + chartH;
  // Smooth cubic path through points (midpoint control handles, no library)
  const smoothPath = (c) => {
    if (c.length === 1) return `M${c[0][0].toFixed(1)},${c[0][1].toFixed(1)}`;
    let d = `M${c[0][0].toFixed(1)},${c[0][1].toFixed(1)}`;
    for (let i = 1; i < c.length; i++) {
      const [x0, y0] = c[i - 1], [x1, y1] = c[i];
      const cx = ((x0 + x1) / 2).toFixed(1);
      d += ` C${cx},${y0.toFixed(1)} ${cx},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    }
    return d;
  };
  const linePath = smoothPath(coords);
  const areaPath = `${linePath} L${coords[coords.length - 1][0].toFixed(1)},${bottomY.toFixed(1)} L${coords[0][0].toFixed(1)},${bottomY.toFixed(1)} Z`;
  // Least-squares trend line across sessions (screen-space; affine of weight-space)
  let trendLine = '';
  if (coords.length >= 3) {
    const n = coords.length;
    const sx = coords.reduce((a, [x]) => a + x, 0);
    const sy = coords.reduce((a, [, y]) => a + y, 0);
    const sxy = coords.reduce((a, [x, y]) => a + x * y, 0);
    const sxx = coords.reduce((a, [x]) => a + x * x, 0);
    const denom = (n * sxx - sx * sx) || 1;
    const slope = (n * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / n;
    const tx0 = coords[0][0], tx1 = coords[n - 1][0];
    trendLine = `<line x1="${tx0.toFixed(1)}" y1="${(slope * tx0 + intercept).toFixed(1)}" x2="${tx1.toFixed(1)}" y2="${(slope * tx1 + intercept).toFixed(1)}" stroke="#606060" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>`;
  }

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
        ${history.length > 1 ? `<path d="${areaPath}" fill="url(#prog-grad)" opacity="0.12" stroke="none"/>` : ''}
        ${trendLine}
        ${history.length > 1 ? `<path d="${linePath}" fill="none" stroke="#E91E8C" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" opacity="0.7"/>` : ''}
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

  // Pull the note this exercise had in a given past session (stored in
  // session.notes JSON) so you can see old form cues while training.
  const noteFor = (sessionId) => {
    const sess = state.sessions.find(s => s.id === sessionId);
    if (!sess?.notes) return '';
    try {
      const meta = JSON.parse(sess.notes);
      return (meta.exercises || []).find(e => e.id === exId)?.note || '';
    } catch (_) { return ''; }
  };

  const histRows = history.map(h => {
    const isPR = pr && h.date === pr.date;
    const note = noteFor(h.sessionId);
    return `
      <div class="prog-hist-row">
        <div class="prog-hist-date">${fmtDate(h.date)}</div>
        <div class="prog-hist-info">
          <div class="prog-hist-best">${h.bestSet.weight_lbs} lbs × ${h.bestSet.reps}</div>
          <div class="prog-hist-sub">${h.sets.length} set${h.sets.length !== 1 ? 's' : ''} total</div>
        </div>
        ${isPR ? `<div class="pr-badge">🏆 PR</div>` : ''}
      </div>
      ${note ? `<div style="font-size:13px;color:var(--text2);background:var(--bg2);border-radius:8px;padding:8px 10px;margin:-2px 0 10px;line-height:1.45;">📝 ${esc(note)}</div>` : ''}`;
  }).join('');

  const mediaHtml = ex.image_key
    ? `<div class="exercise-media-wrap" style="margin-bottom:16px"><img class="exercise-media-img" src="icons/exercises/${ex.image_key}.webp" alt="" loading="lazy"></div>`
    : '';

  const _pm = exerciseMuscles(ex);
  const muscleChipsHtml = _pm
    ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">
        ${(_pm.primary || []).map(m => `<span class="tag tag-muscle-primary">${m}</span>`).join('')}
        ${(_pm.secondary || []).map(m => `<span class="tag tag-muscle-secondary">${m}</span>`).join('')}
       </div>`
    : '';

  return `
    <div class="page-header">
      <button class="back-btn" aria-label="Back" onclick="navigateTo('progress', {}, 'back')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
      </button>
      <div class="page-title" style="font-size:18px">${ex.name}</div>
    </div>
    ${mediaHtml}
    ${muscleChipsHtml}
    ${prBar}
    ${chartHtml}
    <div class="section-label" style="margin-top:16px">Session history</div>
    ${histRows || `<div class="empty"><div class="empty-icon">📋</div><div class="empty-body">No sessions yet.</div></div>`}
    ${history.length ? `<button class="btn btn-danger" style="margin-top:20px" onclick="deleteExerciseHistory('${exId}')">Reset history &amp; PRs</button>` : ''}`;
}

// Returns true if a session should appear in history.
// Sessions saved for resume (finished: false) are excluded.
// Old sessions with no finished field show by default (backward compat).
function isSessionFinished(s) {
  if (!s.notes) return true;
  try {
    const meta = JSON.parse(s.notes);
    return meta.finished !== false;
  } catch (_) { return true; }
}

// ── History view ──────────────────────────────────────────────────
function renderHistory() {
  const finished = state.sessions.filter(isSessionFinished);
  if (!finished.length) {
    return `
      <div class="page-header"><div class="page-title">History</div></div>
      <div class="empty">
        <div class="empty-icon">📋</div>
        <div class="empty-title">No workouts yet</div>
        <div class="empty-body">Complete your first workout to see it here.</div>
      </div>`;
  }

  const dayNames = Object.fromEntries((state.routineDays || []).map(d => [d.label, d.name]));
  const cards = finished.map(s => `
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
      if (e.target.closest('.section-rename-btn')) return;
      // Superset card header → combined superset view
      const ssHeader = e.target.closest('.superset-card-header');
      if (ssHeader) {
        const card = ssHeader.closest('.superset-card[data-superset-id]');
        if (card) navigateTo('superset-detail', { supersetId: card.dataset.supersetId });
        return;
      }
      // Any exercise row (superset or standalone) → individual exercise detail
      const row = e.target.closest('.exercise-row[data-ex-id]');
      if (!row) return;
      const exId = row.dataset.exId;
      const ex = state.sessionExercises.find(ex => ex.id === exId)
             || state.exercises.find(ex => ex.id === exId);
      if (!ex) return;
      navigateTo('exercise-detail', { exercise: ex });
    });
  }

  // Superset detail: drill into individual exercise
  view.querySelectorAll('[data-ss-drill-ex]').forEach(el => {
    el.addEventListener('click', () => {
      const exId = el.dataset.ssDrillEx;
      const ex = state.sessionExercises.find(e => e.id === exId);
      if (ex) navigateTo('exercise-detail', { exercise: ex });
    });
  });

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
      const step = parseInt(btn.dataset.step) || (field === 'w' ? 5 : 1);
      const input = view.querySelector(`.set-input[data-ex-id="${CSS.escape(exId)}"][data-set-idx="${idx}"][data-field="${field}"]`);
      if (!input) return;
      let val = parseFloat(input.value) || 0;
      val = dir === 'plus' ? val + step : Math.max(0, val - step);
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

  // Active-session notes textarea
  view.querySelectorAll('.notes-textarea').forEach(ta => {
    ta.addEventListener('input', () => saveExerciseNote(ta.dataset.exId, ta.value));
  });

  // History session notes — editable inline, saves on blur
  view.querySelectorAll('.sdet-note-edit').forEach(ta => {
    // Auto-size to fit content on initial render
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    });
    ta.addEventListener('blur', () => saveHistoryNote(ta.dataset.editExId, ta.value.trim()));
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

  // Section rename pencil button
  view.querySelectorAll('.section-rename-btn[data-rename-section]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      startRenameSection(btn.dataset.renameSection);
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

  // ── Edit-day screen: entry point, remove, add, drag-to-persist ──
  view.querySelectorAll('[data-edit-day]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openEditDay(btn.dataset.editDay);
    });
  });
  view.querySelectorAll('.ex-remove-btn[data-remove-ex]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); removeFromDraft(btn.dataset.removeEx); });
  });
  view.querySelectorAll('[data-edit-add-day]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); showAddToDayPicker(btn.dataset.editAddDay); });
  });
  // ── Home: drag-reorder day cards ──
  const dayCardsEl = view.querySelector('.day-cards');
  if (dayCardsEl && typeof Sortable !== 'undefined') {
    Sortable.create(dayCardsEl, {
      handle: '.day-drag-handle', animation: 150, delay: 120, delayOnTouchOnly: true,
      draggable: '.day-card', filter: '[data-newday]',
      onEnd() { reorderDaysFromDOM(); },
    });
  }

  // ── Library browser ──
  const libSearch = view.querySelector('#lib-search');
  if (libSearch) {
    libSearch.addEventListener('input', e => {
      state.librarySearch = e.target.value;
      renderView();
      const s = document.getElementById('lib-search');
      if (s) { s.focus(); const v = s.value; s.setSelectionRange(v.length, v.length); }
    });
  }
  view.querySelectorAll('[data-lib-filter]').forEach(btn => {
    btn.addEventListener('click', () => { state.libraryFilter = btn.dataset.libFilter || null; renderView(); });
  });
  view.querySelectorAll('select[data-sched-day]').forEach(sel => {
    sel.addEventListener('change', () => setScheduleDay(parseInt(sel.dataset.schedDay), sel.value));
  });
  view.querySelectorAll('[data-lib-ex]').forEach(row => {
    row.addEventListener('click', () => showMoveToDayPicker(row.dataset.libEx));
  });

  const editSortEl = view.querySelector('#edit-sortable');
  if (editSortEl && typeof Sortable !== 'undefined') {
    Sortable.create(editSortEl, {
      handle: '.section-drag-handle', animation: 150, delay: 120, delayOnTouchOnly: true,
      draggable: '.section-group', onEnd() { rebuildDraftFromDOM(); },
    });
    editSortEl.querySelectorAll('.exercise-sortable-inner').forEach(innerEl => {
      Sortable.create(innerEl, {
        group: 'edit-ex', handle: '.drag-handle', animation: 150, delay: 120, delayOnTouchOnly: true,
        onEnd() { rebuildDraftFromDOM(); },
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
      const step = parseInt(btn.dataset.step) || (field === 'w' ? 5 : 1);
      const input = rowEl.querySelector(`.set-input[data-ex-id="${esc}"][data-set-idx="${i}"][data-field="${field}"]`);
      if (!input) return;
      let val = parseFloat(input.value) || 0;
      val = dir === 'plus' ? val + step : Math.max(0, val - step);
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
  state.sessionPRExercises = new Set();
  showLoginScreen();
}

async function finishAuth(session) {
  state.user = session.user;
  document.getElementById('tab-bar').style.display = '';
  document.getElementById('main-view').innerHTML = `<div class="loading"><div class="spinner"></div><div>Loading…</div></div>`;
  await loadExercises(); // Must run before syncIfOnline so exercises exist in Supabase for local-* remap
  await loadRoutineDays();
  await syncIfOnline();
  await loadSessions();
  await loadProgressData();
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => { haptic(5); setTab(btn.dataset.tab); });
  });
  window.addEventListener('online', () => { updateSyncDot(); syncIfOnline(); });
  window.addEventListener('offline', () => updateSyncDot());
  renderView();
  renderRestTimer();
}

// ── Resume workout after app exit ────────────────────────────────
async function tryResumeSession() {
  const savedId = localStorage.getItem('activeWorkoutSessionId');
  if (!savedId) return;

  const session = state.sessions.find(s => s.id === savedId);
  if (!session) {
    localStorage.removeItem('activeWorkoutSessionId');
    return;
  }

  // Reconstruct session exercises from saved notes
  let sessionExercises = [];
  const meta = (() => { try { return JSON.parse(session.notes || ''); } catch (_) { return null; } })();

  if (meta?.v === 1 && Array.isArray(meta.exercises)) {
    sessionExercises = meta.exercises.map(saved => {
      const base = state.exercises.find(e => e.id === saved.id);
      return base
        ? { ...base, section: saved.section || base.section, _note: saved.note }
        : {
            id: saved.id, name: saved.name, section: saved.section,
            sets_target: saved.sets_target, reps_target: saved.reps_target,
            weight_range: '', equipment: '', instructions: [],
            image_key: null, superset_group: null, sort_order: 0, _custom: true,
          };
    });
  } else {
    // Fallback: rebuild default exercise list for the day
    sessionExercises = [
      makeWarmup(session.day, session.id),
      ...state.exercises.filter(e => e.day === session.day).sort((a, b) => a.sort_order - b.sort_order).map(e => ({ ...e })),
      makeAbs(session.day, session.id),
    ];
  }

  // Restore set logs from IndexedDB
  const logs = await DB.getAll('set_logs', 'session_id', session.id);
  const setLogs = {};
  for (const ex of sessionExercises) {
    if (!ex.sets_target) { setLogs[ex.id] = []; continue; }
    const exLogs = logs.filter(l => l.exercise_id === ex.id);
    const rows = [];
    for (let i = 0; i < ex.sets_target; i++) {
      const saved = exLogs.find(l => l.set_number === i + 1);
      rows.push({
        setNumber: i + 1,
        weight_lbs: saved ? saved.weight_lbs : null,
        reps: saved ? saved.reps : null,
        completed: saved ? saved.completed : false,
        is_pr: saved ? saved.is_pr : false,
        _logId: saved ? saved.id : null,
      });
    }
    setLogs[ex.id] = rows;
  }

  // Restore notes per exercise
  const exerciseNotes = {};
  if (meta?.exercises) {
    for (const e of meta.exercises) {
      if (e.note) exerciseNotes[e.id] = e.note;
    }
  }

  state.activeSession = session;
  state.activeDay = session.day;
  state.sessionExercises = sessionExercises;
  state.defaultExerciseIds = sessionExercises.map(e => e.id);
  state.setLogs = setLogs;
  state.skipped = new Set(meta?.skipped || []);
  state.exerciseNotes = exerciseNotes;
  state.view = 'workout';
  state.tab = 'workout';
}

// ── Prune empty sessions ──────────────────────────────────────────
// Safety rules: only delete if ALL of these hold:
//   1. Not the currently active session
//   2. Session is older than 24h (gives other devices time to sync their logs)
//   3. Zero logs in local IndexedDB (which has already fetched from Supabase in loadProgressData)
async function pruneEmptySessions() {
  const activeId = localStorage.getItem('activeWorkoutSessionId');
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const toDelete = [];
  for (const s of state.sessions) {
    if (s.id === activeId) continue;
    const createdAt = new Date(s.created_at || s.date).getTime();
    if (createdAt > cutoff) continue; // too recent — may still be syncing
    const logs = await DB.getAll('set_logs', 'session_id', s.id);
    if (logs.length === 0) toDelete.push(s);
  }
  for (const s of toDelete) {
    await DB.del('sessions', s.id);
    try { await Supabase.deleteRecord('sessions', s.id); } catch (_) {}
  }
  if (toDelete.length > 0) {
    state.sessions = state.sessions.filter(s => !toDelete.find(d => d.id === s.id));
  }
}

// ── Daily auto-backup ─────────────────────────────────────────────
async function maybeAutoBackup() {
  // Disabled: auto-download triggered a JSON file download on every app open,
  // which is unwanted. Backups can be re-added later as an explicit button.
  return;
  // eslint-disable-next-line no-unreachable
  const lastBackup = localStorage.getItem('lastAutoBackup');
  if (lastBackup === today()) return; // already backed up today

  try {
    const allLogs = await DB.getAll('set_logs');
    const backup = {
      exported_at: new Date().toISOString(),
      user_email: state.user?.email || '',
      sessions: state.sessions,
      set_logs: allLogs,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workout-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem('lastAutoBackup', today());
  } catch (_) {}
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
  await loadRoutineDays();
  await syncIfOnline();
  await loadSessions();
  await loadProgressData();
  await pruneEmptySessions();
  await maybeAutoBackup();
  await tryResumeSession();

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => { haptic(5); setTab(btn.dataset.tab); });
  });
  window.addEventListener('online', () => { updateSyncDot(); syncIfOnline(); });
  window.addEventListener('offline', () => updateSyncDot());

  renderView();
  renderRestTimer();
}

document.addEventListener('DOMContentLoaded', init);
