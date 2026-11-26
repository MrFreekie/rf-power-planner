// RF Bench service worker: precaches the app shell so the planner opens offline.
// BUILD and FILES are stamped by scripts/stamp-sw.mjs at deploy; a new deploy gets a new cache name,
// and the old cache is deleted on activate. All URLs are relative to this file (served from a sub-path).
const BUILD = null;
const FILES = null;
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'css/style.css', 'css/onboarding.css', 'js/app.js'];
const CACHE = 'rf-bench-' + (BUILD || 'dev');

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Tolerant: a missing optional file must not block the install.
    await Promise.allSettled((FILES || CORE).map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('rf-bench-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Same-origin GETs only. Requests with a query string (the update check polls js/build-info.js?t=...) go straight to the network and are never cached.
  if (req.method !== 'GET' || url.origin !== self.location.origin || (url.search && req.mode !== 'navigate')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') { const shell = await cache.match('index.html'); if (shell) return shell; }
      throw err;
    }
  })());
});
