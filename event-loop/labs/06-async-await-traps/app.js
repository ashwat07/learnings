// Lab 06 — async/await traps.

import { $, on, Log, renderTable, renderBars, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

// ---------------------------------------------------------------------------
// 1. The ordering puzzle
//
// If you can't produce this from first principles, go back to Lab 01.
// ---------------------------------------------------------------------------

async function puzzle() {
  log.head('— 1. ordering puzzle —');

  async function async1() {
    log.line('async1 start', 'sync');
    await async2();
    log.line('async1 end          ← resumes as a MICROTASK', 'micro');
  }
  async function async2() {
    log.line('async2', 'sync');
  }

  log.line('script start', 'sync');

  setTimeout(() => log.line('setTimeout', 'macro'), 0);

  async1();

  new Promise((resolve) => {
    log.line('promise executor      ← runs SYNCHRONOUSLY', 'sync');
    resolve();
  }).then(() => log.line('promise then', 'micro'));

  log.line('script end', 'sync');

  out.textContent =
    'The two lines people get wrong:\n' +
    '  • the Promise executor body is synchronous — new Promise() runs it immediately\n' +
    '  • "async1 end" comes before "promise then" because async1 suspended earlier, so its\n' +
    '    continuation was queued first';
}

// ---------------------------------------------------------------------------
// 2. Counting microtask ticks
//
// Technique: queue a numbered chain of microtasks, then see which number the construct
// under test lands between. Each "tick" is one trip through the microtask queue.
// ---------------------------------------------------------------------------

function ticks() {
  log.head('— 2. how many microtask ticks does each construct cost? —');

  const results = [];

  // Technique: start a self-perpetuating microtask counter, then run the construct under
  // test. Whatever the counter reads when the construct completes is how many trips through
  // the microtask queue it took. Each case gets its own task so counters can't interfere.
  const cases = [
    ['await Promise.resolve(v)', async (mark) => { await Promise.resolve(1); mark(); }],
    ['await v (non-promise)', async (mark) => { await 1; mark(); }],
    ['await thenable {then(r){r()}}', async (mark) => { await { then(r) { r(1); } }; mark(); }],
    ['return p (async fn)', async (mark) => { await (async () => Promise.resolve(1))(); mark(); }],
    ['return await p (async fn)', async (mark) => { await (async () => await Promise.resolve(1))(); mark(); }],
    ['p.then(f)', (mark) => Promise.resolve(1).then(() => mark())],
  ];

  let i = 0;
  function runCase() {
    if (i >= cases.length) {
      renderTable('#results', results, { columns: ['construct', 'microtask ticks'] });
      out.textContent =
        'A "tick" is one pass through the microtask queue. The differences are tiny in absolute\n' +
        'terms and irrelevant in application code — but they explain two real things:\n' +
        '  • `return p` inside an async function costs 2 extra ticks vs `return await p` (the\n' +
        '    spec has to unwrap the promise via a hidden then), which is why `return await` is\n' +
        '    NOT redundant — it is both faster to resolve and keeps the frame in stack traces.\n' +
        '  • awaiting a thenable costs an extra tick because the engine must call .then() on it.';
      return;
    }
    const [label, fn] = cases[i++];
    let tickCount = 0;
    let done = false;
    const step = () => { if (!done) { tickCount++; queueMicrotask(step); } };
    queueMicrotask(step);
    fn(() => {
      done = true;
      results.push({ construct: label, 'microtask ticks': tickCount });
      log.line(`${label.padEnd(32)} ${tickCount} tick(s)`, 'micro');
      setTimeout(runCase, 0);      // new task, fresh counter
    });
  }
  runCase();
}

// ---------------------------------------------------------------------------
// 3. The forEach trap
// ---------------------------------------------------------------------------

async function forEachTrap() {
  log.head('— 3. await inside forEach —');

  const items = [1, 2, 3];
  const wait = (n) => new Promise((r) => setTimeout(() => r(n), 100 * n));

  log.muted('forEach version:');
  items.forEach(async (n) => {
    const v = await wait(n);
    log.line(`  forEach got ${v}`, 'macro');
  });
  log.bad('  "all done" (forEach returned immediately — it never awaited anything)');

  await new Promise((r) => setTimeout(r, 400));

  log.muted('for…of version:');
  for (const n of items) {
    const v = await wait(n);
    log.line(`  for..of got ${v}`, 'good');
  }
  log.ok('  all done (correct — but now it is sequential, see demo 5)');

  out.textContent =
    'forEach ignores the promise its callback returns. The callbacks all start, the loop finishes\n' +
    'immediately, and your "done" code runs before any of them. map + Promise.all is the fix when\n' +
    'you want concurrency; for..of when you want sequence. There is no correct use of an async\n' +
    'callback with forEach.';
}

// ---------------------------------------------------------------------------
// 4. Error propagation
// ---------------------------------------------------------------------------

async function errors() {
  log.head('— 4. error propagation —');

  const boom = (n) => new Promise((_, rej) => setTimeout(() => rej(new Error(`fail ${n}`)), 50 * n));
  const ok = (n) => new Promise((res) => setTimeout(() => res(`ok ${n}`), 50 * n));

  try {
    await Promise.all([ok(1), boom(2), boom(3)]);
  } catch (e) {
    log.bad(`Promise.all rejected with the FIRST rejection: ${e.message}`);
    log.muted('  …but boom(3) still runs and still rejects. If nothing handles it you get an ' +
      'unhandledrejection — check the console.');
  }

  const settled = await Promise.allSettled([ok(1), boom(2), boom(3)]);
  log.ok(`Promise.allSettled: ${settled.map((s) => s.status).join(', ')}`);

  try {
    const first = await Promise.any([boom(1), ok(2)]);
    log.ok(`Promise.any resolved with the first SUCCESS: ${first}`);
  } catch (e) {
    log.bad(`Promise.any: ${e}`);
  }

  const raced = await Promise.race([ok(1), boom(2)]).catch((e) => `rejected: ${e.message}`);
  log.line(`Promise.race settles with whatever finishes first: ${raced}`, 'micro');

  // The trap: a rejection created now but awaited later.
  const later = boom(1);
  await new Promise((r) => setTimeout(r, 200));
  try { await later; } catch (e) { log.bad(`awaited late: ${e.message}`); }
  log.muted('  ^ that one fired an unhandledrejection warning first, then got handled. Chrome ' +
    'reports it and then retracts it. Create promises where you handle them.');

  out.textContent =
    'all → fails fast, leaves siblings running (and possibly unhandled)\n' +
    'allSettled → never rejects; you inspect each outcome\n' +
    'any → first success, AggregateError if all fail\n' +
    'race → first to settle, success or failure';
}

// ---------------------------------------------------------------------------
// 5. Sequential vs concurrent I/O — the one that costs real seconds
// ---------------------------------------------------------------------------

const timings = [];

function url(i) {
  const d = Number($('delay').value);
  return `/api/asset?name=item${i}&type=json&delay=${d}&cc=no-store&t=${Math.random()}`;
}

async function record(label, fn) {
  const n = Number($('n').value);
  log.head(`— ${label}: ${n} requests, ${$('delay').value}ms server delay each —`);
  const t0 = performance.now();
  const arrivals = [];
  await fn(n, (i) => arrivals.push({ i, at: performance.now() - t0 }));
  const total = performance.now() - t0;

  timings.push({
    strategy: label,
    'total ms': Math.round(total),
    'first result ms': arrivals.length ? Math.round(arrivals[0].at) : '–',
    'requests': n,
    _totalClass: total > n * Number($('delay').value) * 0.8 ? 'no' : 'ok',
  });
  renderTable('#results', timings, { columns: ['strategy', 'requests', 'total ms', 'first result ms'] });
  for (const a of arrivals) log.line(`  result #${a.i} at ${fmt.ms(a.at)}`, 'macro');
  log.line(`${label}: ${fmt.ms(total)} total, first result at ${fmt.ms(arrivals[0]?.at ?? 0)}`,
    total > 1000 ? 'bad' : 'good');
}

/** 5a. The default people write. N × latency. */
async function sequential(n, onEach) {
  for (let i = 0; i < n; i++) {
    const r = await fetch(url(i));
    await r.json();
    onEach(i);
  }
}

/** 5b. All at once. 1 × latency — until the connection limit or the server says no. */
async function parallel(n, onEach) {
  await Promise.all(Array.from({ length: n }, async (_, i) => {
    const r = await fetch(url(i));
    await r.json();
    onEach(i);
  }));
}

/**
 * 5c. TODO — pooled with a concurrency limit.
 *
 * Promise.all with 500 items is its own bug: you blow through the browser's per-origin
 * connection limit, the server's rate limit, and your own memory. Implement a pool that
 * keeps exactly `limit` requests in flight at all times (not "batches of 3" — a batch waits
 * for its slowest member; a pool does not).
 */
async function pooled(n, onEach) {
  throw new Error('TODO: implement pooled() with a concurrency limit of 3 — see the README');
}

/**
 * 5d. TODO — process results as they arrive.
 *
 * Promise.all gives you everything at the end. Often you want to render each result the moment
 * it lands. Implement it so the first result is visible after ~1× latency, not N×.
 */
async function stream(n, onEach) {
  throw new Error('TODO: implement stream() — see the README');
}

// ---------------------------------------------------------------------------

on('puzzle', () => { log.clear(); puzzle(); });
on('ticks', () => { log.clear(); ticks(); });
on('foreach', () => { log.clear(); forEachTrap(); });
on('errors', () => { log.clear(); errors(); });
on('sequential', () => record('5a. sequential await', sequential).catch((e) => log.bad(e.message)));
on('parallel', () => record('5b. Promise.all', parallel).catch((e) => log.bad(e.message)));
on('pooled', () => record('5c. pooled (limit 3)', pooled).catch((e) => log.bad(e.message)));
on('stream', () => record('5d. as-they-arrive', stream).catch((e) => log.bad(e.message)));
on('clear', () => { log.clear(); timings.length = 0; $('results').textContent = ''; });
