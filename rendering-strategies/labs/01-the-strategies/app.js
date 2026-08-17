// Lab 01 — The seven strategies.

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const MODES = [
  ['csr', 'a shell + JS. HTML → JS → data → paint'],
  ['ssr', 'per request, data fetched sequentially'],
  ['ssr-par', 'per request, data fetched in parallel'],
  ['ssg', 'rendered once, cached forever'],
  ['isr', 'cached, refreshed in the background'],
  ['stream', 'shell first, slow sections later'],
  ['rsc', 'a serialised tree, rendered by the client'],
];

function renderLinks() {
  const route = $('route').value;
  $('#links').innerHTML = MODES.map(([mode, note]) =>
    `<a href="/render/${mode}/${route}" target="_blank"><b>${mode}</b><span>${note}</span></a>`).join('');
}
on($('route'), 'change', renderLinks);
renderLinks();

/**
 * Measure what the page can measure about another page: when the first byte arrived, when the
 * last byte arrived, and how big it was.
 *
 * Streaming is why the two timings must be separate. A single "how long did it take" number
 * cannot distinguish "the server thought for 900ms then sent everything" from "the server sent
 * the shell immediately and finished at 900ms" — and that distinction is the entire point of
 * this lab.
 */
async function probe(mode, route) {
  const url = `/render/${mode}/${route}${route ? '' : ''}`;
  const t0 = performance.now();
  const res = await fetch(url, { cache: 'no-store' });
  const ttfb = performance.now() - t0;

  // Read the body as a stream so we can see when the FIRST chunk of HTML lands versus the last.
  const reader = res.body.getReader();
  let bytes = 0;
  let firstChunkAt = null;
  let chunks = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstChunkAt === null) firstChunkAt = performance.now() - t0;
    bytes += value.length;
    chunks++;
  }
  const lastByteAt = performance.now() - t0;

  return {
    mode,
    'TTFB ms': Math.round(ttfb),
    'first HTML ms': Math.round(firstChunkAt ?? ttfb),
    'last byte ms': Math.round(lastByteAt),
    'HTML bytes': bytes,
    chunks,
    'render ms (server)': res.headers.get('x-render-ms') ?? '–',
    cache: res.headers.get('x-cache') ?? '–',
  };
}

on('measure', async () => {
  const route = $('route').value;
  log.clear();
  log.head(`— measuring /render/*/${route || '(listing)'} —`);
  const rows = [];
  for (const [mode] of MODES) {
    const row = await probe(mode, route);
    rows.push(row);
    renderTable('#results', rows, {
      columns: ['mode', 'TTFB ms', 'first HTML ms', 'last byte ms', 'HTML bytes', 'chunks', 'cache'],
    });
    log.line(`${mode.padEnd(9)} ttfb ${String(row['TTFB ms']).padStart(5)}ms  ` +
      `last byte ${String(row['last byte ms']).padStart(5)}ms  ${fmt.bytes(row['HTML bytes'])}  ` +
      `${row.chunks} chunk(s)`,
      row['TTFB ms'] < 100 ? 'good' : row['TTFB ms'] > 1000 ? 'bad' : 'macro');
  }

  const ssr = rows.find((r) => r.mode === 'ssr');
  const par = rows.find((r) => r.mode === 'ssr-par');
  const stream = rows.find((r) => r.mode === 'stream');
  const csr = rows.find((r) => r.mode === 'csr');

  out.textContent =
    'Read the table as three separate findings.\n\n' +
    `1. ssr ${ssr['TTFB ms']}ms vs ssr-par ${par['TTFB ms']}ms. Identical HTML. The difference is\n` +
    '   three awaits in a row with no data dependency between them — the most common SSR bug\n' +
    '   there is, and invisible in code review because the code looks clean. Lab 02.\n\n' +
    `2. stream: first byte at ${stream['TTFB ms']}ms, last at ${stream['last byte ms']}ms, in\n` +
    `   ${stream.chunks} chunks. Same total work as ssr-par, but the browser had markup to parse\n` +
    '   almost immediately. TTFB and "when is the data ready" have been decoupled. Lab 03.\n\n' +
    `3. csr: ${fmt.bytes(csr['HTML bytes'])} of HTML, delivered instantly — and nothing to paint.\n` +
    '   The work did not disappear; it moved to the user\'s device, behind a JS download. A small\n' +
    '   HTML payload is not a fast page, and this table cannot show you that. The corner scoreboard\n' +
    '   on the actual page can.\n\n' +
    'Now open all seven, hard-reload each, and fill in FCP / LCP / TBT from the corner box. That\n' +
    'is the half of the comparison that only a real navigation produces.';
});

on('reset', async () => {
  await fetch('/api/render?invalidate=1');
  await fetch('/api/render?resetCalls=1');
  log.ok('route cache cleared and call counters reset — ssg/isr will render fresh');
});
