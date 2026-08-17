// Lab 01 — The cost of localStorage.

import { $, on, Log, renderTable, fmt, storageEstimate } from '/shared/lab-ui.js';
import { openDB, putMany, getAll, clear } from '/browser-storage/idb.js';

const log = new Log('#log');
const out = $('out');
const rows = [];

// ---------------------------------------------------------------------------
// Liveness
// ---------------------------------------------------------------------------

let clicks = 0, worstFrame = 0, lastFrame = performance.now();
(function tick(now) {
  const dt = now - lastFrame; lastFrame = now;
  if (dt > worstFrame) { worstFrame = dt; $('#worst').textContent = `${Math.round(dt)}ms`; }
  requestAnimationFrame(tick);
})(performance.now());
on('poke', () => { clicks++; $('poke').textContent = `poke me (${clicks} handled)`; });

// ---------------------------------------------------------------------------

const makeItems = (n, kb) => Array.from({ length: n }, (_, i) => ({
  id: i,
  name: `item-${i}`,
  updatedAt: new Date(1700000000000 + i * 1000).toISOString(),
  payload: 'x'.repeat(kb * 1024 - 80),
}));

function record(op, ms, bytes, note = '') {
  worstFrame = 0;
  rows.push({
    operation: op,
    'ms': Math.round(ms),
    'MB': +(bytes / 1048576).toFixed(2),
    'MB/s': Math.round((bytes / 1048576) / (ms / 1000)),
    'blocked the main thread': note,
  });
  renderTable('#results', rows, { columns: ['operation', 'ms', 'MB', 'MB/s', 'blocked the main thread'] });
  log.line(`${op.padEnd(34)} ${fmt.ms(ms).padStart(9)}  ${fmt.bytes(bytes)}`, ms > 100 ? 'bad' : 'good');
}

on('write', () => {
  const n = Number($('n').value), kb = Number($('kb').value);
  const items = makeItems(n, kb);
  log.head(`— localStorage.setItem × ${n} (${kb}KB each) —`);
  const t0 = performance.now();
  let bytes = 0;
  try {
    for (const item of items) {
      const s = JSON.stringify(item);
      localStorage.setItem(`lab:${item.id}`, s);
      bytes += s.length * 2;                       // strings are UTF-16 in the quota accounting
    }
  } catch (err) {
    log.bad(`${err.name}: ${err.message} after ${fmt.bytes(bytes)} — this is what hitting the ` +
      'quota looks like, and note that it is a SYNCHRONOUS throw in the middle of your loop, ' +
      'leaving your data half-written.');
  }
  const ms = performance.now() - t0;
  record('localStorage write', ms, bytes, `yes — ${Math.round(worstFrame)}ms worst frame`);
  out.textContent =
    'Every one of those setItem calls was synchronous: serialise, then write to disk, on the main\n' +
    'thread, while your UI waits. The worst frame tells you how long the page was frozen.\n\n' +
    'Two details that make it worse than it looks:\n' +
    '  • localStorage stores UTF-16 strings, so a 1MB JSON string costs ~2MB of quota\n' +
    '  • the quota (~5MB) is per ORIGIN and shared with every other feature using it\n\n' +
    'And when it fills, setItem throws QuotaExceededError synchronously, mid-loop, leaving your\n' +
    'data in a half-written state. There is no transaction.';
});

on('read', () => {
  log.head('— reading it all back —');
  const t0 = performance.now();
  let bytes = 0, count = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith('lab:')) continue;
    const s = localStorage.getItem(key);
    JSON.parse(s);
    bytes += s.length * 2; count++;
  }
  record('localStorage read + parse', performance.now() - t0, bytes,
    `yes — ${Math.round(worstFrame)}ms worst frame`);
  log.muted(`${count} items`);
});

on('idb', async () => {
  const n = Number($('n').value), kb = Number($('kb').value);
  const items = makeItems(n, kb);
  const bytes = n * kb * 1024;
  log.head(`— the same data in IndexedDB —`);

  const db = await openDB('lab01', 1, (d) => {
    if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
  });
  await clear(db, 'items');

  const t0 = performance.now();
  await putMany(db, 'items', items);
  const wms = performance.now() - t0;
  record('IndexedDB write (one transaction)', wms, bytes, `no — ${Math.round(worstFrame)}ms worst frame`);

  const t1 = performance.now();
  const back = await getAll(db, 'items');
  record('IndexedDB read (getAll)', performance.now() - t1, bytes, `no — ${Math.round(worstFrame)}ms worst frame`);
  log.muted(`${back.length} records back`);
  db.close();

  out.textContent =
    'IndexedDB may not be faster in wall time — look at the numbers, sometimes it is slower.\n' +
    'What it does not do is block the main thread: the worst-frame column is the whole story.\n\n' +
    'It also stores structured data directly. No JSON.stringify, no parse, no UTF-16 tax, and it\n' +
    'can hold Blobs and ArrayBuffers natively — which localStorage cannot represent at all\n' +
    'without base64, a 33% size penalty and another main-thread encode.';
});

