// Lab 05 — the traps (page side).

import { $, on, Log, storageEstimate, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const ALT = 'http://localhost:8081';

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'log') log.line(`[sw] ${e.data.msg}`,
    e.data.level === 'bad' ? 'bad' : e.data.level === 'good' ? 'good' : 'micro');
  if (e.data?.type === 'killed') {
    log.bad('the worker unregistered itself and cleared its caches. Reload to get a clean page.');
  }
});

on('register', async () => {
  await navigator.serviceWorker.register('sw.js', { scope: './' });
  await navigator.serviceWorker.ready;
  log.ok('registered — reload once if this page is not controlled yet');
});

on('unregister', async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  log.bad('unregistered and cleared');
});

on('estimate', async () => {
  const e = await storageEstimate();
  log.line(`storage: ${e.usageFmt} used of ${e.quotaFmt} (${(e.pct * 100).toFixed(2)}%)`, 'macro');
  if (e.details) log.muted(`  breakdown: ${JSON.stringify(e.details)}`);
});

// ---------------------------------------------------------------------------
// 1. Opaque
// ---------------------------------------------------------------------------

on('opaque', async () => {
  log.head('— caching an opaque (no-cors) response —');
  const before = await storageEstimate();
  await fetch(`${ALT}/api/asset?name=opaque-demo&type=json&trap=opaque&size=1000`, { mode: 'no-cors' })
    .then((r) => log.line(`page sees: status ${r.status}, type ${r.type}, ok ${r.ok}`, 'bad'));
  const after = await storageEstimate();
  const delta = after.usage - before.usage;
  log.line(`storage usage grew by ${fmt.bytes(delta)} for a ~1KB response`, delta > 100000 ? 'bad' : 'macro');
  out.textContent =
    'An opaque response has status 0, no headers and no readable body — and it caches perfectly\n' +
    'happily. Two consequences:\n\n' +
    '1. QUOTA PADDING. Because the real size would leak cross-origin information, the browser\n' +
    '   charges your quota a fixed padding per opaque entry (Chrome: on the order of 7MB). Cache\n' +
    '   30 third-party assets opaquely and you have "used" 200MB of a quota you do not control.\n\n' +
    '2. YOU CANNOT TELL SUCCESS FROM FAILURE. res.ok is false for a perfectly good response, and\n' +
    '   status is 0 whether the server said 200 or 404. Try the next button.\n\n' +
    'Fix: fetch cross-origin assets in CORS mode (crossorigin attribute + a server that allows\n' +
    'it) and check res.ok before caching. If you cannot, at least do not precache them.';
});

on('opaque404', async () => {
  log.head('— caching an opaque 404 —');
  const res = await fetch(`${ALT}/api/asset?name=opaque-404&type=json&status=404&trap=opaque`, { mode: 'no-cors' });
  log.line(`the server returned 404. The page sees status ${res.status}, ok ${res.ok}, type ${res.type}.`, 'bad');
  log.bad('That 404 is now in your cache, indistinguishable from a success, and will be served ' +
    'to users as if it were the real asset — forever, or until the cache version changes.');
});

// ---------------------------------------------------------------------------
// 2. Range
// ---------------------------------------------------------------------------

on('range', async () => {
  log.head('— a Range request against a cached full response —');
  const url = `/api/blob?mb=1&trap=range`;
  await fetch(url).then((r) => r.arrayBuffer());                       // prime the cache
  const res = await fetch(url, { headers: { Range: 'bytes=0-99' } });
  const buf = await res.arrayBuffer();
  log.line(`asked for bytes 0-99; got status ${res.status} and ${fmt.bytes(buf.byteLength)}`,
    res.status === 206 ? 'good' : 'bad');
  out.textContent =
    'The cache does not understand Range. cache.match() returns the whole stored 200 response for\n' +
    'a request that asked for a byte range, so a media element that expects a 206 gets a 200 with\n' +
    'the entire file.\n\n' +
    'Symptoms: <video> and <audio> that will not seek; Safari refusing to play at all (it requires\n' +
    'range support); memory spikes as the whole file is handed over for a 100-byte request.\n\n' +
    'Fix: either do not intercept range requests at all (check for a Range header and return\n' +
    'early), or slice the cached body yourself and construct a real 206 with Content-Range. The\n' +
    'first option is the right default — media is one of the few things the browser already\n' +
    'handles better than you will.';
});

// ---------------------------------------------------------------------------
// 3. Redirects
// ---------------------------------------------------------------------------

on('redirect', async () => {
  log.head('— redirect handling —');
  try {
    const res = await fetch(`/api/redirect?n=1&trap=redirect&to=${encodeURIComponent('/api/asset?name=redir&type=json')}`);
    log.line(`got: type ${res.type}, status ${res.status}, redirected ${res.redirected}`, 'macro');
  } catch (err) {
    log.bad(`${err.name}: ${err.message}`);
  }
  out.textContent =
    'Rules worth memorising:\n' +
    '  • responding to a NAVIGATION with a response whose `redirected` flag is true throws\n' +
    '    ("Response served by service worker has redirected response") and the navigation fails\n' +
    '  • redirect:"manual" gives you an opaqueredirect you cannot inspect and must not return\n' +
    '    for a non-navigation\n' +
    '  • a redirect during precaching silently stores the FINAL response under the ORIGINAL URL,\n' +
    '    which is usually what you want and occasionally very much not\n\n' +
    'The practical rule: if a request may redirect, let it pass through untouched, or re-issue it\n' +
    'yourself with redirect:"follow" and return the final response.';
});

