// Lab 01 — the lifecycle service worker.
//
// It caches nothing. Its only job is to narrate its own life so you can watch the states.
//
// Change VERSION (or load the page with ?v=2) to simulate a deploy: the browser compares this
// file byte-for-byte with the installed copy, and any difference means a new worker.

const VERSION = new URL(self.location).searchParams.get('v') || '1';

const log = (msg) => {
  console.log(`[sw v${VERSION}] ${msg}`);
  broadcast({ type: 'log', version: VERSION, msg });
};

async function broadcast(data) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of clients) c.postMessage(data);
}

self.addEventListener('install', (event) => {
  log('install event fired');
  // Whatever you await here delays the transition to "installed". If it rejects, the whole
  // install fails and this worker never becomes active — which is exactly what you want when
  // precaching (Lab 02): a half-populated cache would be worse than none.
  event.waitUntil((async () => {
    await new Promise((r) => setTimeout(r, 800));      // pretend to precache
    log('install work finished → now WAITING (unless skipWaiting was called)');
  })());
});

self.addEventListener('activate', (event) => {
  log('activate event fired');
  event.waitUntil((async () => {
    // The one place to delete old caches: nothing else is using them any more.
    await new Promise((r) => setTimeout(r, 300));
    log('activate work finished → ACTIVATED');
  })());
});

self.addEventListener('fetch', (event) => {
  // Not calling respondWith() means "do exactly what you would have done anyway".
  // Note that merely HAVING a fetch listener costs a worker start-up on every navigation,
  // so an empty fetch handler is not free — see Lab 05.
  if (event.request.url.includes('/api/asset')) {
    log(`fetch intercepted: ${new URL(event.request.url).search}`);
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    log('skipWaiting() called — jumping the queue');
    self.skipWaiting();
  }
  if (event.data === 'claim') {
    log('clients.claim() called — taking control of open pages');
    event.waitUntil(self.clients.claim());
  }
  if (event.data === 'version') {
    event.source?.postMessage({ type: 'version', version: VERSION, state: 'reporting in' });
  }
});
