// Lab 06 — Iterators & generators.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

// A live FPS meter, so the scheduler demo is measurable rather than a feeling.
let frames = 0, last = performance.now();
(function meter() {
  frames++;
  const now = performance.now();
  if (now - last >= 500) { $('fps').textContent = Math.round(frames * 1000 / (now - last)); frames = 0; last = now; }
  requestAnimationFrame(meter);
})();

// ---------------------------------------------------------------------------
// 1. The protocol. Anything with [Symbol.iterator] works with for...of, spread,
//    destructuring, Array.from, Map/Set constructors, yield*, and Promise.all.
// ---------------------------------------------------------------------------
on('protocol', () => {
  // A hand-written iterator — no generator syntax, to show what the syntax produces.
  const range = (from, to, step = 1) => ({
    [Symbol.iterator]() {
      let n = from;
      return {
        next: () => (n < to ? { value: (n += step) - step, done: false } : { value: undefined, done: true }),
        // `return` is called when the loop exits EARLY (break, throw, destructuring). This is the
        // hook that makes cleanup possible, and almost nobody implements it.
        return: () => { log.muted('iterator.return() — the consumer stopped early, cleaning up'); return { done: true }; },
      };
    },
  });

  const collected = [...range(0, 5)];
  let firstTwo = [];
  for (const n of range(0, 100)) { firstTwo.push(n); if (firstTwo.length === 2) break; }

  renderTable('#results', [
    { form: '[...range(0,5)]', result: JSON.stringify(collected) },
    { form: 'for...of with a break', result: JSON.stringify(firstTwo) + ' — and return() was called (see the log)' },
    { form: 'destructuring [a, b] = range(0,100)', result: JSON.stringify((() => { const [a, b] = range(0, 100); return [a, b]; })()) },
    { form: 'Array.from(range(0,3))', result: JSON.stringify(Array.from(range(0, 3))) },
    { form: 'new Set(range(0,3))', result: JSON.stringify([...new Set(range(0, 3))]) },
    { form: 'the same thing as a generator', result: JSON.stringify([...(function* () { for (let i = 0; i < 5; i++) yield i; })()]) },
  ], { columns: ['form', 'result'] });

  out.textContent =
    'THE PROTOCOL IS TWO METHODS. An iterable has [Symbol.iterator]() returning an iterator; an\n' +
    'iterator has next() returning { value, done }. That is all — and implementing it makes your\n' +
    'object work with for...of, spread, destructuring, Array.from, Map, Set, yield* and\n' +
    'Promise.all, none of which you had to think about.\n\n' +
    'The third method, `return()`, is the one worth knowing about because it is where CLEANUP\n' +
    'belongs. It is called when a consumer stops early — a `break`, a `throw`, or destructuring\n' +
    'fewer elements than exist. Watch the log when the break happens above.\n\n' +
    'In a generator, `return()` is what makes `finally` run:\n\n' +
    '  function* readLines(file) {\n' +
    '    try { while (…) yield line; }\n' +
    '    finally { file.close(); }        // runs even if the consumer breaks out\n' +
    '  }\n\n' +
    'That is a genuinely strong guarantee and it is the reason generators are the right tool for\n' +
    'anything holding a resource.';
});

