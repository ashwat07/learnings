// Lab 04 — Closures & caches.

import { $, on, Log, renderTable, fmt, sleep } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const rows = [];

const n = () => Number($('n').value);
const heap = () => performance.memory?.usedJSHeapSize ?? 0;

async function measure(label, extra = {}) {
  await sleep(120);
  rows.push({ point: label, 'JS heap': fmt.bytes(heap()), ...extra });
  renderTable('#results', rows, { columns: ['point', 'JS heap', 'entries', 'note'] });
  log.line(`${label.padEnd(38)} heap ${fmt.bytes(heap())}`, 'macro');
}

on('measure', () => measure('manual measurement'));
on('clear', () => { log.clear(); rows.length = 0; renderTable('#results', rows); });

// ---------------------------------------------------------------------------
// A. The unbounded memo cache
// ---------------------------------------------------------------------------

const memo = new Map();

function expensive(key) {
  if (memo.has(key)) return memo.get(key);
  const value = { key, data: Array.from({ length: 200 }, (_, i) => `${key}:${i}`) };
  memo.set(key, value);
  return value;
}

on('unbounded', async () => {
  log.head('— A. memoise everything, forever —');
  const before = heap();
  for (let i = 0; i < n(); i++) expensive(`user-${i}-${Math.random()}`);   // unique keys
  await measure(`A. unbounded cache (${n()} keys)`, { entries: memo.size, note: 'never evicts' });
  log.line(`heap grew by ${fmt.bytes(heap() - before)}`, 'bad');
  out.textContent =
    'A memoisation cache with unbounded keys is a leak with a helpful name.\n\n' +
    'It is written for a good reason, it is correct, and it never shrinks. The keys that make it\n' +
    'dangerous are the ones derived from user input or ids: search queries, urls, user ids,\n' +
    'timestamps, serialised filter objects. The key space is unbounded, so the cache is too.\n\n' +
    'Two questions to ask of every cache in a code review:\n' +
    '  1. what is the maximum number of distinct keys?\n' +
    '  2. what removes an entry?\n' +
    'If the answers are "unbounded" and "nothing", it is a leak.';
});

on('lru', async () => {
  log.head('— B. the same cache, bounded —');
  const lru = new Map();                       // Map preserves insertion order — that IS an LRU
  const LIMIT = 500;
  const put = (k, v) => {
    if (lru.has(k)) lru.delete(k);             // re-insert to move to the end
    lru.set(k, v);
    if (lru.size > LIMIT) lru.delete(lru.keys().next().value);   // evict the oldest
  };
  const get = (k) => {
    if (!lru.has(k)) return undefined;
    const v = lru.get(k);
    lru.delete(k); lru.set(k, v);              // touch
    return v;
  };

  for (let i = 0; i < n(); i++) {
    const key = `user-${i}-${Math.random()}`;
    if (!get(key)) put(key, { key, data: Array.from({ length: 200 }, (_, j) => `${key}:${j}`) });
  }
  await measure(`B. LRU cache (${n()} keys, cap ${LIMIT})`, { entries: lru.size, note: 'bounded' });
  out.textContent =
    `Same workload, ${lru.size} entries instead of ${memo.size}.\n\n` +
    'A JavaScript Map preserves insertion order, so an LRU is about eight lines: delete-then-set\n' +
    'to move a key to the end, and delete the first key when you exceed the cap. You do not need\n' +
    'a library for this, and the absence of one is why so many caches are unbounded.\n\n' +
    'Bound by ENTRIES for uniform values, and by BYTES when values vary in size (500 entries can\n' +
    'be 50KB or 500MB). Add a TTL if staleness matters more than memory.';
});

// ---------------------------------------------------------------------------
// C. Map vs WeakMap
// ---------------------------------------------------------------------------

on('mapVsWeak', async () => {
  log.head('— C. Map vs WeakMap, keyed by object —');

  const strong = new Map();
  const weak = new WeakMap();

  // Build objects, key metadata off them, then drop our references to the objects.
  let objs = Array.from({ length: n() }, (_, i) => ({ id: i, payload: new Array(200).fill(`o${i}`) }));
  for (const o of objs) { strong.set(o, { seen: Date.now() }); weak.set(o, { seen: Date.now() }); }
  await measure('C. after filling both', { entries: strong.size, note: 'objects still referenced' });

  objs = null;                                  // the ONLY other reference is dropped
  await sleep(300);
  await measure('C. after dropping the objects', {
    entries: strong.size,
    note: 'Map still holds every object; WeakMap does not',
  });

  log.line(`Map still reports ${strong.size} entries — each one keeping its key object alive`, 'bad');
  log.muted('WeakMap has no .size and cannot be iterated, precisely because its contents can change ' +
    'whenever the GC runs — exposing that would make GC timing observable.');
  out.textContent =
    'A Map holds its KEYS and VALUES strongly. Keying metadata off an object in a Map keeps that\n' +
    'object alive for as long as the Map exists — which, for a module-level Map, is forever.\n\n' +
    'A WeakMap holds keys weakly: when nothing else references the key, the entry disappears.\n' +
    'That makes it exactly right for "extra data about an object I do not own": per-node state,\n' +
    'per-component metadata, private fields, memoisation keyed by an object argument.\n\n' +
    'Its limits are deliberate: no size, no iteration, no clear. If you need to enumerate it, you\n' +
    'need a real cache with an eviction policy instead — the inability to iterate IS the API\n' +
    'telling you that.\n\n' +
    'And the trap: WeakMap<object, value> where the VALUE references the KEY keeps both alive.\n' +
    'Weak keys do not help if the value points back.';
});