on('jsonCost', () => {
  log.head('— the serialisation tax —');
  const items = makeItems(Number($('n').value), Number($('kb').value));
  const t0 = performance.now();
  const s = JSON.stringify(items);
  const tStr = performance.now() - t0;
  const t1 = performance.now();
  JSON.parse(s);
  const tParse = performance.now() - t1;
  const t2 = performance.now();
  structuredClone(items);
  const tClone = performance.now() - t2;

  renderTable('#results', [
    { operation: 'JSON.stringify', ms: +tStr.toFixed(1), note: 'main thread, unavoidable for localStorage' },
    { operation: 'JSON.parse', ms: +tParse.toFixed(1), note: 'main thread, on every read' },
    { operation: 'structuredClone', ms: +tClone.toFixed(1), note: 'what IndexedDB uses instead' },
  ], { columns: ['operation', 'ms', 'note'] });
  rows.length = 0;

  out.textContent =
    'localStorage only stores strings, so every read and write pays a JSON round trip on the main\n' +
    'thread — on top of the disk access. For a 5MB app state blob that is a multi-hundred-\n' +
    'millisecond freeze on every save.\n\n' +
    'The pattern to recognise in real code:\n\n' +
    '    const state = JSON.parse(localStorage.getItem("app"));   // on every read\n' +
    '    state.items.push(x);\n' +
    '    localStorage.setItem("app", JSON.stringify(state));      // on every write\n\n' +
    'That is the whole state serialised twice per interaction, synchronously. It is extremely\n' +
    'common, it works fine at 50KB, and it becomes a 400ms freeze at 5MB — gradually, so nobody\n' +
    'notices which change caused it.';
});

on('quota', () => {
  log.head('— finding the localStorage quota —');
  const chunk = 'x'.repeat(64 * 1024);            // 64K chars = 128KB of UTF-16
  let written = 0;
  const t0 = performance.now();
  try {
    for (let i = 0; i < 500; i++) {
      localStorage.setItem(`quota:${i}`, chunk);
      written += chunk.length * 2;
    }
    log.muted('wrote 64MB without hitting a limit? Unusual — check the browser.');
  } catch (err) {
    log.bad(`${err.name} after ${fmt.bytes(written)} in ${fmt.ms(performance.now() - t0)}`);
  }
  for (let i = 0; i < 500; i++) localStorage.removeItem(`quota:${i}`);
  out.textContent =
    `localStorage filled at about ${fmt.bytes(written)}.\n\n` +
    'The limit is per origin (commonly ~5MB, sometimes 10), it counts UTF-16 code units, and it\n' +
    'is shared with everything else on the origin — including third-party scripts you did not\n' +
    'write. A vendor script that fills localStorage breaks YOUR writes.\n\n' +
    'There is no way to ask for more, no eviction policy, and no way to know how much room is\n' +
    'left except by trying and catching. IndexedDB and Cache Storage share a much larger quota\n' +
    'that you CAN query (navigator.storage.estimate) and ask to persist.';
});

on('patterns', async () => {
  log.head('— common patterns, measured —');
  const est = await storageEstimate();
  log.muted(`origin storage in use: ${est?.usageFmt ?? 'unknown'} of ${est?.quotaFmt ?? 'unknown'}`);

  const state = { items: makeItems(500, 2) };
  const cases = [
    ['read whole state, mutate, write back', () => {
      localStorage.setItem('app', JSON.stringify(state));
      const s = JSON.parse(localStorage.getItem('app'));
      s.items[0].name = 'changed';
      localStorage.setItem('app', JSON.stringify(s));
    }],
    ['write one small key', () => localStorage.setItem('theme', 'dark')],
    ['read one small key', () => localStorage.getItem('theme')],
    ['length + key() scan of 50 keys', () => {
      for (let i = 0; i < Math.min(localStorage.length, 50); i++) localStorage.key(i);
    }],
  ];
  const out2 = [];
  for (const [label, fn] of cases) {
    const t0 = performance.now();
    fn();
    out2.push({ pattern: label, ms: +(performance.now() - t0).toFixed(2) });
  }
  renderTable('#results', out2, { columns: ['pattern', 'ms'] });
  rows.length = 0;
  localStorage.removeItem('app');

  out.textContent =
    'A single small key is genuinely cheap — sub-millisecond. That is what localStorage is for:\n' +
    'a theme, a dismissed-banner flag, a feature toggle.\n\n' +
    'The read-modify-write-whole-blob pattern is the one that kills pages, and it is what every\n' +
    '"persist my Redux store to localStorage" middleware does by default, on every action.';
});

on('tabs', () => {
  log.head('— multi-tab —');
  addEventListener('storage', (e) => {
    log.ok(`storage event from another tab: ${e.key} changed`);
  });
  localStorage.setItem('ping', String(Date.now()));
  log.muted('Open this page in a second tab and click this button there. You will see a `storage` ' +
    'event here — but NOT in the tab that made the change.');
  out.textContent =
    'Two things about multiple tabs:\n\n' +
    '1. The `storage` event fires in OTHER tabs, never in the one that wrote. People use it as a\n' +
    '   cross-tab message bus, which works but is a string-only, synchronous-write channel.\n' +
    '   BroadcastChannel is the right tool for messaging.\n\n' +
    '2. There is no locking. Two tabs doing read-modify-write on the same key will lose an\n' +
    '   update — the classic lost-update race, with no way to detect it. IndexedDB gives you\n' +
    '   transactions; the Web Locks API gives you explicit mutual exclusion.';
});

on('clearAll', async () => {
  localStorage.clear();
  try { const db = await openDB('lab01', 1); await clear(db, 'items'); db.close(); } catch { /* not created */ }
  log.ok('localStorage and the lab IndexedDB store cleared');
});
