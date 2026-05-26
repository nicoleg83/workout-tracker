const Supabase = (() => {
  const URL = 'https://zveiibpidqjxouylpzby.supabase.co';
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2ZWlpYnBpZHFqeG91eWxwemJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDI0OTQsImV4cCI6MjA5NTMxODQ5NH0.Iu3l6JB2_i_0uTOCfIlNYgvJTeeH8LEcZBLo_m8Xk1Q';

  const headers = {
    'apikey': KEY,
    'Authorization': `Bearer ${KEY}`,
    'Content-Type': 'application/json',
  };

  async function req(path, options = {}) {
    const res = await fetch(`${URL}/rest/v1${path}`, { headers: { ...headers, ...options.headers }, ...options });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Supabase error ${res.status}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function getExercises() {
    return req('/exercises?select=*&order=day,sort_order');
  }

  async function insertExercises(batch) {
    return req('/exercises', {
      method: 'POST',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify(batch),
    });
  }

  async function getSessions(limit = 30) {
    return req(`/sessions?select=*&order=date.desc&limit=${limit}`);
  }

  async function getSetLogs(sessionId) {
    return req(`/set_logs?select=*&session_id=eq.${sessionId}&order=exercise_id,set_number`);
  }

  async function getExerciseHistory(exerciseId) {
    return req(
      `/set_logs?select=weight_lbs,reps,is_pr,logged_at,sessions(date)&exercise_id=eq.${exerciseId}&completed=eq.true&order=logged_at.desc&limit=50`
    );
  }

  async function insert(table, payload) {
    return req(`/${table}`, {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify(payload),
    });
  }

  async function update(table, payload) {
    return req(`/${table}?id=eq.${payload.id}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify(payload),
    });
  }

  return { getExercises, insertExercises, getSessions, getSetLogs, getExerciseHistory, insert, update };
})();
