// Lab 03 — network first, with a timeout, an offline fallback, and a navigation fallback.

const VERSION = new URL(self.location).searchParams.get('v') || '1';
const SHELL = `nf-shell-v${VERSION}`;
const DATA = `nf-data-v${VERSION}`;
const TIMEOUT_MS = Number(new URL(self.location).searchParams.get('timeout') || 1200);

const PRECACHE = ['./', './index.html', './app.js', './offline.html', '/shared/lab.css', '/shared/lab-ui.js'];

const log = async (msg) => {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of clients) c.postMessage({ type: 'log', version: VERSION, msg });
};

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const cache = await caches.open(SHELL);
  await cache.addAll(PRECACHE);
  await log(`precached the shell + offline page (timeout ${TIMEOUT_MS}ms)`);
  self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.includes('-v') && k !== SHELL && k !== DATA).map((k) => caches.delete(k)));
  await self.clients.claim();
  await log('activated');
})()));

/** Tag a response so the page can see which path served it. Headers are immutable, so clone. */
function tag(res, source, extra = {}) {
  const headers = new Headers(res.headers);
  headers.set('x-sw-source', source);
  for (const [k, v] of Object.entries(extra)) headers.set(k, String(v));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * Network first with a timeout.
 *
 * The timeout is the part people leave out, and it is the part that matters. "Offline" is rare;
 * "connected to a captive portal / a train tunnel / 2G" is common, and a naive network-first
 * strategy hangs there for 30 seconds before falling back. A 1.2s timeout turns that into a
 * good experience with slightly stale data.
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  const network = fetch(request).then(async (res) => {
    if (res.ok) await cache.put(request, res.clone());
    return res;
  });

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));

  try {
    const res = await Promise.race([network, timeout]);
    if (res) {
      log(`network answered in time: ${new URL(request.url).pathname}`);
      return tag(res, 'network');
    }
    // Timed out — serve what we have, and let the real request keep going so the cache is
    // updated for next time. Do NOT abort it: a slow response is still a useful one.
    const cached = await cache.match(request);
    if (cached) {
      log(`network too slow (>${TIMEOUT_MS}ms) — serving cache, refresh continues in background`);
      return tag(cached, 'timeout-fallback-cache');
    }
    log(`network too slow and nothing cached — waiting for the network after all`);
    return tag(await network, 'network-late');
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) {
      log(`network FAILED (${err.message}) — serving cache`);
      return tag(cached, 'offline-cache');
    }
    log(`network FAILED and nothing cached: ${new URL(request.url).pathname}`);
    return new Response(JSON.stringify({ error: 'offline', url: request.url }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'x-sw-source': 'offline-error' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // 1. Navigations: try the network, fall back to the cached page, then to the offline page.
  //    Without this, an offline deep link to /anything is a browser error page and your
  //    "offline-capable" app shows the dinosaur.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(request);
        return res;
      } catch {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) { log('navigation served from cache'); return tag(cached, 'nav-cache'); }
        log('navigation offline → offline.html');
        return tag(await caches.match('./offline.html'), 'offline-page');
      }
    })());
    return;
  }

  // 2. Same-origin API data: network first.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, DATA));
    return;
  }

  // 3. Shell assets: cache first (Lab 02).
  if (PRECACHE.some((p) => new URL(p, self.location).href === url.href)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      return cached ? tag(cached, 'shell-cache') : fetch(request);
    })());
  }
});

self.addEventListener('message', async (e) => {
  if (e.data === 'inspect') {
    const detail = {};
    for (const k of await caches.keys()) {
      detail[k] = (await (await caches.open(k)).keys()).map((r) => r.url.replace(self.location.origin, ''));
    }
    e.source?.postMessage({ type: 'caches', detail });
  }
});
