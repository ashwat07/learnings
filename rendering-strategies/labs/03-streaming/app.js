// Lab 03 — Streaming.

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const delays = () =>
  `recommendsDelay=${$('d-recommends').value}&reviewsDelay=${$('d-reviews').value}`;

/**
 * Read a response as a stream and record every chunk with its arrival time.
 *
 * This is the only honest way to observe streaming from a page: the Network panel shows one row
 * with one duration, and `await res.text()` waits for the whole body — both hide the fact that
 * usable markup arrived 1.4 seconds before the response finished.
 */
async function readChunks(url, onChunk) {
  const t0 = performance.now();
  const res = await fetch(url, { cache: 'no-store' });
  const ttfb = performance.now() - t0;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const chunks = [];

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const at = performance.now() - t0;
    const text = decoder.decode(value, { stream: true });
    const chunk = { at, bytes: value.length, text };
    chunks.push(chunk);
    onChunk?.(chunk);
  }
  return { ttfb, chunks, total: performance.now() - t0 };
}

function describe(text) {
  const slot = text.match(/data-slot="([a-z]+)"/);
  if (slot) return `flush → slot "${slot[1]}"`;
  if (text.includes('<!doctype')) return 'the shell: <head>, header, skeletons';
  if (text.includes('</body>')) return 'the tail: </body></html>';
  return text.trim().slice(0, 60).replace(/\s+/g, ' ') || '(whitespace)';
}

on('watch', async () => {
  $('#chunks').textContent = '';
  log.clear();
  log.head(`— streaming /render/stream/product/3 with ${delays()} —`);

  const rows = [];
  const result = await readChunks(`/render/stream/product/3?${delays()}&t=${Math.random()}`, (chunk) => {
    const row = document.createElement('div');
    row.innerHTML = `<span class="t">${Math.round(chunk.at)}ms</span>` +
      `<span class="b">${chunk.bytes}B</span><span class="c"></span>`;
    row.lastChild.textContent = describe(chunk.text);
    $('#chunks').append(row);
    rows.push({ 'at ms': Math.round(chunk.at), bytes: chunk.bytes, content: describe(chunk.text) });
  });

  log.ok(`TTFB ${fmt.ms(result.ttfb)} · ${result.chunks.length} chunks · complete at ${fmt.ms(result.total)}`);

  out.textContent =
    `First byte at ${Math.round(result.ttfb)}ms. Response complete at ${Math.round(result.total)}ms.\n` +
    `${result.chunks.length} chunks.\n\n` +
    'Read the chunk list top to bottom — that is the page being built in front of the user:\n\n' +
    '  1. the shell arrives immediately: <head> (so CSS and JS start downloading NOW), the header,\n' +
    '     and a skeleton for each slow region\n' +
    '  2. each slow section arrives as its query resolves, IN COMPLETION ORDER — not document\n' +
    '     order. product (200ms) can arrive before recommends (600ms) before reviews\n' +
    '  3. the tail closes the document\n\n' +
    'The critical detail is point 1: the browser got <head> in the first chunk, so the stylesheet\n' +
    'and script requests started while the server was still waiting on the database. In blocking\n' +
    'SSR those requests cannot even begin until the whole page is ready. Streaming does not just\n' +
    'improve TTFB — it un-blocks the browser\'s own resource discovery.';
});

on('compare', async () => {
  log.clear();
  log.head('— streaming vs blocking, same queries —');
  const rows = [];

  for (const mode of ['ssr-par', 'stream']) {
    const r = await readChunks(`/render/${mode}/product/3?${delays()}&t=${Math.random()}`);
    // "Usable" = the first chunk that contains real markup, not just headers.
    const firstMarkup = r.chunks.find((c) => c.text.includes('<main') || c.text.includes('<article'));
    rows.push({
      mode,
      'TTFB ms': Math.round(r.ttfb),
      'first markup ms': Math.round(firstMarkup?.at ?? r.total),
      'complete ms': Math.round(r.total),
      chunks: r.chunks.length,
    });
    log.line(`${mode.padEnd(9)} ttfb ${Math.round(r.ttfb)}ms · complete ${Math.round(r.total)}ms · ` +
      `${r.chunks.length} chunk(s)`, mode === 'stream' ? 'good' : 'bad');
  }
  renderTable('#results', rows, { columns: ['mode', 'TTFB ms', 'first markup ms', 'complete ms', 'chunks'] });

  out.textContent =
    'Identical total time. Wildly different experience, and three separate wins:\n\n' +
    '  TTFB      — the shell does not wait for data\n' +
    '  discovery — <head> arrives early, so CSS/JS/fonts start downloading early\n' +
    '  perception — the user sees the product while the reviews are still loading\n\n' +
    'And one cost: the response is chunked, so you cannot set a Content-Length, you cannot change\n' +
    'your mind about the status code or headers after the first flush, and a crash halfway through\n' +
    'leaves a half-written page. That last one is the real operational cost of streaming — error\n' +
    'handling has to move into the page (a slot that renders an error) because the response has\n' +
    'already committed to being a 200.';
});

on('clear', () => { log.clear(); $('#chunks').textContent = ''; $('#results').textContent = ''; });