// ---------------------------------------------------------------------------
// 2. Laziness.
// ---------------------------------------------------------------------------
on('lazy', () => {
  let produced = 0;
  function* naturals() { let n = 1; while (true) { produced++; yield n++; } }
  function* map(it, fn) { for (const v of it) yield fn(v); }
  function* filter(it, pred) { for (const v of it) if (pred(v)) yield v; }
  function* take(it, n) { let i = 0; for (const v of it) { if (i++ >= n) return; yield v; } }

  produced = 0;
  const lazy = [...take(filter(map(naturals(), (n) => n * n), (n) => n % 3 === 1), 5)];
  const lazyProduced = produced;

  const eagerStart = performance.now();
  const eager = Array.from({ length: 100000 }, (_, i) => i + 1).map((n) => n * n).filter((n) => n % 3 === 1).slice(0, 5);
  const eagerMs = performance.now() - eagerStart;

  renderTable('#results', [
    { pipeline: 'lazy: take(filter(map(naturals)))', result: JSON.stringify(lazy), workDone: `${lazyProduced} numbers produced`, note: 'over an INFINITE source' },
    { pipeline: 'eager: array.map().filter().slice()', result: JSON.stringify(eager), workDone: '100,000 produced, 100,000 mapped, ~33,000 filtered', note: `${eagerMs.toFixed(1)}ms, 3 intermediate arrays` },
  ], { columns: ['pipeline', 'result', 'workDone', 'note'] });

  out.textContent =
    'The lazy pipeline produced only the numbers it needed and allocated no intermediate arrays.\n' +
    'The eager one built three full arrays to return five elements.\n\n' +
    'Two properties the eager version cannot have at any price:\n' +
    '  · IT WORKS OVER AN INFINITE SOURCE. `naturals()` never ends; `take(5)` simply stops asking.\n' +
    '  · IT INTERLEAVES. Each element flows through map → filter → take individually, so nothing\n' +
    '    is computed that is not consumed, and the first result is available immediately rather\n' +
    '    than after the whole source is processed.\n\n' +
    'When this matters in real code: paginated APIs (yield items, fetch the next page only when\n' +
    'asked), parsing a large file, tree traversal where you want the first match, and any pipeline\n' +
    'over data too big to materialise.\n\n' +
    'When it does not: small arrays. Array methods are heavily optimised and generator resumption\n' +
    'has real per-element overhead — a generator pipeline over 10 items is SLOWER than three array\n' +
    'passes. Laziness pays for size and for infinity, not for style.\n\n' +
    '(The Iterator Helpers proposal — .map/.filter/.take directly on iterators — is shipping in\n' +
    'browsers now, which makes this pattern ergonomic without hand-written combinators.)';
});

// ---------------------------------------------------------------------------
// 3. Two-way communication: the part that makes generators coroutines.
// ---------------------------------------------------------------------------
on('twoway', () => {
  const trace = [];
  function* conversation() {
    trace.push('generator: started');
    const name = yield 'what is your name?';       // the yielded value goes OUT; next(v) comes IN
    trace.push(`generator: received "${name}"`);
    try {
      const age = yield `hello ${name}, how old are you?`;
      trace.push(`generator: received ${age}`);
    } catch (e) {
      trace.push(`generator: caught "${e.message}" thrown INTO it`);
    } finally {
      trace.push('generator: finally ran');
    }
    return 'done';
  }

  const it = conversation();
  trace.push(`caller: next()      → ${it.next().value}`);
  trace.push(`caller: next("ash") → ${it.next('ash').value}`);
  trace.push(`caller: throw()     → ${JSON.stringify(it.throw(new Error('interrupted')))}`);

  renderTable('#results', trace.map((t, i) => ({ '#': i + 1, event: t })), { columns: ['#', 'event'] });

  out.textContent =
    'This is what makes a generator a COROUTINE rather than just a lazy list:\n\n' +
    '  yield x        sends x OUT and suspends\n' +
    '  it.next(v)     resumes, and the yield EXPRESSION evaluates to v\n' +
    '  it.throw(e)    resumes by throwing e AT THE YIELD — so the generator\'s own try/catch runs\n' +
    '  it.return(v)   resumes by returning — so its `finally` blocks run\n\n' +
    'The first call to next() cannot pass a value (there is no yield waiting yet) — a detail that\n' +
    'confuses everyone once.\n\n' +
    'Notice that `it.throw()` let the generator handle the error IN ITS OWN CONTEXT, with its own\n' +
    'try/catch and finally. That is exactly the mechanism async/await uses: when an awaited promise\n' +
    'rejects, the driver calls it.throw(), which is why `try { await x } catch` works at all\n' +
    '(lab 05).\n\n' +
    'And it is why generators are the substrate for effect systems (redux-saga, Effection): the\n' +
    'generator DESCRIBES what it wants, a driver decides how to do it, and the driver can inject\n' +
    'values, errors, cancellation and mocks. That separation is what makes saga code so testable —\n' +
    'you can assert on the yielded descriptions without running any I/O at all.';
});

