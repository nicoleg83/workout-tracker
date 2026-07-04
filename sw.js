const CACHE = 'workout-v81';
const BASE = self.registration.scope;

// Offline shell — only non-HTML assets (HTML is always fetched fresh)
const SHELL = [
  BASE + 'styles.css',
  BASE + 'app.js',
  BASE + 'db.js',
  BASE + 'supabase.js',
  BASE + 'exercises.js',
  BASE + 'illustrations.js',
  BASE + 'manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// A page-side AbortController timeout doesn't reliably propagate through a
// service worker's fetch interception on every browser (iOS Safari has had
// inconsistencies here) — the SW is doing its own separate fetch() underneath.
// So the SW needs its own independent timeout too, or a slow/stalled request
// can hang the response indefinitely regardless of what the page set up.
function fetchWithTimeout(request, opts, ms) {
  return Promise.race([
    fetch(request, opts),
    new Promise((_, reject) => setTimeout(() => reject(new Error('sw-fetch-timeout')), ms)),
  ]);
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Network-first for Supabase API calls
  if (url.hostname.includes('supabase.co')) {
    e.respondWith(
      fetchWithTimeout(e.request, {}, 5000).catch(() => new Response('{"error":"offline"}', {
        // Must NOT be a 200 — callers check res.ok to decide whether to fall
        // back to local/offline data. A "successful" 200 with an error body
        // used to make every caller treat this as real data (e.g. sessions
        // list) instead of triggering their offline fallback.
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }))
    );
    return;
  }

  // Always network-first (bypassing HTTP cache) for the app shell files:
  // HTML, JS, CSS, and the root URL — this ensures updates are picked up
  // on a single reload without a double-refresh or manual cache clear.
  const isAppShell = (
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js')  ||
    url.pathname.endsWith('.css') ||
    url.pathname === new URL(BASE).pathname ||
    url.pathname === new URL(BASE).pathname.replace(/\/$/, '')
  );

  if (isAppShell) {
    // Stale-while-revalidate: return cached version immediately (instant load),
    // then fetch fresh in background and update cache for next visit.
    // On first install (or right after a cache-name bump) there's no cached
    // copy yet, so this falls through to the network fetch — bounded so a
    // stalled connection doesn't hang the whole page load forever.
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const networkFetch = fetchWithTimeout(e.request, { cache: 'no-cache' }, 10000)
            .then(res => {
              if (res.ok) cache.put(e.request, res.clone());
              return res;
            })
            .catch(() => null);
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // Cache-first for everything else (icons, manifest, etc.)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});
