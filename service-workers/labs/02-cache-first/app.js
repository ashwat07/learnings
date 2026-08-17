// Lab 02 — cache first (page side).

import { $, on, Log, renderTable, fmt, sleep } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const cachesBox = $('#caches');

navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'log') log.line(`[sw v${e.data.version}] ${e.data.msg}`,
    e.data.msg.startsWith('HIT') ? 'good' : e.data.msg.startsWith('MISS') ? 'macro' : 'micro');
  if (e.data?.type === 'caches') {
    cachesBox.textContent = Object.entries(e.data.detail)
      .map(([k, urls]) => `${k}\n${urls.map((u) => `  ${u}`).join('\n')}`)
      .join('\n\n') || '(empty)';
  }
});

async function register(v) {
  const url = v ? `sw.js?v=${v}` : 'sw.js';
  const reg = await navigator.serviceWorker.register(url, { scope: './' });
  log.ok(`registered ${url}`);
  await navigator.serviceWorker.ready;
  log.muted('worker is active. If this page is still uncontrolled, reload once.');
  return reg;
}

on('register', () => register().catch((e) => log.bad(e.message)));
on('deploy2', () => register(2).catch((e) => log.bad(e.message)));
on('deploy3', () => register(3).catch((e) => log.bad(e.message)));

on('inspect', () => {
  navigator.serviceWorker.controller?.postMessage('inspect');
  if (!navigator.serviceWorker.controller) log.bad('page is not controlled — reload first');
});

on('unregister', async () => {
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  cachesBox.textContent = '';
  log.bad('unregistered and cleared all caches');
});

// ---------------------------------------------------------------------------
// Measuring the win
// ---------------------------------------------------------------------------

const SHELL = [
  '/shared/lab.css',
  '/shared/lab-ui.js',
  '/api/asset?name=shell-logo&type=svg&cc=max-age%3D3600&v=1',
  '/api/asset?name=shell-config&type=json&cc=max-age%3D3600&v=1',
];

on('measure', async () => {
  log.head('— loading the shell 3× —');
  const rows = [];
  for (const pass of [1, 2, 3]) {
    const t0 = performance.now();
    await Promise.all(SHELL.map((u) => fetch(u).then((r) => r.text())));
    const wall = performance.now() - t0;
    rows.push({ pass, 'wall ms': Number(wall.toFixed(1)), controlled: navigator.serviceWorker.controller ? 'yes' : 'NO' });
    log.line(`pass ${pass}: ${fmt.ms(wall)}`, wall < 20 ? 'good' : 'macro');
    await sleep(200);
  }
  renderTable('#results', rows, { columns: ['pass', 'wall ms', 'controlled'] });
  out.textContent =
    'With the worker in control, these come out of Cache Storage: no network, no revalidation,\n' +
    'and it works with the network unplugged. That is the ceiling — you cannot beat "already\n' +
    'have the bytes".\n\n' +
    'Compare with the HTTP cache: a fresh HTTP cache entry is also 0ms, so cache-first in a\n' +
    'service worker is not automatically faster. What it adds is CONTROL — it works offline, it\n' +
    'survives cache eviction differently, and you decide the policy per URL in code rather than\n' +
    'hoping every intermediary honours your headers.';
});

on('offline', () => {
  out.textContent =
    'Do this by hand — it is the only honest test:\n\n' +
    '  1. DevTools → Network → Offline (or the Service Workers panel\'s Offline checkbox)\n' +
    '  2. Reload this page.\n\n' +
    'The shell should render: HTML, CSS, JS and the two precached API responses all come from\n' +
    'Cache Storage. Anything NOT precached will fail — watch which parts of the page go missing.\n' +
    'That gap is your real offline story, and it is always smaller than people assume.\n\n' +
    'Then try navigating to ../01-lifecycle/ while offline: it fails, because that path is\n' +
    'outside this worker\'s scope and nothing precached it. Scope is a boundary for offline too.';
  log.muted('follow the instructions in the readout');
});

on('stale', async () => {
  log.head('— the staleness trap —');
  const url = '/api/asset?name=trap-stale&type=json&strategy=cache-first';
  const first = await fetch(url).then((r) => r.json());
  log.line(`first fetch → version ${first.version}`, 'macro');

  await fetch(`/api/bump?name=trap-stale`, { cache: 'no-store' });
  log.bad('server content bumped to v2');

  const second = await fetch(url).then((r) => r.json());
  log.line(`second fetch → version ${second.version}` +
    (second.version === first.version ? '  ← STALE, and it will never update' : ''),
    second.version === first.version ? 'bad' : 'good');

  out.textContent =
    'Cache-first on a URL whose content can change means the user is frozen at whatever they got\n' +
    'first — forever, or until the cache is deleted. There is no revalidation, no expiry, no\n' +
    'mechanism at all.\n\n' +
    'That is fine for /app.a1b2c3.js and catastrophic for /api/products. The rule is identical to\n' +
    'the HTTP caching course: cache-first requires that the URL is content-addressed. If you\n' +
    'cannot guarantee that, you need network-first (Lab 03) or SWR (Lab 04).\n\n' +
    'The one extra escape hatch a service worker gives you: cache expiry logic you write yourself\n' +
    '— store a timestamp alongside the entry and treat old entries as misses. That is what the\n' +
    'expiration plugin in Workbox does, and it is Lab 06.';
});

on('clear', () => log.clear());

if (navigator.serviceWorker?.controller) {
  log.ok('this page is already controlled');
  navigator.serviceWorker.controller.postMessage('inspect');
}
