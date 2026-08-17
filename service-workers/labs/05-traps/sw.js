// Lab 05 — the traps.
//
// One worker, several deliberately wrong behaviours, selected per-request by a `trap` query
// parameter so you can trigger them one at a time.

const CACHE = 'traps-v1';
const KILL_SWITCH_URL = '/api/asset?name=sw-kill-switch&type=json&cc=no-store';

const log = async (msg, level = 'info') => {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of clients) c.postMessage({ type: 'log', msg, level });
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// ---------------------------------------------------------------------------
// THE KILL SWITCH — build this before you ship any service worker.
//
// On every activation, ask the server whether this worker should still exist. If the answer is
// "no", unregister and clear caches, then reload every client. That is the only mechanism that
// can rescue users from a bad worker you have already shipped, because a broken worker may be
// serving them a broken app shell from cache with no path to an update.
// ---------------------------------------------------------------------------

async function checkKillSwitch() {
  try {
    const res = await fetch(KILL_SWITCH_URL, { cache: 'no-store' });
    const data = await res.json();
    // The lab server returns { version: N }; treat "version >= 2" as "kill".
    if (data.version >= 2) {
      await log('KILL SWITCH ACTIVE — unregistering and clearing caches', 'bad');
      for (const k of await caches.keys()) await caches.delete(k);
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const c of clients) c.postMessage({ type: 'killed' });
      return true;
    }
    await log('kill switch checked: worker may continue');
  } catch (err) {
    // Fail OPEN: if the check itself fails (offline), keep working. A kill switch that kills
    // the app whenever the network is down is worse than no kill switch.
    await log(`kill switch check failed (${err.message}) — continuing`);
  }
  return false;
}

self.addEventListener('activate', (e) => e.waitUntil(checkKillSwitch()));

// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const trap = url.searchParams.get('trap');
  if (!trap) return;

  switch (trap) {
    // ---------------------------------------------------------------------
    // 1. Opaque responses: cached happily, unknown size, unknown status.
    // ---------------------------------------------------------------------
    case 'opaque':
      event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(event.request);
        if (hit) {
          await log(`opaque cache HIT — status ${hit.status}, type ${hit.type}. ` +
            'Note you cannot tell whether this was ever a successful response.', 'bad');
          return hit;
        }
        const res = await fetch(event.request.url, { mode: 'no-cors' });
        await log(`fetched no-cors: status ${res.status} type ${res.type} — caching it anyway`, 'bad');
        await cache.put(event.request, res.clone());
        return res;
      })());
      break;

    // ---------------------------------------------------------------------
    // 2. Range requests: cache.match ignores the Range header, so a cached 200 is returned
    //    for a request that asked for bytes 100–200. Media elements break: seeking fails,
    //    and Safari refuses to play at all.
    // ---------------------------------------------------------------------
    case 'range':
      event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(event.request, { ignoreVary: true });
        if (hit) {
          await log(`range request asked for "${event.request.headers.get('range')}" and got a ` +
            `${hit.status} with the WHOLE body. A <video> would fail to seek.`, 'bad');
          return hit;
        }
        const res = await fetch(event.request);
        await cache.put(new Request(event.request.url), res.clone());
        return res;
      })());
      break;

    // ---------------------------------------------------------------------
    // 3. Redirects: you cannot respond to a navigation with a redirected response.
    // ---------------------------------------------------------------------
    case 'redirect':
      event.respondWith((async () => {
        const res = await fetch(event.request, { redirect: 'manual' });
        await log(`fetched with redirect:'manual' → type "${res.type}", status ${res.status}. ` +
          'Returning this from respondWith() for a navigation throws.', 'bad');
        return res;
      })());
      break;

    // ---------------------------------------------------------------------
    // 4. A handler that throws. The page gets a network error — for a request that would
    //    have worked perfectly without your worker.
    // ---------------------------------------------------------------------
    case 'throw':
      event.respondWith((async () => {
        await log('this handler is about to throw. Watch what the page receives.', 'bad');
        throw new Error('deliberate bug in the fetch handler');
      })());
      break;

    // ---------------------------------------------------------------------
    // 5. Non-GET: cache.put() rejects for POST/PUT/DELETE.
    // ---------------------------------------------------------------------
    case 'post':
      event.respondWith((async () => {
        const res = await fetch(event.request);
        try {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, res.clone());
          await log('cached a non-GET request (this should not have worked)', 'bad');
        } catch (err) {
          await log(`cache.put on a ${event.request.method} threw: ${err.name}: ${err.message}`, 'good');
        }
        return res;
      })());
      break;

    default:
  }
});

self.addEventListener('message', async (e) => {
  if (e.data === 'checkKill') await checkKillSwitch();
  if (e.data === 'clear') {
    for (const k of await caches.keys()) await caches.delete(k);
    await log('caches cleared');
  }
  if (e.data?.type === 'bloat') {
    const cache = await caches.open(CACHE);
    for (let i = 0; i < e.data.count; i++) {
      const res = await fetch(`/api/blob?mb=${e.data.mb}&i=${i}&t=${Date.now()}`);
      try {
        await cache.put(new Request(`/bloat/${i}-${Date.now()}`), res);
      } catch (err) {
        await log(`cache.put failed at entry ${i}: ${err.name} — ${err.message}`, 'bad');
        break;
      }
    }
    await log(`wrote ${e.data.count} × ${e.data.mb}MB into Cache Storage`);
    e.source?.postMessage({ type: 'bloatDone' });
  }
});
