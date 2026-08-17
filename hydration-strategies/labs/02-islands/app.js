// Lab 02 — Islands.
//
// A ~40-line islands runtime with per-island code loading. The interesting property: the module
// for an island is not fetched until that island hydrates, so a page's JS cost becomes a sum of
// decisions rather than one bundle.

import { $, on, Log, renderTable, fmt, sleep } from '/shared/lab-ui.js';

PerfHUD.start({ note: 'islands lab' });

const log = new Log('#log');
const out = $('out');
const rows = [];

const loaded = new Set();

/** Hydrate one island: dynamically import its module, then run it against the existing DOM. */
async function hydrate(el, reason) {
  if (el.dataset.hydrated) return 0;
  const name = el.dataset.island;
  const t0 = performance.now();

  // The dynamic import IS the code-splitting boundary. One island's JS never blocks another's,
  // and an island that is never hydrated never downloads.
  const mod = await import(`./islands/${name}.js`);
  const downloadedAt = performance.now();

  const props = el.dataset.props ? JSON.parse(el.dataset.props) : {};
  mod.default(el, props);
  el.dataset.hydrated = '1';
  loaded.add(name);

  const bytes = transferOf(`islands/${name}.js`);
  log.line(`${name.padEnd(8)} hydrated (${reason}) — module ${fmt.bytes(bytes)}, ` +
    `download ${fmt.ms(downloadedAt - t0)}, init ${fmt.ms(performance.now() - downloadedAt)}`, 'good');
  return bytes;
}

function transferOf(part) {
  const e = performance.getEntriesByType('resource').filter((r) => r.name.includes(part)).at(-1);
  return e ? (e.transferSize || e.encodedBodySize || 0) : 0;
}

const islands = () => [...document.querySelectorAll('[data-island]')];

// ---------------------------------------------------------------------------

on('all', async () => {
  log.head('— hydrate all three immediately —');
  const t0 = performance.now();
  let bytes = 0;
  for (const el of islands()) bytes += await hydrate(el, 'eager');
  const ms = performance.now() - t0;

  rows.push({
    strategy: 'all three, eagerly',
    'islands hydrated': loaded.size,
    'JS bytes': fmt.bytes(bytes),
    'wall ms': Math.round(ms),
    'chart downloaded?': loaded.has('chart') ? 'yes' : 'no',
  });
  renderTable('#results', rows, {
    columns: ['strategy', 'islands hydrated', 'JS bytes', 'wall ms', 'chart downloaded?'],
  });

  out.textContent =
    'All three islands hydrated, including the 90KB chart that is 700px below the fold and may\n' +
    'never be seen.\n\n' +
    'This is the shape of a page that uses islands as a code-organisation idea but not as a\n' +
    'loading strategy: you have split the JS into modules and then downloaded all of them anyway.\n' +
    'The split only pays off when it is paired with a decision about WHEN — which is the next\n' +
    'button, and lab 03.';
});

on('selective', async () => {
  log.head('— counter eagerly · cart on idle · chart when visible —');
  const t0 = performance.now();
  let eagerBytes = 0;

  const [counter, cart, chart] = islands();

  // 1. The counter is above the fold and cheap: hydrate now.
  eagerBytes += await hydrate(counter, 'eager, above the fold');

  // 2. The cart is above the fold but not urgent: idle time.
  (globalThis.requestIdleCallback || setTimeout)(() => hydrate(cart, 'idle'), { timeout: 3000 });

  // 3. The chart is expensive and below the fold: only if it is seen.
  new IntersectionObserver((entries, obs) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      hydrate(e.target, 'became visible');
      obs.unobserve(e.target);
    }
  }, { rootMargin: '200px' }).observe(chart);

  await sleep(50);
  rows.push({
    strategy: 'selective (eager/idle/visible)',
    'islands hydrated': loaded.size,
    'JS bytes': fmt.bytes(eagerBytes),
    'wall ms': Math.round(performance.now() - t0),
    'chart downloaded?': loaded.has('chart') ? 'yes' : 'not yet',
  });
  renderTable('#results', rows, {
    columns: ['strategy', 'islands hydrated', 'JS bytes', 'wall ms', 'chart downloaded?'],
  });

  out.textContent =
    'Only the counter blocked anything. The cart arrives in idle time; the chart\'s 90KB has not\n' +
    'been requested at all — scroll down and watch it appear in the Network panel.\n\n' +
    'This is the property that makes islands worth the architectural cost: the critical path\n' +
    'contains only the islands that are both visible and urgent. Everything else is a decision you\n' +
    'get to make per component instead of per bundle.\n\n' +
    'What you gave up: a single shared framework instance. Which brings us to the awkward part —\n' +
    'press "test cross-island communication".';
});

on('none', () => location.reload());

on('talk', async () => {
  log.head('— how do islands talk to each other? —');
  const [counter, cart] = islands();
  if (!counter.dataset.hydrated || !cart.dataset.hydrated) {
    log.bad('hydrate the counter and the cart first (they need to exist to talk)');
    return;
  }

  counter.querySelector('[data-inc]').click();
  counter.querySelector('[data-inc]').click();
  await sleep(50);
  const cartValue = cart.querySelector('[data-value]').textContent;
  log.line(`clicked the counter twice → the cart island now says "${cartValue}"`,
    cartValue.startsWith('2') ? 'good' : 'bad');

  out.textContent =
    'The counter dispatched a CustomEvent; the cart listened on `document`. No shared bundle, no\n' +
    'shared framework instance, no provider tree.\n\n' +
    'This is the genuine cost of islands, and it is architectural rather than performance:\n' +
    'each island is a separate root. They cannot share a React context, a Vue provide/inject, a\n' +
    'store instance created in a parent, or a hook. Anything shared has to cross a boundary.\n\n' +
    'The options, in ascending order of power and coupling:\n' +
    '  1. DOM CustomEvents — zero dependencies, works between islands written in DIFFERENT\n' +
    '     frameworks, and the only channel that survives one island failing to load\n' +
    '  2. a shared store module imported by several islands (nanostores, signals, a tiny emitter).\n' +
    '     Now they share code — check that it is one shared chunk and not one copy per island,\n' +
    '     because a bundler will happily give you the latter\n' +
    '  3. URL / server state as the source of truth, with islands reading it independently. The\n' +
    '     most robust and the least fashionable\n\n' +
    'If your islands need to share a lot of state, that is a signal the boundary is in the wrong\n' +
    'place — either merge them into one island or move the state to the server.';
});