// ---------------------------------------------------------------------------
// 4. A throwing handler
// ---------------------------------------------------------------------------

on('throw', async () => {
  log.head('— a bug inside respondWith —');
  try {
    await fetch('/api/asset?name=boom&type=json&trap=throw');
    log.ok('succeeded (unexpected)');
  } catch (err) {
    log.bad(`the page got: ${err.name}: ${err.message}`);
  }
  out.textContent =
    'A throw inside respondWith() becomes a network error for the page — for a request that would\n' +
    'have worked perfectly if your worker did not exist. Every fetch handler is a chance to break\n' +
    'requests that were previously fine.\n\n' +
    'Defensive shape for every handler you write:\n\n' +
    '  event.respondWith(\n' +
    '    handle(event).catch(err => { report(err); return fetch(event.request); })\n' +
    '  );\n\n' +
    'Falling back to the plain network means the worst case of a bug in your worker is "no\n' +
    'caching", not "the site is down". Ship that wrapper before you ship any strategy.';
});

// ---------------------------------------------------------------------------
// 5. Non-GET
// ---------------------------------------------------------------------------

on('post', async () => {
  log.head('— cache.put() on a POST —');
  await fetch('/api/asset?name=postcache&type=json&trap=post', { method: 'POST', body: '{}' })
    .then((r) => r.text()).catch((e) => log.bad(e.message));
  log.muted('The Cache API refuses non-GET requests by design: a cached POST response would be ' +
    'served for a request that was meant to change something. If you need to cache the RESULT of ' +
    'a POST (a GraphQL query, say), key it yourself: hash the body into a synthetic GET Request ' +
    'object and cache that — and be very sure the operation is a read.');
});

// ---------------------------------------------------------------------------
// 6. Bloat
// ---------------------------------------------------------------------------

on('bloat', async () => {
  log.head('— filling Cache Storage —');
  const before = await storageEstimate();
  log.muted(`before: ${before.usageFmt} of ${before.quotaFmt}`);
  navigator.serviceWorker.controller?.postMessage({
    type: 'bloat', count: Number($('count').value), mb: Number($('mb').value),
  });
  await new Promise((r) => {
    const h = (e) => { if (e.data?.type === 'bloatDone') { navigator.serviceWorker.removeEventListener('message', h); r(); } };
    navigator.serviceWorker.addEventListener('message', h);
  });
  const after = await storageEstimate();
  log.line(`after: ${after.usageFmt} of ${after.quotaFmt} (${(after.pct * 100).toFixed(1)}%)`,
    after.pct > 0.5 ? 'bad' : 'macro');
  out.textContent =
    'Cache Storage has no eviction policy of its own: no LRU, no TTL, no size cap. It grows until\n' +
    'you hit the quota, and then cache.put() starts throwing QuotaExceededError — usually inside\n' +
    'a background refresh, where nobody is catching it.\n\n' +
    'Worse: when the browser is under storage pressure it evicts ALL storage for an origin at\n' +
    'once — Cache Storage, IndexedDB, localStorage. Your "offline app" comes back empty and\n' +
    'logged out. See the browser-storage course for the eviction rules and navigator.storage.persist().\n\n' +
    'You must implement your own limits: max entries, max age, max bytes, evicted lazily on write.';
});

// ---------------------------------------------------------------------------
// 7. Kill switch
// ---------------------------------------------------------------------------

on('checkKill', () => navigator.serviceWorker.controller?.postMessage('checkKill'));

on('activateKill', async () => {
  await fetch('/api/bump?name=sw-kill-switch', { cache: 'no-store' });
  log.bad('server-side kill switch flipped. Now click "check the kill switch now" (or reload — ' +
    'the check also runs on activate).');
  out.textContent =
    'Why this exists: a service worker can serve a broken app shell from cache, on a device you\n' +
    'cannot reach, indefinitely. Normal deploys do not help, because the user never asks your\n' +
    'server for anything — the worker answers everything locally.\n\n' +
    'The kill switch is a small check the worker performs on activation (and periodically) against\n' +
    'an endpoint that is never cached. If the answer says "stop", the worker deletes its caches and\n' +
    'unregisters itself, and the next load is a plain, working website.\n\n' +
    'Design notes that matter:\n' +
    '  • FAIL OPEN. If the check itself fails (offline), keep working. A kill switch that fires on\n' +
    '    every network blip is worse than the bug it guards against.\n' +
    '  • the endpoint must be no-store, and must not be served by the worker itself\n' +
    '  • have a way to reload clients afterwards, or the user sits on the broken page until they\n' +
    '    navigate\n' +
    '  • test it BEFORE you need it. A kill switch you have never fired is a hypothesis.';
});

on('resetKill', async () => {
  await fetch('/api/reset', { cache: 'no-store' });
  log.ok('server counters and versions reset — the kill switch is off again');
});

on('clear', () => log.clear());

if (navigator.serviceWorker?.controller) log.ok('page is controlled');
