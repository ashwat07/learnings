// A service worker whose cache name is derived from the ?v= it was registered with, so a "deploy"
// is a genuinely different worker with a genuinely different cache.

const VERSION = new URL(self.location).searchParams.get('v') || '1';
const CACHE = `updates-lab-${VERSION}`;

self.addEventListener('install', (e) => {
  // NOTE: no skipWaiting() here. The new worker installs and then WAITS, which is the default and
  // the behaviour this lab exists to show.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html'])));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Delete every cache that is not ours. This is the step people forget, and it is why storage
    // quota fills up over months of deploys.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('updates-lab-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  // The page asks the waiting worker to take over — only after the USER agreed.
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
});
