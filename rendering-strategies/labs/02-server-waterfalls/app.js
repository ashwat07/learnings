// Lab 02 — Server waterfalls.

import { $, on, Log, renderTable, renderBars, fmt, sleep } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const rows = [];

const delays = () =>
  `productDelay=${$('d-product').value}&recommendsDelay=${$('d-recommends').value}` +
  `&reviewsDelay=${$('d-reviews').value}`;

/**
 * Read the server's own breakdown out of the Server-Timing header.
 *
 * The browser parses it for you and exposes it on the resource timing entry, so a page (or your
 * RUM) can attribute a slow TTFB to a specific query without log access. `Timing-Allow-Origin`
 * is required cross-origin — the lab server sends it.
 */
async function probe(mode) {
  const url = `/render/${mode}/product/3?${delays()}&t=${Math.random()}`;
  const t0 = performance.now();
  const res = await fetch(url, { cache: 'no-store' });
  await res.text();
  const wall = performance.now() - t0;
  await sleep(20);

  const entry = performance.getEntriesByType('resource').filter((e) => e.name.includes(url))[0];
  const fromHeader = (res.headers.get('server-timing') || '')
    .split(',')
    .map((part) => {
      const [name, ...rest] = part.split(';');
      const dur = Number((rest.find((r) => r.trim().startsWith('dur=')) || 'dur=0').split('=')[1]);
      return { name: name.trim(), dur };
    })
    .filter((m) => m.name);

  return { mode, wall, marks: fromHeader, entry };
}

on('compare', async () => {
  log.clear();
  rows.length = 0;
  const sum = ['product', 'recommends', 'reviews'].reduce((a, k) => a + Number($(`d-${k}`).value), 0);
  const max = Math.max(...['product', 'recommends', 'reviews'].map((k) => Number($(`d-${k}`).value)));
  log.head(`— sum of delays ${sum}ms · slowest single delay ${max}ms —`);

  for (const mode of ['ssr', 'ssr-par', 'stream']) {
    const r = await probe(mode);
    const total = r.marks.find((m) => m.name === 'total')?.dur ?? r.wall;
    rows.push({
      mode,
      'server total ms': Math.round(total),
      'wall ms': Math.round(r.wall),
      'sum of queries': sum,
      'slowest query': max,
      verdict: total > sum * 0.9 ? 'sequential — a waterfall'
        : total > max * 1.5 ? 'partly parallel'
          : 'parallel — bounded by the slowest query',
      _verdictClass: total > sum * 0.9 ? 'no' : 'ok',
    });
    renderTable('#results', rows, {
      columns: ['mode', 'server total ms', 'wall ms', 'sum of queries', 'slowest query', 'verdict'],
    });
    log.line(`${mode.padEnd(9)} server total ${Math.round(total)}ms`, total > sum * 0.9 ? 'bad' : 'good');
  }

  out.textContent =
    `The arithmetic is the whole lesson:\n\n` +
    `  sequential ≈ SUM of every query    (${sum}ms here)\n` +
    `  parallel   ≈ MAX of every query    (${max}ms here)\n\n` +
    'Same data, same HTML, same server. The difference is `await` on three lines instead of one\n' +
    'Promise.all — and it gets worse with every data source someone adds, which is why a page\n' +
    'that was fine last quarter is 3 seconds now.\n\n' +
    'The rule from the event-loop course applies verbatim here: two awaits in a row with no data\n' +
    'dependency between them is a bug. On the server it is a TTFB bug, and no amount of frontend\n' +
    'work can hide it — the browser has nothing to do but wait.';
});

on('waterfall', async () => {
  const r = await probe('ssr');
  const p = await probe('ssr-par');
  log.head('— the same three queries, two shapes —');

  // Reconstruct start offsets: sequential marks run back to back; parallel ones all start at ~0.
  let cursor = 0;
  const seqBars = r.marks.filter((m) => m.name !== 'total').map((m) => {
    const bar = { label: `ssr ${m.name}`, value: m.dur, offset: cursor, cls: 'bad', text: `${Math.round(m.dur)}ms` };
    cursor += m.dur;
    return bar;
  });
  const parBars = p.marks.filter((m) => m.name !== 'total').map((m) => ({
    label: `par ${m.name}`, value: m.dur, offset: 0, cls: 'good', text: `${Math.round(m.dur)}ms`,
  }));

  renderBars('#bars', [...seqBars, { label: '—', value: 0, offset: 0, text: '' }, ...parBars]);
  log.muted('Top three bars: sequential, each starting where the last ended. Bottom three: ' +
    'parallel, all starting at zero.');
  out.textContent =
    'This is a Server-Timing header rendered as a chart, and it is worth building for real:\n\n' +
    '  Server-Timing: db;dur=42, cache;dur=3, render;dur=18, total;dur=71\n\n' +
    'Emit it from every server-rendered response. Then:\n' +
    '  • DevTools shows it in the Network panel\'s Timing tab, under "Server Timing"\n' +
    '  • PerformanceResourceTiming.serverTiming exposes it to your RUM\n' +
    '  • a frontend engineer can attribute a slow TTFB without asking for log access\n\n' +
    'Do not put anything secret in it — it is visible to anyone. Names and durations only.';
});

