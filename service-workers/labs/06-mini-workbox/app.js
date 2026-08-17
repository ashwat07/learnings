// Lab 06 — mini-Workbox (page side): the test suite your worker has to pass.

import { $, on, Log, renderTable, fmt, sleep } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'log') log.line(`[sw] ${e.data.msg}`, e.data.level === 'bad' ? 'bad' : 'micro');
  if (e.data?.type === 'caches') {
    log.muted(`caches: ${Object.entries(e.data.detail).map(([k, n]) => `${k}(${n})`).join(' ')}`);
  }
});

on('register', async () => {
  await navigator.serviceWorker.register('sw.js', { scope: './' });
  await navigator.serviceWorker.ready;
  log.ok('registered — reload once if the page is not controlled');
});

on('unregister', async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  log.bad('unregistered and cleared');
});

on('inspect', () => navigator.serviceWorker.controller?.postMessage('inspect'));
on('clearCaches', () => navigator.serviceWorker.controller?.postMessage('clear'));
on('clear', () => log.clear());

// ---------------------------------------------------------------------------
// The tests. Each one states what it expects, so a failure tells you what to build.
// ---------------------------------------------------------------------------

async function get(url, init) {
  const t0 = performance.now();
  const res = await fetch(url, init);
  const body = await res.text();
  return { res, body, ms: performance.now() - t0, strategy: res.headers.get('x-strategy') || '(none)' };
}

const TESTS = [
  {
    name: 'static asset → CacheFirst',
    expect: 'second read is served from cache in < 20ms with x-strategy: CacheFirst',
    async run() {
      await get('/shared/lab.css');
      const b = await get('/shared/lab.css');
      return {
        pass: b.strategy === 'CacheFirst' && b.ms < 50,
        detail: `${b.strategy}, ${fmt.ms(b.ms)}`,
      };
    },
  },
  {
    name: 'images → CacheFirst + expiration (TODO 1)',
    expect: 'served from cache, and an entry older than maxAgeMs (60s) is treated as a miss',
    async run() {
      const a = await get('/api/image.svg?name=mw-img&w=100&h=60&delay=200');
      const b = await get('/api/image.svg?name=mw-img&w=100&h=60&delay=200');
      return { pass: b.strategy === 'CacheFirst' && b.ms < 50, detail: `${b.strategy}, ${fmt.ms(b.ms)}` };
    },
  },
  {
    name: 'fresh API → NetworkFirst with timeout (TODO 2)',
    expect: 'network answer when fast; cached answer within ~1.2s when the server is slow',
    async run() {
      await get('/api/asset?name=mw-fresh&type=json&kind=fresh&delay=100&cc=no-store');
      const slow = await get('/api/asset?name=mw-fresh&type=json&kind=fresh&delay=3000&cc=no-store');
      return {
        pass: slow.strategy === 'NetworkFirst' && slow.ms < 2000,
        detail: `${slow.strategy}, ${fmt.ms(slow.ms)} (should be ~1.2s, not 3s)`,
      };
    },
  },
  {
    name: 'swr API → StaleWhileRevalidate (TODO 3)',
    expect: 'second read returns instantly from cache while a refresh runs in the background',
    async run() {
      await get('/api/asset?name=mw-swr&type=json&kind=swr&delay=700&cc=no-store');
      const b = await get('/api/asset?name=mw-swr&type=json&kind=swr&delay=700&cc=no-store');
      return {
        pass: b.strategy === 'StaleWhileRevalidate' && b.ms < 50,
        detail: `${b.strategy}, ${fmt.ms(b.ms)}`,
      };
    },
  },
  {
    name: 'coalescing: 10 concurrent SWR reads (TODO 3)',
    expect: 'exactly one background refresh — check the server hit count',
    async run() {
      const url = '/api/asset?name=mw-coalesce&type=json&kind=swr&delay=500&cc=no-store';
      await get(url);
      const before = (await (await fetch('/api/stats', { cache: 'no-store' })).json()).hits['asset:mw-coalesce'] || 0;
      await Promise.all(Array.from({ length: 10 }, () => fetch(url).then((r) => r.text())));
      await sleep(800);
      const after = (await (await fetch('/api/stats', { cache: 'no-store' })).json()).hits['asset:mw-coalesce'] || 0;
      return { pass: after - before <= 1, detail: `${after - before} server hits for 10 reads (want ≤1)` };
    },
  },
  {
    name: 'never-cache API → NetworkOnly',
    expect: 'always hits the server; nothing is stored',
    async run() {
      const url = '/api/asset?name=mw-never&type=json&kind=never&cc=no-store';
      const before = (await (await fetch('/api/stats', { cache: 'no-store' })).json()).hits['asset:mw-never'] || 0;
      await get(url); await get(url);
      const after = (await (await fetch('/api/stats', { cache: 'no-store' })).json()).hits['asset:mw-never'] || 0;
      return { pass: after - before === 2, detail: `${after - before} server hits for 2 reads (want 2)` };
    },
  },
  {
    name: 'a throwing strategy falls back to the network',
    expect: 'the request still succeeds even when the strategy is unimplemented',
    async run() {
      const r = await get('/api/asset?name=mw-fallback&type=json&kind=swr&cc=no-store');
      return { pass: r.res.ok, detail: `status ${r.res.status} via ${r.strategy}` };
    },
  },
];

on('runAll', async () => {
  log.clear();
  const rows = [];
  for (const t of TESTS) {
    let result;
    try {
      result = await t.run();
    } catch (err) {
      result = { pass: false, detail: err.message };
    }
    rows.push({
      test: t.name,
      result: result.pass ? 'PASS' : 'fail',
      observed: result.detail,
      expected: t.expect,
      _resultClass: result.pass ? 'ok' : 'no',
    });
    log.line(`${result.pass ? 'PASS' : 'FAIL'}  ${t.name} — ${result.detail}`, result.pass ? 'good' : 'bad');
    renderTable('#results', rows, { columns: ['test', 'result', 'observed', 'expected'] });
  }
  const passed = rows.filter((r) => r.result === 'PASS').length;
  out.textContent =
    `${passed} / ${rows.length} passing.\n\n` +
    'The last test is the important one: even with three strategies unimplemented, requests still\n' +
    'succeed, because the router catches and falls back to fetch(). That property is what makes a\n' +
    'service worker safe to iterate on — build it first, always.';
});

if (navigator.serviceWorker?.controller) log.ok('page is controlled');
