const CACHE = 'workout-v66';
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

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Network-first for Supabase API calls
  if (url.hostname.includes('supabase.co')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response('{"error":"offline"}', {
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
    // On first install there's no cache, so network is required.
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const networkFetch = fetch(e.request, { cache: 'no-cache' })
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