on('nplus1', async () => {
  log.head('— the N+1, on the server —');
  // The listing needs 12 products. A naive implementation fetches each product's detail
  // separately: one query for the list, then one per row.
  const t0 = performance.now();
  const { products } = await (await fetch('/api/data/products?delay=300')).json();
  const listOnly = performance.now() - t0;

  const t1 = performance.now();
  for (const p of products.slice(0, 6)) {
    await fetch(`/api/data/product/${p.id}?delay=60`).then((r) => r.json());   // sequential N+1
  }
  const sequentialN = performance.now() - t1;

  const t2 = performance.now();
  await Promise.all(products.slice(0, 6).map((p) =>
    fetch(`/api/data/product/${p.id}?delay=60`).then((r) => r.json())));
  const parallelN = performance.now() - t2;

  renderTable('#results', [
    { shape: 'list query only', ms: Math.round(listOnly), note: 'what the page needs' },
    { shape: 'list + 6 sequential detail queries', ms: Math.round(listOnly + sequentialN), note: 'the N+1' },
    { shape: 'list + 6 parallel detail queries', ms: Math.round(listOnly + parallelN), note: 'still N+1, just concurrent' },
  ], { columns: ['shape', 'ms', 'note'] });
  rows.length = 0;

  out.textContent =
    'Parallelising an N+1 makes it faster and does not make it right: you have gone from N round\n' +
    'trips to one round trip and N times the load on your database, and it will fall over under\n' +
    'traffic rather than under latency.\n\n' +
    'The fix order is always:\n' +
    '  1. do not make the query (does the listing really need per-row detail?)\n' +
    '  2. batch it (one query with an IN clause, or a DataLoader-style batcher)\n' +
    '  3. cache it (per request first — see the deduplication demo — then across requests)\n' +
    '  4. only then parallelise what is left\n\n' +
    'This is the same hierarchy as the browser side: delete the work, batch the work, cache the\n' +
    'work, then move the work.';
});

on('dedupe', async () => {
  log.head('— request deduplication within one render —');
  await fetch('/api/render?resetCalls=1');

  // Four components on one page each ask for the same product. Without dedup, that is four
  // identical queries per render.
  const naive = await Promise.all(Array.from({ length: 4 }, () =>
    fetch('/api/data/product/3?delay=200').then((r) => r.json())));
  const after = await (await fetch('/api/data/calls')).json();

  log.line(`4 components asked for product 3 → the data layer was called ${after.calls.product} time(s)`,
    after.calls.product > 1 ? 'bad' : 'good');

  // The fix, in eight lines: a per-request promise cache.
  const memo = new Map();
  const getProduct = (id) => {
    if (!memo.has(id)) memo.set(id, fetch(`/api/data/product/${id}?delay=200`).then((r) => r.json()));
    return memo.get(id);
  };
  await fetch('/api/render?resetCalls=1');
  await Promise.all(Array.from({ length: 4 }, () => getProduct(3)));
  const deduped = await (await fetch('/api/data/calls')).json();
  log.line(`with a per-request memo → ${deduped.calls.product} call(s)`, 'good');

  out.textContent =
    'Four components needing the same data is normal and good — it is what lets a component own\n' +
    'its own data requirements instead of threading props through six layers. What is not normal\n' +
    'is four queries.\n\n' +
    'The fix is a Map from cache key to the in-flight PROMISE, scoped to one request:\n\n' +
    '    const memo = new Map();\n' +
    '    const get = (k) => memo.get(k) ?? (memo.set(k, fetch(k)), memo.get(k));\n\n' +
    'Note it caches the promise, not the value — that is what deduplicates concurrent callers\n' +
    'rather than only sequential ones. It is the same pattern as the SWR coalescing map in the\n' +
    'caching course, and it is exactly what Next.js calls "request memoization" (see the\n' +
    'nextjs-caching course, lab 01) and what React\'s cache() does.\n\n' +
    'Scope matters: per REQUEST, not global. A global memo on the server is a cross-user data\n' +
    'leak waiting for a bug — user A\'s data served to user B.';
});

on('clear', () => { log.clear(); rows.length = 0; renderTable('#results', rows); $('#bars').textContent = ''; });
