// Lab 06 — mini-Workbox.
//
// A routing layer with pluggable strategies. Two strategies and the router are written for
// you; the rest are TODOs. Read the whole file before you start — the interesting decisions
// are in the plugin hooks, not in the strategies themselves.

const VERSION = new URL(self.location).searchParams.get('v') || '1';

const report = async (msg, level = 'info') => {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of clients) c.postMessage({ type: 'log', msg, level });
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const routes = [];

/**
 * @param {(url: URL, request: Request) => boolean} match
 * @param {{handle: (ctx) => Promise<Response>, name: string}} strategy
 * @param {string} [method]
 */
function registerRoute(match, strategy, method = 'GET') {
  routes.push({ match, strategy, method });
}

function findRoute(request) {
  const url = new URL(request.url);
  return routes.find((r) => r.method === request.method && r.match(url, request));
}

self.addEventListener('fetch', (event) => {
  const route = findRoute(event.request);
  if (!route) return;                                    // not ours: default browser behaviour

  event.respondWith((async () => {
    try {
      const res = await route.strategy.handle({ request: event.request, event });
      const tagged = new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: new Headers(res.headers),
      });
      tagged.headers.set('x-strategy', route.strategy.name);
      return tagged;
    } catch (err) {
      // The rule from Lab 05: a bug in a strategy must degrade to "no caching", never to
      // "the site is down".
      report(`strategy ${route.strategy.name} threw: ${err.message} — falling back to network`, 'bad');
      return fetch(event.request);
    }
  })());
});

// ---------------------------------------------------------------------------
// Plugins
//
// A plugin is an object with optional hooks. Strategies call them at fixed points, which is
// how Workbox composes expiry, response filtering, broadcast updates and so on without every
// strategy knowing about every feature.
// ---------------------------------------------------------------------------

/** Only cache responses whose status is in the list. Keeps opaque 404s out (Lab 05). */
const cacheableResponse = ({ statuses = [200] } = {}) => ({
  name: 'cacheableResponse',
  cacheWillUpdate: async ({ response }) => (statuses.includes(response.status) ? response : null),
});

