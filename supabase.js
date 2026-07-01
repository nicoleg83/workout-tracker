const Supabase = (() => {
  const BASE = 'https://zveiibpidqjxouylpzby.supabase.co';
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2ZWlpYnBpZHFqeG91eWxwemJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDI0OTQsImV4cCI6MjA5NTMxODQ5NH0.Iu3l6JB2_i_0uTOCfIlNYgvJTeeH8LEcZBLo_m8Xk1Q';
  const STORE_KEY = 'wt_auth';

  let _session = null;

  function headers(extra = {}) {
    return {
      'apikey': ANON,
      'Authorization': `Bearer ${_session?.access_token || ANON}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  // Flaky connections (gym wifi) can leave a fetch hanging with no error for a
  // long time — there's no default timeout. Abort after a few seconds so callers'
  // existing offline fallbacks kick in quickly instead of the app looking stuck.
  const TIMEOUT_MS = 4000;
  async function fetchWithTimeout(url, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { ...opts, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function restReq(path, opts = {}) {
    const { headers: extraHeaders, ...fetchOpts } = opts;
    const res = await fetchWithTimeout(`${BASE}/rest/v1${path}`, {
      headers: headers(extraHeaders),
      ...fetchOpts,
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || `Supabase ${res.status}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function authPost(path, body) {
    const res = await fetchWithTimeout(`${BASE}/auth/v1${path}`, {
      method: 'POST',
      headers: { 'apikey': ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error_description || data.msg || data.message || 'Auth failed');
    return data;
  }

  function storeSession(data) {
    _session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user: data.user,
    };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(_session)); } catch (_) {}
    return _session;
  }

  function clearSession() {
    _session = null;
    try { localStorage.removeItem(STORE_KEY); } catch (_) {}
  }

  // ── Auth ──────────────────────────────────────────────────────────

  async function restoreSession() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      // Refresh if expiring within 5 minutes
      if (Date.now() > s.expires_at - 300_000) {
        try {
          const data = await authPost('/token?grant_type=refresh_token', {
            refresh_token: s.refresh_token,
          });
          return storeSession(data);
        } catch (refreshErr) {
          // A network failure (offline, timed out) is NOT the same as the server
          // rejecting the refresh token. Being offline used to wipe the whole
          // session here, bouncing the app to the login screen and hiding all
          // local offline data. Keep using the cached (possibly stale) session
          // instead so the app still opens; a real auth rejection while online
          // still logs out below.
          if (!navigator.onLine) { _session = s; return _session; }
          throw refreshErr;
        }
      }
      _session = s;
      return _session;
    } catch (_) {
      clearSession();
      return null;
    }
  }

  async function signIn(email, password) {
    const data = await authPost('/token?grant_type=password', { email, password });
    return storeSession(data);
  }

  async function signUp(email, password) {
    const data = await authPost('/signup', { email, password });
    if (data.access_token) return storeSession(data);
    return data; // needs email confirmation
  }

  async function signOut() {
    try {
      await fetch(`${BASE}/auth/v1/logout`, { method: 'POST', headers: headers() });
    } catch (_) {}
    clearSession();
  }

  function getUser() { return _session?.user || null; }

  // ── Data ──────────────────────────────────────────────────────────

  async function getExercises() {
    return restReq('/exercises?select=*&order=day,sort_order');
  }

  async function getRoutineDays() {
    return restReq('/routine_days?select=*&order=sort_order');
  }

  async function insertExercises(batch) {
    return restReq('/exercises', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify(batch),
    });
  }

  async function getSessions(limit = 100) {
    const uid = _session?.user?.id;
    if (!uid) return [];
    return restReq(`/sessions?select=*&user_id=eq.${uid}&order=date.desc&limit=${limit}`);
  }

  async function getSetLogs(sessionId) {
    return restReq(`/set_logs?select=*&session_id=eq.${sessionId}&order=exercise_id,set_number`);
  }

  async function getAllSetLogs(sessionIds) {
    if (!sessionIds.length) return [];
    return restReq(`/set_logs?select=*&session_id=in.(${sessionIds.join(',')})&order=exercise_id,set_number`);
  }

async function insert(table, payload) {
    return restReq(`/${table}`, {
      method: 'POST',
      // merge-duplicates = upsert on conflict, making retries safe (no 409 loops)
      headers: { 'Prefer': 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify(payload),
    });
  }

  async function update(table, payload) {
    return restReq(`/${table}?id=eq.${payload.id}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify(payload),
    });
  }

  async function deleteRecord(table, id) {
    return restReq(`/${table}?id=eq.${id}`, { method: 'DELETE' });
  }

  async function deleteSetLogsBySession(sessionId) {
    return restReq(`/set_logs?session_id=eq.${sessionId}`, { method: 'DELETE' });
  }

  return {
    restoreSession, signIn, signUp, signOut, getUser,
    getExercises, insertExercises, getRoutineDays,
    getSessions, getSetLogs, getAllSetLogs, deleteSetLogsBySession,
    insert, update, deleteRecord,
  };
})();
