// Lab 03 — IndexedDB performance.

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';
import { openDB, deleteDB, req, tx, withStore, putMany, iterate } from '/browser-storage/idb.js';

const log = new Log('#log');
const out = $('out');
const rows = [];

let worstFrame = 0, lastFrame = performance.now();
(function tick(now) {
  const dt = now - lastFrame; lastFrame = now;
  if (dt > worstFrame) { worstFrame = dt; $('#worst').textContent = `${Math.round(dt)}ms`; }
  requestAnimationFrame(tick);
})(performance.now());

const DB = 'lab03';
let db = null;

const n = () => Number($('n').value);
const idxCount = () => Number($('indexes').value);

function makeRows(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    f0: `team-${i % 37}`,
    f1: (i * 2654435761) % 1000,
    f2: new Date(1600000000000 + i * 1000),
    f3: `name-${i}`,
    f4: i % 7,
    f5: `${i}`.padStart(9, '0'),
    payload: 'x'.repeat(120),
  }));
}

async function fresh() {
  db?.close(); db = null;
  await deleteDB(DB);
  db = await openDB(DB, 1, (d) => {
    const store = d.createObjectStore('rows', { keyPath: 'id' });
    for (let i = 0; i < idxCount(); i++) store.createIndex(`idx${i}`, `f${i}`);
  });
  log.ok(`recreated ${DB} with ${idxCount()} index(es)`);
}

on('reset', () => fresh().catch((e) => log.bad(e.message)));