/** Stamp a store time so expiry is possible at all. */
const timestamp = () => ({
  name: 'timestamp',
  cacheWillUpdate: async ({ response }) => {
    const headers = new Headers(response.headers);
    headers.set('x-cached-at', String(Date.now()));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
});

/**
 * TODO 1 — expiration plugin.
 *
 * expiration({ maxEntries: 50, maxAgeMs: 86400000 })
 *
 * Hooks you will need:
 *   cachedResponseWillBeUsed({ cachedResponse }) → return null to treat it as a miss
 *   cacheDidUpdate({ cacheName, request })       → enforce maxEntries (LRU)
 *
 * Requirements:
 *   - Use the x-cached-at header written by timestamp() to decide age.
 *   - Enforce maxEntries by deleting the least-recently-USED entry, not the oldest-written.
 *     That means you need to record a "last used" time somewhere — cache.keys() gives you
 *     insertion order only. Think about where that index lives and what happens when the
 *     worker is killed halfway through an update.
 *   - Never let an eviction failure break the response.
 */
const expiration = (opts) => ({
  name: 'expiration',
  cachedResponseWillBeUsed: async ({ cachedResponse }) => {
    throw new Error('TODO 1: implement the expiration plugin');
  },
});

async function runHook(plugins, hook, ctx) {
  let value = ctx[Object.keys(ctx).find((k) => k === 'response' || k === 'cachedResponse')];
  for (const p of plugins) {
    if (!p[hook]) continue;
    value = await p[hook]({ ...ctx, response: value, cachedResponse: value });
    if (value == null) return null;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

const CacheFirst = ({ cacheName, plugins = [] }) => ({
  name: 'CacheFirst',
  async handle({ request }) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) {
      const usable = await runHook(plugins, 'cachedResponseWillBeUsed', { cachedResponse: cached, request, cacheName });
      if (usable) return usable;
      report(`${cacheName}: entry expired, re-fetching`);
    }
    const res = await fetch(request);
    const toCache = await runHook(plugins, 'cacheWillUpdate', { response: res.clone(), request, cacheName });
    if (toCache) {
      await cache.put(request, toCache);
      await runHook(plugins, 'cacheDidUpdate', { response: toCache, request, cacheName });
    }
    return res;
  },
});

const NetworkOnly = () => ({
  name: 'NetworkOnly',
  handle: ({ request }) => fetch(request),
});

/**
 * TODO 2 — NetworkFirst({ cacheName, networkTimeoutMs, plugins }).
 * See Lab 03: race the network against a timeout, fall back to cache, let the slow request
 * finish anyway, and synthesise a useful error when there is nothing at all.
 */
const NetworkFirst = ({ cacheName, networkTimeoutMs = 2000, plugins = [] }) => ({
  name: 'NetworkFirst',
  async handle({ request }) {
    throw new Error('TODO 2: implement NetworkFirst');
  },
});

/**
 * TODO 3 — StaleWhileRevalidate({ cacheName, plugins }).
 * See Lab 04: return the cached copy immediately, refresh in the background, coalesce
 * concurrent refreshes of the same URL, and bound how stale is too stale.
 */
const StaleWhileRevalidate = ({ cacheName, plugins = [] }) => ({
  name: 'StaleWhileRevalidate',
  async handle({ request }) {
    throw new Error('TODO 3: implement StaleWhileRevalidate');
  },
});

/**
 * TODO 4 — a navigation route with an offline fallback.
 * Navigations should try the network (using event.preloadResponse when available — remember
 * to enable navigation preload in activate), fall back to the cached shell, then to
 * ./offline.html.
 */
const NavigationStrategy = ({ cacheName }) => ({
  name: 'Navigation',
  async handle({ request, event }) {
    throw new Error('TODO 4: implement the navigation strategy');
  },
});

// ---------------------------------------------------------------------------
// The routing table — this is the deliverable: a readable statement of your caching policy.
// ---------------------------------------------------------------------------

registerRoute(
  (url, request) => request.mode === 'navigate',
  NavigationStrategy({ cacheName: `shell-v${VERSION}` }),
);

registerRoute(
  (url) => url.pathname.startsWith('/shared/') || url.pathname.endsWith('.css'),
  CacheFirst({ cacheName: `static-v${VERSION}`, plugins: [cacheableResponse(), timestamp()] }),
);

registerRoute(
  (url) => url.pathname === '/api/image.svg',
  CacheFirst({
    cacheName: 'images',
    plugins: [cacheableResponse(), timestamp(), expiration({ maxEntries: 20, maxAgeMs: 60_000 })],
  }),
);

registerRoute(
  (url) => url.pathname.startsWith('/api/') && url.searchParams.get('kind') === 'fresh',
  NetworkFirst({ cacheName: 'api', networkTimeoutMs: 1200, plugins: [cacheableResponse(), timestamp()] }),
);

registerRoute(
  (url) => url.pathname.startsWith('/api/') && url.searchParams.get('kind') === 'swr',
  StaleWhileRevalidate({ cacheName: 'api', plugins: [cacheableResponse(), timestamp()] }),
);

registerRoute(
  (url) => url.pathname.startsWith('/api/') && url.searchParams.get('kind') === 'never',
  NetworkOnly(),
);

// ---------------------------------------------------------------------------

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const cache = await caches.open(`shell-v${VERSION}`);
  await cache.addAll(['./', './index.html', './app.js', './offline.html', '/shared/lab.css', '/shared/lab-ui.js']);
  self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  // TODO 5 — enable navigation preload here, and delete caches whose version is not VERSION
  // (but be careful: 'images' and 'api' are unversioned on purpose. Why?).
  await self.clients.claim();
  await report(`mini-workbox v${VERSION} active with ${routes.length} routes`);
})()));

self.addEventListener('message', async (e) => {
  if (e.data === 'inspect') {
    const detail = {};
    for (const k of await caches.keys()) {
      detail[k] = (await (await caches.open(k)).keys()).length;
    }
    e.source?.postMessage({ type: 'caches', detail });
  }
  if (e.data === 'clear') {
    for (const k of await caches.keys()) await caches.delete(k);
    await report('caches cleared');
  }
});