// ---------------------------------------------------------------------------
// 4. A cooperative scheduler — the standout use.
// ---------------------------------------------------------------------------
let running = false;
on('scheduler', async () => {
  if (running) { running = false; log.muted('stopped'); return; }
  running = true;
  log.head('— 30,000,000 units of work, both ways —');

  function* work(total) {
    let sum = 0;
    for (let i = 0; i < total; i++) {
      sum += Math.sqrt(i);
      if ((i & 0xFFFF) === 0) yield i / total;   // a yield point every 65,536 iterations
    }
    return sum;
  }

  // Blocking version, for comparison.
  const t0 = performance.now();
  let sum = 0; for (let i = 0; i < 30e6; i++) sum += Math.sqrt(i);
  const blockingMs = performance.now() - t0;
  log.bad(`blocking version: ${blockingMs.toFixed(0)}ms with the main thread frozen — the FPS meter stopped`);

  // Cooperative version: run the generator in slices, yielding to the browser between them.
  const t1 = performance.now();
  const it = work(30e6);
  let result;
  while (running) {
    const sliceEnd = performance.now() + 5;      // a 5ms budget per slice
    let step;
    do { step = it.next(); } while (!step.done && performance.now() < sliceEnd);
    if (step.done) { result = step.value; break; }
    $('progress').textContent = `${(step.value * 100).toFixed(0)}%`;
    // scheduler.yield() keeps our continuation at the FRONT of the queue; setTimeout does not.
    await (globalThis.scheduler?.yield?.() ?? new Promise((r) => setTimeout(r, 0)));
  }
  const coopMs = performance.now() - t1;
  running = false;
  $('progress').textContent = 'done';

  renderTable('#results', [
    { version: 'blocking for-loop', wall: `${blockingMs.toFixed(0)}ms`, fps: 'ZERO — the page was frozen', cancellable: 'no', progress: 'impossible' },
    { version: 'generator + 5ms slices', wall: `${coopMs.toFixed(0)}ms`, fps: 'stayed near 60 (watch the meter)', cancellable: 'yes — press again to stop', progress: 'yes' },
  ], { columns: ['version', 'wall', 'fps', 'cancellable', 'progress'] });

  out.textContent =
    'The cooperative version takes LONGER in wall-clock time and the page stayed responsive the\n' +
    'whole way through. That trade — total time for responsiveness — is almost always the right\n' +
    'one, because a user cannot perceive the difference between 900ms and 1100ms but absolutely\n' +
    'perceives a frozen page.\n\n' +
    'What the generator buys that a plain chunked loop does not:\n' +
    '  · THE WORK IS WRITTEN AS ONE LINEAR FUNCTION. No manual index bookkeeping, no state machine,\n' +
    '    no callback per chunk. The yield points are one line.\n' +
    '  · IT IS CANCELLABLE at any yield point — press the button again.\n' +
    '  · IT REPORTS PROGRESS for free, by yielding a value.\n' +
    '  · The slice size is TIME-BASED, not iteration-based, so it adapts to a slow device instead\n' +
    '    of guessing how many iterations fit in 5ms.\n\n' +
    'And the honest caveat: if this work does not touch the DOM, a WORKER is better than a\n' +
    'scheduler — it uses a different core and does not compete for the main thread at all\n' +
    '(web-workers lab 01). Use cooperative scheduling when the work must be on the main thread\n' +
    '(because it touches the DOM) or when the setup cost of a worker is not worth it.';
});

