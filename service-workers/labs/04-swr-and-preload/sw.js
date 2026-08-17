// Lab 04 — stale-while-revalidate in a service worker, plus navigation preload.

const params = new URL(self.location).searchParams;
const VERSION = params.get('v') || '1';
const USE_PRELOAD = params.get('np') === '1';
const BOOT_COST = Number(params.get('boot') || 0);      // simulate a heavy worker startup
const CACHE = `swr-v${VERSION}`;
const MAX_AGE_MS = Number(params.get('maxAge') || 10_000);

// Simulated boot cost. A real worker pays this in parsing + running its top-level code —
// importScripts of a big library, building a route table, reading IndexedDB.
if (BOOT_COST) {
  const end = Date.now() + BOOT_COST;
  while (Date.now() < end) { /* burn */ }
}

const log = async (msg) => {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of clients) c.postMessage({ type: 'log', msg });
};

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(['./', './index.html', './app.js', '/shared/lab.css', '/shared/lab-ui.js']);
  self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  if (USE_PRELOAD && self.registration.navigationPreload) {
    await self.registration.navigationPreload.enable();
    await log('navigation preload ENABLED');
  } else if (self.registration.navigationPreload) {
    await self.registration.navigationPreload.disable();
    await log('navigation preload disabled');
  }
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith('swr-v') && k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
  await log(`activated (boot cost ${BOOT_COST}ms, cache max-age ${MAX_AGE_MS}ms)`);
})()));

// ---------------------------------------------------------------------------
// Request coalescing: several components asking for the same stale URL in the same tick
// must produce ONE background refresh, not N.
// ---------------------------------------------------------------------------

const inFlight = new Map();

function refresh(request, cache) {
  const key = request.url;
  if (inFlight.has(key)) return inFlight.get(key);
  const p = fetch(request)
    .then(async (res) => {
      if (res.ok) {
        // The Cache API stores Responses and no metadata, so stamp the store time into a
        // header on the copy we keep. That is how you implement expiry at all.
        const headers = new Headers(res.headers);
        headers.set('x-cached-at', String(Date.now()));
        await cache.put(request, new Response(res.clone().body, {
          status: res.status, statusText: res.statusText, headers,
        }));
        log(`background refresh done: ${new URL(request.url).search}`);
      }
      return res;
    })
    .catch((err) => { log(`background refresh failed: ${err.message}`); })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

function tag(res, source, age) {
  const headers = new Headers(res.headers);
  headers.set('x-sw-source', source);
  if (age != null) headers.set('x-sw-age-ms', String(age));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);

  if (cached) {
    const cachedAt = Number(cached.headers.get('x-cached-at') || 0);
    const age = Date.now() - cachedAt;

    if (age > MAX_AGE_MS * 10) {
      // Too old to be worth showing at all: treat as a miss. Without this bound, a user who
      // returns after a month sees month-old data for one render.
      log(`cache entry is ${Math.round(age / 1000)}s old — too stale to serve, awaiting network`);
      const res = await refresh(request, cache);
      return tag(res ?? cached, 'network-too-stale', age);
    }

    refresh(request, cache);                       // deliberately not awaited
    return tag(cached, age > MAX_AGE_MS ? 'cache-stale-revalidating' : 'cache-fresh', age);
  }

  log(`cache miss: ${new URL(request.url).search}`);
  const res = await fetch(request);
  if (res.ok) {
    const headers = new Headers(res.headers);
    headers.set('x-cached-at', String(Date.now()));
    await cache.put(request, new Response(res.clone().body, { status: res.status, headers }));
  }
  return tag(res, 'network-miss');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Navigations: use the preloaded response when it exists. If you enable navigation preload
  // and then ignore event.preloadResponse, you have made a request for nothing — the browser
  // warns about exactly this.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const preload = await event.preloadResponse;
      if (preload) {
        log('navigation served from the PRELOADED response');
        return preload;
      }
      return fetch(request);
    })());
    return;
  }

  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/asset')) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

self.addEventListener('message', async (e) => {
  if (e.data === 'clearCache') {
    for (const k of await caches.keys()) await caches.delete(k);
    await log('caches cleared');
  }
});