// ---------------------------------------------------------------------------
// D. The event bus
// ---------------------------------------------------------------------------

const bus = new Map();                    // event -> Set of handlers
const busSubscribe = (event, fn) => {
  if (!bus.has(event)) bus.set(event, new Set());
  bus.get(event).add(fn);
};

on('bus', async () => {
  log.head('— D. a global event bus with no unsubscribe —');
  for (let i = 0; i < Math.min(n(), 2000); i++) {
    const componentState = { id: i, rows: new Array(200).fill(`component ${i}`) };
    busSubscribe('user:updated', () => componentState.rows.length);
  }
  const handlers = bus.get('user:updated').size;
  await measure('D. event bus', { entries: handlers, note: 'every handler retains a component' });
  log.line(`${handlers} handlers subscribed, none ever removed`, 'bad');
  out.textContent =
    'The store/emitter/bus that every app grows. subscribe() is called in a component; the\n' +
    'unsubscribe function it returns is ignored, or the component forgets to call it on one of\n' +
    'its exit paths.\n\n' +
    'It is the same shape as a listener leak (lab 02) with none of the tooling: there is no\n' +
    'getEventListeners() for your own bus, nothing in DevTools shows it, and the retainer chain\n' +
    'in a snapshot leads to a Set inside a module — which tells you the bus is the culprit but\n' +
    'not which component forgot.\n\n' +
    'Design fixes, in order of preference:\n' +
    '  1. subscribe(event, fn, { signal }) — the same AbortSignal as everything else\n' +
    '  2. return an unsubscribe function AND make forgetting it a lint error\n' +
    '  3. a dev-mode warning when one event exceeds N subscribers, printing registration stacks';
});

// ---------------------------------------------------------------------------
// E. Closure capture
// ---------------------------------------------------------------------------

const held = [];

on('closureSize', async () => {
  log.head('— E. closures capture their scope, not just what they use —');
  const before = heap();

  for (let i = 0; i < 200; i++) {
    // A big object that the callback does NOT use…
    const bigUnused = new Array(20000).fill(`payload ${i}`);
    const smallUsed = { id: i };
    // …but which lives in the same scope as one it does.
    held.push(() => smallUsed.id);
  }
  await measure('E. 200 closures over a big scope', { entries: held.length, note: 'callbacks are tiny' });
  log.line(`heap grew ${fmt.bytes(heap() - before)} for 200 functions that return a number`,
    heap() - before > 5e6 ? 'bad' : 'good');
  out.textContent =
    '200 callbacks, each of which returns a number. The heap grew by megabytes.\n\n' +
    'A closure captures its enclosing SCOPE. Engines do optimise away variables that are provably\n' +
    'unused — but "provably" is doing a lot of work there: a `debugger` statement, an eval, a\n' +
    'with block, or simply a shape the optimiser does not handle, and the whole scope is kept.\n' +
    'Depending on that optimisation is not a strategy.\n\n' +
    'The habit that avoids it: keep callbacks small and defined OUTSIDE big scopes, and pass what\n' +
    'they need as arguments. If a handler needs one id, close over the id — not the object that\n' +
    'contains it, and definitely not the response it came from.\n\n' +
    'In a heap snapshot this appears as a "context" object in the retainer chain. Expand it and\n' +
    'you can see every captured variable, which is the fastest way to prove this is happening.';
});

// ---------------------------------------------------------------------------
// F. WeakRef and FinalizationRegistry
// ---------------------------------------------------------------------------

on('weakref', async () => {
  log.head('— F. WeakRef and FinalizationRegistry —');

  let target = { id: 'observed', payload: new Array(50000).fill('x') };
  const ref = new WeakRef(target);
  const registry = new FinalizationRegistry((tag) => {
    log.ok(`FinalizationRegistry fired for "${tag}" — the object was collected`);
  });
  registry.register(target, 'observed');

  log.line(`ref.deref() → ${ref.deref() ? 'still alive' : 'collected'}`, 'macro');
  target = null;
  log.muted('dropped the strong reference; now waiting for a GC that may never come…');

  for (let i = 0; i < 5; i++) {
    await sleep(400);
    // Allocate to encourage collection. This is a hint, not a mechanism.
    new Array(200000).fill(Math.random());
    log.line(`t+${(i + 1) * 0.4}s: ref.deref() → ${ref.deref() ? 'still alive' : 'COLLECTED'}`,
      ref.deref() ? 'macro' : 'good');
    if (!ref.deref()) break;
  }

  out.textContent =
    'WeakRef gives you a reference that does not prevent collection; deref() returns the object\n' +
    'or undefined. FinalizationRegistry calls you back after an object is collected.\n\n' +
    'Both are explicitly best-effort, and the specification says so:\n' +
    '  • the callback may never run (the page may close first)\n' +
    '  • timing is unspecified and varies by engine and by GC pressure\n' +
    '  • an object may stay alive long after you drop it\n\n' +
    'So: NEVER use them for correctness — not for releasing a lock, closing a connection, or\n' +
    'freeing a resource. That is what explicit dispose() and `using` (explicit resource\n' +
    'management) are for.\n\n' +
    'Where they are genuinely good:\n' +
    '  • a cache of expensive-to-rebuild objects that may be dropped under pressure (WeakRef)\n' +
    '  • DEV-MODE leak detection: register components on mount, and if the callback has not\n' +
    '    fired long after unmount, you probably have a leak. That is lab 06.';
});
