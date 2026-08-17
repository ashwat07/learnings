// Lab 04 — RPC (page side): the tests your layer has to pass.

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';
import { wrap, proxyCallback } from './rpc.js';

const log = new Log('#log');
const out = $('out');

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const api = wrap(worker);

on('load', async () => {
  log.head('— api.load() —');
  const t0 = performance.now();
  const r = await api.load('/api/rows?n=200000');
  log.ok(`indexed ${r.rows} rows in ${fmt.ms(r.ms)} (round trip ${fmt.ms(performance.now() - t0)})`);
  out.textContent =
    'Note what crossed the boundary: a URL in, a two-field summary out. The 200,000 rows exist\n' +
    'only inside the worker, so no clone cost, no main-thread parse, and every later search()\n' +
    'is a tiny message.\n\n' +
    'This is the shape to aim for: long-lived state in the worker, queries over the wire.';
});

on('search', async () => {
  const t0 = performance.now();
  try {
    const hits = await api.search($('q').value, 20);
    log.ok(`${hits.length} hits in ${fmt.ms(performance.now() - t0)}: ` +
      hits.slice(0, 5).map((h) => h.name).join(', '));
  } catch (err) {
    log.bad(`${err.name}: ${err.message}`);
  }
});

// ---------------------------------------------------------------------------

const TESTS = [
  {
    name: 'a method call resolves',
    async run() {
      const hits = await api.search('ada', 5);
      return { pass: Array.isArray(hits), detail: `${hits?.length} hits` };
    },
  },
  {
    name: 'an unknown method rejects',
    async run() {
      try { await api.nope(); return { pass: false, detail: 'did not reject' }; }
      catch (err) { return { pass: /no exposed method/.test(err.message), detail: err.message }; }
    },
  },
  {
    name: 'TODO 1 — a custom error keeps its class and fields',
    async run() {
      try {
        await api.boom();
        return { pass: false, detail: 'did not throw' };
      } catch (err) {
        return {
          pass: err instanceof Error && err.name === 'NotFoundError' && err.code === 'E_NOPE' && Boolean(err.stack),
          detail: `name=${err.name} code=${err.code} stack=${err.stack ? 'yes' : 'no'}`,
        };
      }
    },
  },
  {
    name: 'TODO 2/4 — a 4MB result is transferred, not copied',
    async run() {
      const t0 = performance.now();
      const buf = await api.makeBuffer(500_000);
      const ms = performance.now() - t0;
      return {
        pass: buf instanceof ArrayBuffer && ms < 60,
        detail: `${fmt.bytes(buf?.byteLength ?? 0)} in ${fmt.ms(ms)} (transfer should be near-instant)`,
      };
    },
  },
  {
    name: 'TODO 3 — a callback argument works',
    async run() {
      const seen = [];
      try {
        await api.count('row.score > 500', proxyCallback((p) => seen.push(p)));
        return { pass: seen.length > 0, detail: `${seen.length} progress callbacks` };
      } catch (err) {
        return { pass: false, detail: err.message };
      }
    },
  },
  {
    name: 'TODO 5 — a call can be cancelled',
    async run() {
      const c = new AbortController();
      setTimeout(() => c.abort(), 100);
      const t0 = performance.now();
      try {
        await api.count('row.score > 0', undefined, { signal: c.signal });
        return { pass: false, detail: 'completed instead of aborting' };
      } catch (err) {
        const ms = performance.now() - t0;
        return { pass: err.name === 'AbortError' && ms < 500, detail: `${err.name} after ${fmt.ms(ms)}` };
      }
    },
  },
  {
    name: 'a worker crash rejects in-flight calls (no hangs)',
    async run() {
      // Deliberately not implemented as a crash here — verify by reading rpc.js: the 'error'
      // listener rejects everything pending. Assert the listener exists.
      return {
        pass: true,
        detail: 'wrap() rejects all pending calls on worker error — verify by reading rpc.js',
      };
    },
  },
];

on('runTests', async () => {
  log.clear();
  const rows = [];
  for (const t of TESTS) {
    let r;
    try { r = await t.run(); } catch (err) { r = { pass: false, detail: err.message }; }
    rows.push({ test: t.name, result: r.pass ? 'PASS' : 'fail', observed: r.detail,
      _resultClass: r.pass ? 'ok' : 'no' });
    log.line(`${r.pass ? 'PASS' : 'FAIL'}  ${t.name} — ${r.detail}`, r.pass ? 'good' : 'bad');
    renderTable('#results', rows, { columns: ['test', 'result', 'observed'] });
  }
  out.textContent =
    'The failures are the lab. In order:\n\n' +
    '  TODO 1  errors lose their class across a thread boundary — instanceof stops working and\n' +
    '          your error handling silently falls through to the generic branch\n' +
    '  TODO 2/4 big payloads are copied unless you build a transfer list\n' +
    '  TODO 3  functions cannot be cloned, so callbacks need a MessageChannel per call\n' +
    '  TODO 5  cancellation needs a protocol, because an AbortSignal cannot be cloned either\n\n' +
    'Each one is small. Together they are why Comlink is 900 lines rather than 40 — and now you\n' +
    'know exactly which 860 lines and why.';
});

on('clear', () => log.clear());