// ---------------------------------------------------------------------------
// 5. Async iteration.
// ---------------------------------------------------------------------------
on('async', async () => {
  log.head('— streaming a response with for await...of —');
  const rows = [];

  // A paginated API as an async generator: the consumer never sees pages.
  async function* paginate(pages) {
    for (let page = 1; page <= pages; page++) {
      const r = await fetch(`/api/data/reviews/${page}`);
      const { reviews } = await r.json();
      log.line(`fetched page ${page}`);
      yield* reviews.slice(0, 2);                // yield* delegates to another iterable
    }
  }

  let n = 0;
  for await (const review of paginate(3)) {
    n++;
    if (n <= 3) rows.push({ item: n, from: 'paginate()', value: String(review.text ?? review.author ?? JSON.stringify(review)).slice(0, 50) });
    if (n >= 6) break;                            // stops fetching further pages
  }

  // A real stream: the fetch body, decoded chunk by chunk.
  const res = await fetch('/api/rows?n=5000');
  let bytes = 0, chunks = 0;
  for await (const chunk of res.body) { bytes += chunk.length; chunks++; }
  rows.push({ item: '—', from: 'response.body (a ReadableStream IS async-iterable)', value: `${chunks} chunks, ${(bytes / 1024).toFixed(0)}KB` });

  renderTable('#results', rows, { columns: ['item', 'from', 'value'] });

  out.textContent =
    'Two things happened there that are worth separating.\n\n' +
    '1. `paginate()` turned a PAGINATED API INTO A FLAT STREAM OF ITEMS. The consumer writes\n' +
    '   `for await (const item of paginate())` and never sees a page, a cursor or a fetch. And\n' +
    '   because iteration is lazy, breaking out at item 6 means page 4 is NEVER REQUESTED — the\n' +
    '   laziness reaches all the way to the network.\n\n' +
    '2. `response.body` is async-iterable, so `for await (const chunk of res.body)` streams a\n' +
    '   response without buffering it. That is how you parse a 200MB NDJSON file in a browser tab\n' +
    '   that has 100MB of headroom.\n\n' +
    'The rule for choosing: `Symbol.asyncIterator` is for a sequence of values ARRIVING OVER TIME.\n' +
    'A promise is for ONE value arriving later. If you find yourself with an array of promises and\n' +
    'want to handle each as it lands, you want an async iterator (or `Promise.all` if order and\n' +
    'completeness matter more).\n\n' +
    'Caveat worth knowing: `for await` is SEQUENTIAL by construction. To process concurrently you\n' +
    'need an explicit pool — which is the next button.';
});

on('backpressure', async () => {
  log.head('— a fast producer, a slow consumer —');

  async function* fastProducer(n) { for (let i = 0; i < n; i++) yield i; }
  const slowConsume = (v) => new Promise((r) => setTimeout(() => r(v), 20));

  // Sequential: the producer is naturally throttled by the consumer.
  const t0 = performance.now();
  let done = 0;
  for await (const v of fastProducer(10)) { await slowConsume(v); done++; }
  const sequentialMs = performance.now() - t0;

  // A bounded pool: N in flight, and the producer is pulled only when a slot frees.
  async function pooled(source, limit, fn) {
    const inFlight = new Set();
    for await (const item of source) {
      const p = fn(item).finally(() => inFlight.delete(p));
      inFlight.add(p);
      if (inFlight.size >= limit) await Promise.race(inFlight);   // WAIT before pulling more
    }
    await Promise.all(inFlight);
  }
  const t1 = performance.now();
  let done2 = 0;
  await pooled(fastProducer(10), 4, async (v) => { await slowConsume(v); done2++; });
  const pooledMs = performance.now() - t1;

  renderTable('#results', [
    { strategy: 'for await (sequential)', items: done, ms: sequentialMs.toFixed(0), inFlight: 1, memory: 'constant' },
    { strategy: 'bounded pool (4 at a time)', items: done2, ms: pooledMs.toFixed(0), inFlight: 4, memory: 'bounded by the limit' },
    { strategy: 'Promise.all(map(...))', items: 'all', ms: '~20 (fastest)', inFlight: 'ALL', memory: 'UNBOUNDED — this is the trap' },
  ], { columns: ['strategy', 'items', 'ms', 'inFlight', 'memory'] });

  out.textContent =
    'BACKPRESSURE is the property that a slow consumer slows the producer down. `for await` has it\n' +
    'automatically — the producer is only resumed when the consumer asks for the next value — and\n' +
    'that is the single best reason to prefer async iteration over an array of promises.\n\n' +
    'Compare the three rows:\n' +
    '  · SEQUENTIAL is safe and slow: one in flight, constant memory, never overwhelms anything.\n' +
    '  · A BOUNDED POOL is the right default: N in flight, memory bounded by N, and the producer is\n' +
    '    pulled only when a slot frees. Fifteen lines — read `pooled()` in this file.\n' +
    '  · Promise.all(items.map(fn)) is the fastest and the dangerous one: it starts EVERYTHING at\n' +
    '    once. With 10 items that is fine. With 10,000 it opens 10,000 connections, allocates\n' +
    '    10,000 promises, and takes down either your browser or your server — and it is the most\n' +
    '    commonly written of the three.\n\n' +
    'The same shape appears everywhere in this repo: the realtime backpressure lab, the offline\n' +
    'outbox flush, the retry budget. "How many at once, and what happens when the far end cannot\n' +
    'keep up" is a question every pipeline has to answer, and async iterators answer it by\n' +
    'construction.';
});
