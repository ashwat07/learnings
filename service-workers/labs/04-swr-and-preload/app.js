// Lab 04 — SWR & navigation preload (page side).

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const rows = [];

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'log') log.line(`[sw] ${e.data.msg}`, 'micro');
});

async function register(query) {
  const reg = await navigator.serviceWorker.register(`sw.js?${query}`, { scope: './' });
  await navigator.serviceWorker.ready;
  log.ok(`registered sw.js?${query}`);
  log.muted('reload the page to see the navigation effect — the boot cost is paid on navigation, ' +
    'not on this fetch');
  return reg;
}

on('register', () => register('np=0&boot=0&maxAge=8000').catch((e) => log.bad(e.message)));
on('registerBoot', () => register('np=0&boot=300&maxAge=8000').catch((e) => log.bad(e.message)));
on('registerPreload', () => register('np=1&boot=300&maxAge=8000').catch((e) => log.bad(e.message)));

on('unregister', async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  log.bad('unregistered and cleared');
});

// ---------------------------------------------------------------------------

const URL_ = '/api/asset?name=swr-data&type=json&delay=700&cc=no-store';

async function probe(label) {
  const t0 = performance.now();
  const res = await fetch(URL_);
  const body = await res.json();
  const wall = performance.now() - t0;
  const source = res.headers.get('x-sw-source') || '(not intercepted)';
  const age = res.headers.get('x-sw-age-ms');
  rows.push({
    request: label,
    ms: Math.round(wall),
    'data version': body.version,
    'served by': source,
    'age ms': age ? Math.round(Number(age)) : '–',
    _servedClass: source.startsWith('cache') ? 'ok' : 'meh',
  });
  renderTable('#results', rows, { columns: ['request', 'ms', 'data version', 'served by', 'age ms'] });
  log.line(`${fmt.ms(wall).padStart(8)}  v${body.version}  ${source}`,
    source.startsWith('cache') ? 'good' : 'macro');
}

on('swr', async () => {
  await probe(`fetch #${rows.length + 1}`);
  out.textContent =
    'Click it repeatedly and watch the columns:\n' +
    '  1st  → network-miss, ~700ms (nothing cached yet)\n' +
    '  2nd+ → cache-fresh, ~1ms\n' +
    '  after maxAge → cache-stale-revalidating: still ~1ms, and a background refresh fires\n\n' +
    'Now click "change the data on the server", then fetch twice. The first fetch still returns\n' +
    'the OLD version instantly (that is the trade: exactly one caller sees stale data) and the\n' +
    'second returns the new one.\n\n' +
    'The x-cached-at header is doing the work here. The Cache API stores Responses and no\n' +
    'metadata, so "how old is this entry" is a question you have to answer yourself by writing a\n' +
    'timestamp into the stored copy.';
});

on('burst', async () => {
  log.head('— 10 simultaneous fetches of the same stale URL —');
  const t0 = performance.now();
  await Promise.all(Array.from({ length: 10 }, () => fetch(URL_).then((r) => r.json())));
  log.ok(`10 fetches in ${fmt.ms(performance.now() - t0)} — check the log: exactly ONE background ` +
    'refresh should have run');
  out.textContent =
    'Ten components asking for the same stale resource in one tick. Without coalescing that is ten\n' +
    'identical network requests — a self-inflicted thundering herd that gets worse the more\n' +
    'components you add.\n\n' +
    'The fix is twelve lines: a Map from URL to in-flight promise, cleared in .finally(). It is the\n' +
    'same pattern as the SWR fetch wrapper in the caching course, and you should have it in every\n' +
    'data layer you write.';
});

on('bump', async () => {
  await fetch('/api/bump?name=swr-data', { cache: 'no-store' });
  log.bad('server data bumped — the next SWR read still returns the old copy, the one after is new');
});

on('clearCache', () => navigator.serviceWorker.controller?.postMessage('clearCache'));

on('navTiming', () => {
  const nav = performance.getEntriesByType('navigation')[0];
  const rows2 = [{
    'workerStart': Math.round(nav.workerStart),
    'fetchStart': Math.round(nav.fetchStart),
    'SW boot cost': Math.round(nav.fetchStart - nav.workerStart),
    'responseStart': Math.round(nav.responseStart),
    'responseEnd': Math.round(nav.responseEnd),
    'domContentLoaded': Math.round(nav.domContentLoadedEventEnd),
  }];
  renderTable('#results', rows2, {
    columns: ['workerStart', 'fetchStart', 'SW boot cost', 'responseStart', 'responseEnd', 'domContentLoaded'],
  });
  out.textContent =
    'workerStart is when the browser began starting the service worker for this navigation;\n' +
    'fetchStart is when the request actually began. The gap is the worker\'s startup cost, and\n' +
    'every controlled navigation pays it — including ones where your fetch handler does nothing.\n\n' +
    'On a mid-range phone a real worker costs 50–250ms to boot (process start, script parse,\n' +
    'top-level code). With the 300ms simulated boot registered, you should see a large gap here.\n\n' +
    'Navigation preload fixes exactly this: the browser starts the navigation request in PARALLEL\n' +
    'with booting the worker, and hands it to you as event.preloadResponse. Register the preload\n' +
    'variant, reload, and compare the numbers.\n\n' +
    'Two rules that come with it:\n' +
    '  • if you enable it you MUST use event.preloadResponse, or you have made a request for\n' +
    '    nothing (the browser warns)\n' +
    '  • it only applies to navigations, and it sends a Service-Worker-Navigation-Preload header\n' +
    '    the server can use to send a lighter response';
});

on('clear', () => { log.clear(); rows.length = 0; $('#results').textContent = ''; });

if (navigator.serviceWorker?.controller) log.ok('page is controlled');