function record(op, ms, count, note = '') {
  rows.push({
    operation: op,
    'records': count,
    'ms': Math.round(ms),
    'records/s': Math.round(count / (ms / 1000)),
    'worst frame ms': Math.round(worstFrame),
    note,
  });
  renderTable('#results', rows, {
    columns: ['operation', 'records', 'ms', 'records/s', 'worst frame ms', 'note'],
  });
  log.line(`${op.padEnd(34)} ${fmt.ms(ms).padStart(10)}  ${Math.round(count / (ms / 1000))} rec/s`,
    ms > 3000 ? 'bad' : 'good');
  worstFrame = 0;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

on('w-await', async () => {
  if (!db) await fresh();
  const count = Math.min(n(), 20000);          // capped: this strategy is genuinely that slow
  const data = makeRows(count);
  log.head(`— A. await each put (${count} records — capped, this one is painful) —`);
  const t0 = performance.now();
  for (const row of data) {
    // Each await ends the transaction, so this opens `count` transactions. It is the shape
    // you get naturally from a promise-wrapped API used the obvious way.
    await withStore(db, 'rows', 'readwrite', (s) => req(s.put(row)));
  }
  record('A. await each put', performance.now() - t0, count, 'one transaction per record');
});

on('w-txPer', async () => {
  if (!db) await fresh();
  const count = Math.min(n(), 20000);
  const data = makeRows(count);
  log.head(`— B. explicit transaction per put (${count}) —`);
  const t0 = performance.now();
  for (const row of data) {
    const transaction = db.transaction('rows', 'readwrite');
    transaction.objectStore('rows').put(row);
    await tx(transaction);
  }
  record('B. transaction per put', performance.now() - t0, count, 'same as A, explicitly');
});

on('w-single', async () => {
  if (!db) await fresh();
  const data = makeRows(n());
  log.head(`— C. one transaction, fire all requests (${n()}) —`);
  const t0 = performance.now();
  await putMany(db, 'rows', data);
  record('C. one transaction', performance.now() - t0, n(), 'the right default');
  out.textContent =
    'Compare C with A. Same records, same indexes, often 20–60× faster.\n\n' +
    'Why: a transaction has a fixed cost (setup, scheduling, and a commit that may involve an\n' +
    'fsync). Strategy A pays that per record. Strategy C pays it once and lets the requests\n' +
    'pipeline.\n\n' +
    'The trap is that A is what a naive promise wrapper encourages — `await store.put(x)` in a\n' +
    'loop reads perfectly and is the slowest thing in this lab.';
});

on('w-chunked', async () => {
  if (!db) await fresh();
  const data = makeRows(n());
  log.head(`— D. chunked transactions of 10,000 (${n()}) —`);
  const t0 = performance.now();
  await putMany(db, 'rows', data, { chunk: 10000 });
  record('D. chunked (10k)', performance.now() - t0, n(), 'similar speed, better failure story');
  out.textContent =
    'About as fast as one giant transaction, with two advantages:\n' +
    '  • a failure loses one chunk, not the whole import\n' +
    '  • you can report progress and let the UI breathe between chunks\n\n' +
    'And one disadvantage: it is no longer atomic. If your import must be all-or-nothing, use a\n' +
    'single transaction and accept the risk that a very large one may hit memory limits.\n\n' +
    'Chunk size is a tuning knob — 5k–50k is a reasonable range. Measure it rather than guessing;\n' +
    'the optimum depends on record size far more than record count.';
});

on('w-worker', async () => {
  log.head(`— E. writing from a worker (${n()}) —`);
  const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const t0 = performance.now();
  const result = await new Promise((resolve) => {
    w.addEventListener('message', (e) => resolve(e.data), { once: true });
    w.postMessage({ n: n(), indexes: idxCount() });
  });
  w.terminate();
  record('E. from a worker', performance.now() - t0, n(),
    `build ${Math.round(result.build)}ms + write ${Math.round(result.write)}ms, off the main thread`);
  out.textContent =
    'Roughly the same wall time — and the worst-frame column should be much lower.\n\n' +
    'What moved: the structured clone of every value. IndexedDB is asynchronous, but cloning your\n' +
    'objects into the database happens on the CALLING thread, synchronously, per request. For\n' +
    '100,000 records that is real main-thread time even though the API is async.\n\n' +
    'This is the main reason to put a data layer in a worker: not the I/O, the serialisation.';
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

on('r-getAll', async () => {
  if (!db) return log.bad('write some data first');
  const t0 = performance.now();
  const all = await withStore(db, 'rows', 'readonly', (s) => req(s.getAll()));
  record('getAll()', performance.now() - t0, all.length, 'one round trip, all in memory');
});

on('r-cursor', async () => {
  if (!db) return log.bad('write some data first');
  const t0 = performance.now();
  let count = 0;
  await iterate(db, 'rows', {}, () => { count++; });
  record('cursor over everything', performance.now() - t0, count, 'a round trip per record');
  out.textContent =
    'getAll() is typically 2–5× faster than a cursor for the same records, because a cursor is a\n' +
    'request per record while getAll is one.\n\n' +
    'Use a cursor when: you need only the first N, you are updating as you walk, or the result\n' +
    'set would not fit in memory. Use getAll when you want everything and it fits.\n\n' +
    'Middle ground: getAll(query, count) takes a limit, which covers most "first page" cases\n' +
    'without a cursor at all.';
});

on('r-index', async () => {
  if (!db) return log.bad('write some data first');
  if (idxCount() < 1) return log.bad('recreate the database with at least 1 index');
  const t0 = performance.now();
  const hits = await withStore(db, 'rows', 'readonly', (s) => req(s.index('idx0').getAll('team-7')));
  record('index seek (idx0 = team-7)', performance.now() - t0, hits.length, 'seek, not scan');
});

on('r-scan', async () => {
  if (!db) return log.bad('write some data first');
  const t0 = performance.now();
  let hits = 0;
  await iterate(db, 'rows', {}, (v) => { if (v.f0 === 'team-7') hits++; });
  record('full scan + filter in JS', performance.now() - t0, hits, 'reads every record');
  out.textContent =
    'The index seek reads only matching records; the scan reads all 100,000 and throws away 97%\n' +
    'of them — including deserialising each one.\n\n' +
    'This is the single most common IndexedDB performance bug, and it hides well: the code is a\n' +
    'readable `.filter()`, it works fine with 500 records in development, and it becomes a\n' +
    'multi-second freeze at 100,000. The fix is a schema change, which is why it is worth\n' +
    'thinking about indexes before you ship.';
});

on('r-count', async () => {
  if (!db) return log.bad('write some data first');
  const t0 = performance.now();
  const c = await withStore(db, 'rows', 'readonly', (s) => req(s.count()));
  const tCount = performance.now() - t0;
  const t1 = performance.now();
  const all = await withStore(db, 'rows', 'readonly', (s) => req(s.getAll()));
  const tGetAll = performance.now() - t1;
  log.line(`count() ${fmt.ms(tCount)} vs getAll().length ${fmt.ms(tGetAll)} (${c} records)`, 'macro');
  record('count()', tCount, c, `getAll().length took ${Math.round(tGetAll)}ms for the same answer`);
});

on('r-keys', async () => {
  if (!db) return log.bad('write some data first');
  const t0 = performance.now();
  const keys = await withStore(db, 'rows', 'readonly', (s) => req(s.getAllKeys()));
  record('getAllKeys()', performance.now() - t0, keys.length, 'no values deserialised');
  out.textContent =
    'getAllKeys() never deserialises a value, so it is dramatically cheaper. Use it when you only\n' +
    'need to know what exists — diffing against a server, computing a sync delta, checking\n' +
    'membership, building a paging plan.\n\n' +
    'Same idea: index.getAllKeys() gives you primary keys for an index query without loading the\n' +
    'records, which is how you do a cheap "which of these 5,000 ids do I already have?".';
});
