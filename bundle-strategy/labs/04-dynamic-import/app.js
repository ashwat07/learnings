// Lab 04 — Dynamic import (measured against the real built output).

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const rows = [];

const DIST = '/bundle-strategy/dist';
const delay = () => Number($('net').value);

// The lab server adds ?delay= to any static file, so we can simulate a slow network per request
// without DevTools throttling — which would also slow this page's own code.
const withDelay = (url) => (delay() ? `${url}${url.includes('?') ? '&' : '?'}delay=${delay()}` : url);

const data = {
  products: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `Product ${i + 1}`, price: 40 + i * 15, updatedAt: Date.now() - i * 3.6e6 })),
  product: { id: 3, name: 'Product 3', price: 70, updatedAt: Date.now() - 5400e3 },
  stats: { total: 128000, owner: 'ada@example.com', series: Array.from({ length: 40 }, (_, i) => 20 + (i * 7) % 90) },
};

let loaded = null;

async function loadBuild(variant) {
  const t0 = performance.now();
  const url = withDelay(`${DIST}/${variant}/main.js?v=${Math.random()}`);
  try {
    await import(url);
  } catch (err) {
    log.bad(`could not load ${variant} — run: cd bundle-strategy && node build.mjs --all`);
    return;
  }
  const ms = performance.now() - t0;
  loaded = variant;
  const entry = performance.getEntriesByType('resource').filter((e) => e.name.includes(`/${variant}/main.js`)).at(-1);

  rows.push({
    action: `load ${variant}`,
    ms: Math.round(ms),
    bytes: entry ? fmt.bytes(entry.transferSize || entry.encodedBodySize) : '?',
    note: variant === 'single' ? 'everything, including the chart library' : 'entry + shared chunk only',
    _msClass: ms > 1000 ? 'no' : ms > 400 ? 'meh' : 'ok',
  });
  renderTable('#results', rows, { columns: ['action', 'ms', 'bytes', 'note'] });
  log.line(`${variant} loaded in ${fmt.ms(ms)}`, 'macro');
}

on('load-single', () => loadBuild('single'));
on('load-split', () => loadBuild('split'));

async function navigate(route) {
  if (!globalThis.__app) return log.bad('load a build first');
  const t0 = performance.now();
  await globalThis.__app.navigate(route, $('#app'), route === 'home' ? data.products
    : route === 'product' ? data.product : data.stats);
  const ms = performance.now() - t0;

  rows.push({
    action: `navigate: ${route}`,
    ms: Math.round(ms),
    bytes: '',
    note: route === 'admin' && loaded === 'split'
      ? (ms > 100 ? 'the lazy chunk was fetched now — the user waited' : 'chunk already cached')
      : 'code was already loaded',
    _msClass: ms > 300 ? 'no' : ms > 80 ? 'meh' : 'ok',
  });
  renderTable('#results', rows, { columns: ['action', 'ms', 'bytes', 'note'] });
  log.line(`navigate ${route}: ${fmt.ms(ms)}`, ms > 300 ? 'bad' : 'good');

  if (route === 'admin') {
    out.textContent = loaded === 'split'
      ? 'That number is what dynamic import costs the user: the click could not complete until the\n' +
        'chunk arrived.\n\n' +
        'With the network delay set to 1000ms it is a second of nothing happening after a click —\n' +
        'which is a worse experience than a slightly bigger initial download would have been.\n\n' +
        'Click admin again: it is instant, because the chunk is now in memory. The cost is paid\n' +
        'once, by whoever clicks first, and only by people who click at all.\n\n' +
        'Then try "prefetch the admin chunk now" and navigate again — that is the fix.'
      : 'Instant, because the single bundle already contained the admin route and its 80KB chart\n' +
        'library. Everyone paid for it at load time, including the majority who never open admin.';
  }
}

on('go-home', () => navigate('home'));
on('go-product', () => navigate('product'));
on('go-admin', () => navigate('admin'));

// Prefetch: fetch the chunk without executing it, so the click is instant.
on('prefetch', async () => {
  const t0 = performance.now();
  // A real app reads the chunk URL from its build manifest. Here we find it from the metafile.
  const meta = await (await fetch(`${DIST}/split/meta.json`)).json().catch(() => null);
  if (!meta) return log.bad('no metafile — run node build.mjs --variant=split');
  const chunk = Object.keys(meta.outputs).find((f) => f.includes('admin'));
  if (!chunk) return log.bad('no admin chunk found');

  const link = document.createElement('link');
  link.rel = 'modulepreload';
  link.href = withDelay(`/bundle-strategy/${chunk}`);
  document.head.append(link);

  await new Promise((r) => { link.onload = r; link.onerror = r; });
  log.ok(`prefetched ${chunk.split('/').pop()} in ${fmt.ms(performance.now() - t0)}`);
  out.textContent =
    'The chunk is now in the browser\'s module cache. Navigate to admin: it should be instant even\n' +
    'with a 1000ms network delay, because the download already happened.\n\n' +
    'Three ways to trigger this in a real app, in increasing order of how much you are guessing:\n' +
    '  • on INTENT — pointerover/focus on the link, or pointerdown. Buys 100–300ms and is almost\n' +
    '    always enough. This is the same idea as interaction-triggered hydration.\n' +
    '  • on IDLE — requestIdleCallback after the page settles, for the one or two routes most\n' +
    '    users go to next\n' +
    '  • on VIEWPORT — when a link to the route scrolls into view\n\n' +
    'Use <link rel="modulepreload"> rather than a bare import(): modulepreload fetches AND parses\n' +
    'the module and its dependencies without executing them, which is exactly the semantics you\n' +
    'want for speculation. A bare import() executes the module, with whatever side effects that has.';
});

on('reset', () => location.reload());
