// Lab 05 — Promises from scratch.
//
// MyPromise below is a faithful Promises/A+ implementation. Read it: the spec is small, and every
// rule in it exists because of a bug someone hit.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const PENDING = 'pending', FULFILLED = 'fulfilled', REJECTED = 'rejected';

class MyPromise {
  #state = PENDING;
  #value;
  #callbacks = [];

  constructor(executor) {
    const resolve = (value) => this.#settle(FULFILLED, value);
    const reject = (reason) => this.#settle(REJECTED, reason);
    // 2.3.3.3.4: if the executor throws, reject — unless it already settled.
    try { executor(resolve, reject); } catch (e) { reject(e); }
  }

  #settle(state, value) {
    if (this.#state !== PENDING) return;         // 2.1: a promise settles ONCE. Ever.

    // 2.3: resolving with a thenable ADOPTS its state, recursively. This one rule is why
    // `return anotherPromise` inside .then flattens instead of nesting.
    if (state === FULFILLED && value && (typeof value === 'object' || typeof value === 'function')) {
      let then;
      try { then = value.then; } catch (e) { return this.#settle(REJECTED, e); }
      if (typeof then === 'function') {
        if (value === this) return this.#settle(REJECTED, new TypeError('Chaining cycle detected'));
        let called = false;                       // 2.3.3.3.3: ignore everything after the first call
        try {
          then.call(value,
            (v) => { if (!called) { called = true; this.#settle(FULFILLED, v); } },
            (r) => { if (!called) { called = true; this.#settle(REJECTED, r); } });
        } catch (e) { if (!called) { called = true; this.#settle(REJECTED, e); } }
        return;
      }
    }

    this.#state = state;
    this.#value = value;
    for (const cb of this.#callbacks) this.#schedule(cb);
    this.#callbacks = [];
  }

  // 2.2.4: handlers must not be called in the same turn. queueMicrotask is exactly the right
  // primitive — it is the same queue the native implementation uses.
  #schedule(cb) { queueMicrotask(cb); }

  then(onFulfilled, onRejected) {
    return new MyPromise((resolve, reject) => {
      const handle = () => {
        // 2.2.7.3/4: a non-function handler PASSES THROUGH. This is why .then(null, fn) works,
        // and why an error skips every intermediate .then until a rejection handler.
        const handler = this.#state === FULFILLED ? onFulfilled : onRejected;
        if (typeof handler !== 'function') {
          return this.#state === FULFILLED ? resolve(this.#value) : reject(this.#value);
        }
        try { resolve(handler(this.#value)); } catch (e) { reject(e); }
      };
      if (this.#state === PENDING) this.#callbacks.push(handle);
      else this.#schedule(handle);
    });
  }

  catch(onRejected) { return this.then(undefined, onRejected); }

  finally(onFinally) {
    // finally must PASS THE VALUE THROUGH and must wait if onFinally returns a promise.
    return this.then(
      (v) => MyPromise.resolve(onFinally()).then(() => v),
      (r) => MyPromise.resolve(onFinally()).then(() => { throw r; }),
    );
  }

  static resolve(v) { return v instanceof MyPromise ? v : new MyPromise((res) => res(v)); }
  static reject(r) { return new MyPromise((_, rej) => rej(r)); }

  static all(list) {
    return new MyPromise((resolve, reject) => {
      const items = [...list]; const results = new Array(items.length); let left = items.length;
      if (!left) return resolve([]);
      items.forEach((p, i) => MyPromise.resolve(p).then((v) => { results[i] = v; if (--left === 0) resolve(results); }, reject));
    });
  }
  static allSettled(list) {
    return MyPromise.all([...list].map((p) => MyPromise.resolve(p).then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason }))));
  }
  static race(list) {
    return new MyPromise((resolve, reject) => { for (const p of list) MyPromise.resolve(p).then(resolve, reject); });
  }
  static any(list) {
    return new MyPromise((resolve, reject) => {
      const items = [...list]; let left = items.length; const errors = new Array(left);
      if (!left) return reject(new AggregateError([], 'All promises were rejected'));
      items.forEach((p, i) => MyPromise.resolve(p).then(resolve, (e) => { errors[i] = e; if (--left === 0) reject(new AggregateError(errors, 'All promises were rejected')); }));
    });
  }
}

// ---------------------------------------------------------------------------
// A conformance suite over the rules that actually bite.
// ---------------------------------------------------------------------------
const TESTS = [
  ['settles only once', async () => {
    let n = 0;
    await new MyPromise((res) => { res(1); res(2); }).then((v) => { n = v; });
    return n === 1;
  }],
  ['handlers run asynchronously', async () => {
    let sync = true;
    const p = MyPromise.resolve(1).then(() => { if (sync) throw new Error('ran synchronously'); });
    sync = false;
    await p; return true;
  }],
  ['returning a promise flattens it', async () => {
    const v = await MyPromise.resolve(1).then(() => MyPromise.resolve(2)).then((x) => x);
    return v === 2;
  }],
  ['a thrown error rejects the chain', async () => {
    try { await MyPromise.resolve(1).then(() => { throw new Error('x'); }); return false; }
    catch (e) { return e.message === 'x'; }
  }],
  ['errors skip .then and reach .catch', async () => {
    let skipped = true;
    await MyPromise.reject(new Error('x')).then(() => { skipped = false; }).catch(() => {});
    return skipped;
  }],
  ['non-function handlers pass through', async () => {
    const v = await MyPromise.resolve(7).then(null).then(undefined).then((x) => x);
    return v === 7;
  }],
  ['catch recovers the chain', async () => {
    const v = await MyPromise.reject(new Error('x')).catch(() => 'recovered').then((x) => x);
    return v === 'recovered';
  }],
  ['finally passes the value through', async () => {
    let ran = false;
    const v = await MyPromise.resolve(5).finally(() => { ran = true; return 'ignored'; });
    return ran && v === 5;
  }],
  ['assimilates a foreign thenable', async () => {
    const thenable = { then(res) { setTimeout(() => res('from a thenable'), 0); } };
    return (await MyPromise.resolve(thenable)) === 'from a thenable';
  }],
  ['detects a chaining cycle', async () => {
    const p = MyPromise.resolve(1).then(() => p);
    try { await p; return false; } catch (e) { return e instanceof TypeError; }
  }],
  ['a thenable that calls back twice is ignored after the first', async () => {
    const naughty = { then(res) { res('first'); res('second'); } };
    return (await MyPromise.resolve(naughty)) === 'first';
  }],
  ['all rejects on the first rejection', async () => {
    try { await MyPromise.all([MyPromise.resolve(1), MyPromise.reject(new Error('boom'))]); return false; }
    catch (e) { return e.message === 'boom'; }
  }],
  ['allSettled never rejects', async () => {
    const r = await MyPromise.allSettled([MyPromise.resolve(1), MyPromise.reject(new Error('x'))]);
    return r[0].status === 'fulfilled' && r[1].status === 'rejected';
  }],
  ['any resolves on the first success', async () => {
    return (await MyPromise.any([MyPromise.reject(new Error('a')), MyPromise.resolve('b')])) === 'b';
  }],
];

on('run', async () => {
  log.head('— running the conformance suite against MyPromise —');
  const rows = [];
  for (const [name, test] of TESTS) {
    let pass;
    try { pass = await test(); } catch (e) { pass = false; }
    rows.push({ rule: name, result: pass ? 'pass' : 'FAIL', _resultClass: pass ? 'ok' : 'no' });
    log[pass ? 'ok' : 'bad'](`${pass ? 'pass' : 'FAIL'}: ${name}`);
  }
  renderTable('#results', rows, { columns: ['rule', 'result'] });
  out.textContent =
    'Fourteen rules, all from the Promises/A+ specification, all passing against ~90 lines in\n' +
    'app.js. Read the implementation — the comments cite the spec clause for each rule.\n\n' +
    'The three rules that carry the most weight:\n\n' +
    '  1. A PROMISE SETTLES ONCE. Every later resolve/reject is ignored. This is what makes a\n' +
    '     promise safe to hand to code you do not control.\n' +
    '  2. HANDLERS NEVER RUN SYNCHRONOUSLY, even on an already-settled promise. Without this,\n' +
    '     whether your callback ran before or after the next line would depend on timing — the\n' +
    '     "releasing Zalgo" problem that callback APIs suffered from.\n' +
    '  3. RESOLVING WITH A THENABLE ADOPTS ITS STATE. That single rule is why `return fetch(...)`\n' +
    '     inside `.then` flattens instead of giving you a promise of a promise, and it is why any\n' +
    '     object with a `.then` method is interchangeable with a real promise.\n\n' +
    'Rule 3 also has a sharp edge worth knowing: you cannot resolve a promise WITH a promise as a\n' +
    'value. `Promise.resolve(somePromise)` returns that promise, not a promise wrapping it. If you\n' +
    'genuinely need to store one, wrap it: `{ promise }`.';
});

on('ordering', async () => {
  const order = [];
  order.push('1 sync start');
  setTimeout(() => { order.push('7 setTimeout (macrotask)'); done(); }, 0);
  MyPromise.resolve().then(() => order.push('4 MyPromise.then'));
  Promise.resolve().then(() => order.push('5 native .then'));
  queueMicrotask(() => order.push('6 queueMicrotask'));
  order.push('2 sync end');
  await null;
  order.push('3 after await null');

  function done() {
    renderTable('#results', order.map((o, i) => ({ '#': i + 1, ran: o })), { columns: ['#', 'ran'] });
    out.textContent =
      'MyPromise interleaves correctly with native promises because both use the SAME microtask\n' +
      'queue — that is the entire content of `#schedule`.\n\n' +
      'The ordering rules, in one place:\n' +
      '  · ALL synchronous code runs first, to completion.\n' +
      '  · Then the ENTIRE microtask queue drains — including microtasks queued BY microtasks.\n' +
      '    This is why an infinite microtask loop freezes the page permanently while an infinite\n' +
      '    setTimeout loop does not (event-loop lab 02).\n' +
      '  · Then ONE macrotask (a timer, an I/O callback), then the microtask queue drains again.\n' +
      '  · Rendering happens between macrotasks, never in the middle of a microtask drain.\n\n' +
      '`await null` is worth its own note: it queues a microtask even though nothing is\n' +
      'asynchronous. Every `await` is at least one microtask, which is why an await inside a hot\n' +
      'loop is measurably slower than collecting promises and awaiting once.';
  }
});

on('thenable', async () => {
  const rows = [];
  const nice = { then: (res) => res('a plain object with .then') };
  rows.push({ case: 'await a thenable', result: await nice });
  const nested = MyPromise.resolve(MyPromise.resolve(MyPromise.resolve('three deep')));
  rows.push({ case: 'a promise of a promise of a promise', result: await nested });
  const getterTrap = { get then() { throw new Error('the getter threw'); } };
  try { await MyPromise.resolve(getterTrap); } catch (e) { rows.push({ case: 'a throwing `then` getter', result: e.message }); }
  const late = { then(res) { res('resolved'); throw new Error('thrown after resolving'); } };
  rows.push({ case: 'thenable resolves, then throws', result: await MyPromise.resolve(late) });
  renderTable('#results', rows, { columns: ['case', 'result'] });
  out.textContent =
    'ASSIMILATION is the rule that makes the whole ecosystem interoperable: anything with a\n' +
    '`.then` method is treated as a promise, so jQuery deferreds, Bluebird promises, and your own\n' +
    'objects all work with `await`.\n\n' +
    'It also has consequences people meet as bugs:\n\n' +
    '  · YOU CANNOT AWAIT AN OBJECT THAT HAPPENS TO HAVE A `then` PROPERTY. If your API returns\n' +
    '    `{ then: "tomorrow" }`, awaiting it is fine (then is not a function) — but\n' +
    '    `{ then: (cb) => ... }` will be assimilated and probably hang forever. This is a real\n' +
    '    hazard for objects deserialised from user data.\n' +
    '  · `.then` IS READ AS A PROPERTY, once, and a throwing getter rejects the promise. That is\n' +
    '    the third row.\n' +
    '  · A thenable that calls back and THEN throws is ignored after the first call (row 4) —\n' +
    '    because a promise settles once.\n\n' +
    'It is also why a class with a `then` method is a trap: return it from an async function and\n' +
    'it will be assimilated instead of returned.';
});

on('desugar', async () => {
  // async/await is a generator plus a driver. This IS the transform babel applies.
  function drive(genFn) {
    return function (...args) {
      const it = genFn.apply(this, args);
      return new MyPromise((resolve, reject) => {
        const step = (method, arg) => {
          let r;
          try { r = it[method](arg); } catch (e) { return reject(e); }
          if (r.done) return resolve(r.value);
          // Every `await` becomes: yield the value, resume when it settles.
          MyPromise.resolve(r.value).then((v) => step('next', v), (e) => step('throw', e));
        };
        step('next');
      });
    };
  }

  const delay = (ms, v) => new MyPromise((res) => setTimeout(() => res(v), ms));

  const asyncVersion = async function () {
    const a = await delay(30, 'a');
    const b = await delay(30, 'b');
    try { await MyPromise.reject(new Error('handled')); } catch (e) { /* caught */ }
    return a + b;
  };
  const generatorVersion = drive(function* () {
    const a = yield delay(30, 'a');
    const b = yield delay(30, 'b');
    try { yield MyPromise.reject(new Error('handled')); } catch (e) { /* caught */ }
    return a + b;
  });

  const t0 = performance.now();
  const r1 = await asyncVersion();
  const t1 = performance.now();
  const r2 = await generatorVersion();
  const t2 = performance.now();

  renderTable('#results', [
    { version: 'async / await', result: r1, ms: (t1 - t0).toFixed(0) },
    { version: 'generator + driver (the desugaring)', result: r2, ms: (t2 - t1).toFixed(0) },
  ], { columns: ['version', 'result', 'ms'] });

  out.textContent =
    'Identical behaviour, including the try/catch across an await — because THAT IS WHAT ASYNC\n' +
    'FUNCTIONS ARE. Read `drive()` in this file; it is 15 lines and it is the transform Babel\n' +
    'applies when targeting older browsers.\n\n' +
    'The mapping is exact:\n' +
    '  async function        →  a generator function, wrapped in a driver\n' +
    '  await x               →  yield x  (the driver resumes with the resolved value)\n' +
    '  throw inside an await →  it.throw(e) (which is why try/catch works across awaits)\n' +
    '  return v              →  the driver resolves its promise with v\n\n' +
    'Two things this explains that are otherwise mysterious:\n' +
    '  · WHY AN ASYNC FUNCTION RETURNS IMMEDIATELY AT THE FIRST AWAIT — a generator suspends at\n' +
    '    yield and returns control to its caller. The rest of the function is a continuation.\n' +
    '  · WHY `await` IN A LOOP IS SEQUENTIAL — each yield waits for the driver to resume it.\n' +
    '    Collecting promises first and awaiting once (Promise.all) is not a style preference; it\n' +
    '    is the difference between n round trips and one.\n\n' +
    'Lab 06 uses the same generator machinery for something other than promises.';
});

on('combinators', async () => {
  const ok = (ms, v) => new MyPromise((res) => setTimeout(() => res(v), ms));
  const bad = (ms, e) => new MyPromise((_, rej) => setTimeout(() => rej(new Error(e)), ms));
  const run = async (label, p) => { try { return { combinator: label, outcome: `resolved: ${JSON.stringify(await p)}` }; } catch (e) { return { combinator: label, outcome: `rejected: ${e.message ?? e.name}` }; } };

  const rows = [
    await run('all([ok, ok])', MyPromise.all([ok(10, 1), ok(20, 2)])),
    await run('all([ok, bad])', MyPromise.all([ok(10, 1), bad(20, 'boom')])),
    await run('allSettled([ok, bad])', MyPromise.allSettled([ok(10, 1), bad(20, 'boom')]).then((r) => r.map((x) => x.status))),
    await run('race([slow-ok, fast-bad])', MyPromise.race([ok(50, 'slow'), bad(10, 'fast failure')])),
    await run('any([bad, ok])', MyPromise.any([bad(10, 'first'), ok(20, 'the winner')])),
    await run('any([bad, bad])', MyPromise.any([bad(10, 'a'), bad(20, 'b')])),
  ];
  renderTable('#results', rows, { columns: ['combinator', 'outcome'] });

  out.textContent =
    'Choosing between them:\n\n' +
    '  all         all must succeed; rejects on the FIRST failure, and the others keep running\n' +
    '              (nothing is cancelled — that is the trap).\n' +
    '  allSettled  never rejects. THE RIGHT DEFAULT IN A UI, because one failed widget should not\n' +
    '              discard three successful ones (resilience lab 03).\n' +
    '  race        the first to SETTLE wins, success or failure. Use it for timeouts.\n' +
    '  any         the first to SUCCEED wins; rejects with an AggregateError only if all fail.\n' +
    '              Use it for redundant sources.\n\n' +
    'The trap in `all` is worth stating plainly: REJECTION IS NOT CANCELLATION. When all() rejects,\n' +
    'the other requests are still in flight, their handlers will still run, and their errors — if\n' +
    'any — become unhandled rejections. If you need real cancellation, pass an AbortSignal to each\n' +
    'and abort the rest in the failure path.\n\n' +
    'And the timeout idiom, which is `race` plus abort:\n' +
    '  await Promise.race([fetch(url, {signal}), rejectAfter(5000)])   // plus signal.abort()\n' +
    'or, more simply now: `fetch(url, { signal: AbortSignal.timeout(5000) })`.';
});

on('traps', async () => {
  const rows = [];

  // 1. forEach does not await.
  const seen = [];
  [1, 2, 3].forEach(async (n) => { await null; seen.push(n); });
  rows.push({ trap: 'await inside forEach', symptom: `the loop finished with ${seen.length} of 3 done`, fix: 'for...of, or Promise.all(map(...))' });

  // 2. Sequential vs parallel.
  const d = (ms) => new Promise((r) => setTimeout(r, ms));
  let s = performance.now(); await d(40); await d(40);
  const sequential = performance.now() - s;
  s = performance.now(); await Promise.all([d(40), d(40)]);
  const parallel = performance.now() - s;
  rows.push({ trap: 'await in a loop', symptom: `${sequential.toFixed(0)}ms sequential vs ${parallel.toFixed(0)}ms parallel`, fix: 'start them all, then await' });

  // 3. Unhandled rejection created before the handler is attached.
  const late = Promise.reject(new Error('created early'));
  await null;
  late.catch(() => {});                          // attached a tick later: already reported as unhandled
  rows.push({ trap: 'attaching .catch late', symptom: 'reported as an unhandled rejection first', fix: 'attach handlers in the same tick' });

  // 4. return vs await inside try.
  const f1 = async () => { try { return Promise.reject(new Error('x')); } catch { return 'caught'; } };
  const f2 = async () => { try { return await Promise.reject(new Error('x')); } catch { return 'caught'; } };
  rows.push({ trap: 'return vs return await in try', symptom: `return → ${await f1().catch(() => 'ESCAPED the try')}, return await → ${await f2()}`, fix: 'use `return await` inside try' });

  renderTable('#results', rows, { columns: ['trap', 'symptom', 'fix'] });

  out.textContent =
    'The fourth row is the subtle one, and it is the reason the `no-return-await` lint rule has an\n' +
    'exception for try blocks:\n\n' +
    '  try { return somePromise; }        // the function RETURNS before the promise settles,\n' +
    '                                     // so the rejection escapes this try/catch entirely\n' +
    '  try { return await somePromise; }  // the await happens INSIDE the try, so it is caught\n\n' +
    'Everywhere else `return await` is redundant (it adds a microtask), which is why the rule\n' +
    'exists — but inside try/catch and try/finally it changes behaviour.\n\n' +
    'The first row is the most common in real code: `forEach` takes a callback and ignores its\n' +
    'return value, so an async callback returns a promise into the void. The loop completes\n' +
    'immediately, nothing is awaited, and errors become unhandled rejections. `map` + `Promise.all`\n' +
    'for parallel, `for...of` with await for sequential — and `forEach` never, with an async\n' +
    'callback.';
});
