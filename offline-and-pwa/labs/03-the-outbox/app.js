// Lab 03 — The outbox.
//
// A real IndexedDB-backed queue, ~80 lines. The point is not the code; it is that "the write is
// durable before you tell the user it succeeded" is the whole design, and that a promise held in
// memory is not durable.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

let strategy = 'naive';
let network = 'online';
const inMemoryQueue = [];              // the naive version's "queue" — lost on reload

// ---------------------------------------------------------------------------
// The store. IndexedDB because it is the only client storage that is
// transactional, asynchronous, and large enough to hold real writes.
// ---------------------------------------------------------------------------
const db = await new Promise((resolve, reject) => {
  const req = indexedDB.open('outbox-lab', 1);
  req.onupgradeneeded = () => {
    const store = req.result.createObjectStore('outbox', { keyPath: 'id' });
    store.createIndex('status', 'status');
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const tx = (mode) => db.transaction('outbox', mode).objectStore('outbox');
const put = (record) => new Promise((res, rej) => { const r = tx('readwrite').put(record); r.onsuccess = res; r.onerror = () => rej(r.error); });
const all = () => new Promise((res, rej) => { const r = tx('readonly').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const del = (id) => new Promise((res) => { tx('readwrite').delete(id).onsuccess = res; });

// ---------------------------------------------------------------------------
// The "network".
// ---------------------------------------------------------------------------
async function send(record) {
  if (network === 'offline') throw new TypeError('Failed to fetch (offline)');
  if (network === 'flaky' && Math.random() < 0.5) throw new TypeError('Failed to fetch (flaky)');
  // The idempotency key is the record's own id, generated on the client before the first attempt.
  // Retrying is only safe because of it — see resilience lab 02.
  const r = await fetch('/api/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': record.id },
    body: JSON.stringify(record),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}

// ---------------------------------------------------------------------------
async function paint() {
  const records = await all();
  renderTable('#results', records.length ? records.map((r) => ({
    id: r.id.slice(0, 8),
    text: r.text.slice(0, 40),
    status: r.status,
    attempts: r.attempts,
    _statusClass: r.status === 'sent' ? 'ok' : r.status === 'failed' ? 'no' : 'meh',
  })) : [{ id: '—', text: 'the durable outbox is empty', status: '', attempts: '' }],
  { columns: ['id', 'text', 'status', 'attempts'] });
  if (inMemoryQueue.length) log.muted(`${inMemoryQueue.length} item(s) in the IN-MEMORY queue (not durable)`);
}
await paint();

on('save', async () => {
  const text = $('text').value.trim();
  if (!text) return;

  if (strategy === 'naive') {
    // The bug: the UI says "saved" as soon as the request is DISPATCHED, and the pending request
    // lives only in a promise. Close the tab and it never existed.
    log.ok('UI: "Saved!" (optimistically)');
    inMemoryQueue.push(text);
    send({ id: crypto.randomUUID(), text })
      .then(() => { inMemoryQueue.pop(); log.ok('request actually succeeded'); })
      .catch((e) => log.bad(`request failed: ${e.message} — and nothing retries it`));
    out.textContent =
      'The UI said "Saved!". Now go offline, save again, and RELOAD THE PAGE.\n\n' +
      'The note is gone. There was never anything on disk — only a promise, in memory, in a tab\n' +
      'that no longer exists. The user was told it saved, so they will not type it again.\n\n' +
      'This is the most common offline bug in production software, and it is invisible in every\n' +
      'demo because the network is always up on a developer\'s machine.';
    return;
  }

  // The durable version: write to disk FIRST, then attempt delivery.
  const record = { id: crypto.randomUUID(), text, status: 'pending', attempts: 0, createdAt: Date.now() };
  await put(record);
  log.ok(`persisted ${record.id.slice(0, 8)} to IndexedDB — the work is now safe`);
  await paint();
  flush();
});

// ---------------------------------------------------------------------------
// The flush loop.
// ---------------------------------------------------------------------------
let flushing = false;
async function flush() {
  if (flushing) return;                 // one flush at a time, or you send duplicates
  flushing = true;
  try {
    for (const record of (await all()).filter((r) => r.status !== 'sent')) {
      try {
        await send(record);
        await del(record.id);            // delivered: remove it. Keeping "sent" rows forever is a leak.
        log.ok(`delivered ${record.id.slice(0, 8)}`);
      } catch (e) {
        const attempts = record.attempts + 1;
        // A dead-letter threshold: after N attempts, stop and TELL THE USER. A queue that retries
        // forever is a queue that silently never delivers.
        const status = attempts >= 5 ? 'failed' : 'pending';
        await put({ ...record, attempts, status, lastError: e.message });
        log.bad(`attempt ${attempts} for ${record.id.slice(0, 8)}: ${e.message}`);
        if (status === 'failed') log.bad('moved to the dead-letter state — the user must be told');
      }
      await paint();
    }
  } finally { flushing = false; }
}

on('flush', flush);

// The two triggers that matter. `online` is a hint, not proof — but it is the right moment to try.
addEventListener('online', () => { log.ok('online event — flushing'); flush(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });

for (const [id, s] of [['s-naive', 'naive'], ['s-outbox', 'outbox']]) {
  on(id, () => { strategy = s; $('strategy').textContent = s === 'naive' ? 'fire and forget' : 'durable outbox'; log.head(`strategy: ${s}`); });
}
for (const [id, n] of [['net-on', 'online'], ['net-off', 'offline'], ['net-flaky', 'flaky']]) {
  on(id, () => { network = n; $('netstate').textContent = n; log.head(`network: ${n}`); if (n === 'online') flush(); });
}

on('reload', () => location.reload());
on('clear', async () => { for (const r of await all()) await del(r.id); inMemoryQueue.length = 0; log.clear(); await paint(); });

on('design', () => {
  renderTable('#results', [
    { rule: 'persist BEFORE you acknowledge', why: 'the acknowledgement is a promise you must be able to keep' },
    { rule: 'a client-generated id per record', why: 'it is the idempotency key; retries are only safe with it' },
    { rule: 'IndexedDB, not localStorage', why: 'transactional, async, and not capped at ~5MB of synchronous strings' },
    { rule: 'one flush at a time', why: 'concurrent flushes send duplicates' },
    { rule: 'backoff between attempts', why: 'a tight retry loop on a failing server is an outage amplifier' },
    { rule: 'a dead-letter state after N attempts', why: 'a queue that retries forever silently never delivers' },
    { rule: 'flush on online, visibilitychange, and app start', why: 'the three moments connectivity plausibly returned' },
    { rule: 'show the queue to the user', why: 'they must be able to see and act on pending work' },
    { rule: 'keep ordering if the operations depend on each other', why: 'otherwise "delete" can arrive before "create"' },
  ], { columns: ['rule', 'why'] });
  out.textContent =
    'BACKGROUND SYNC is the platform feature that completes this. Register a sync tag and the\n' +
    'browser flushes your queue in a service worker EVEN IF THE TAB IS CLOSED:\n\n' +
    '  const reg = await navigator.serviceWorker.ready;\n' +
    "  await reg.sync.register('outbox');\n" +
    '  // in the service worker:\n' +
    "  self.addEventListener('sync', e => { if (e.tag === 'outbox') e.waitUntil(flushOutbox()); });\n\n" +
    'Chromium-only, so treat it as an ENHANCEMENT on top of the flush-on-online loop, never as the\n' +
    'mechanism. The in-page loop must work by itself; Background Sync makes it work when the user\n' +
    'has moved on.\n\n' +
    'ORDERING is the design question people meet second. If the queued operations are independent\n' +
    '(three separate notes), flush them in parallel and let fast ones through. If they depend on\n' +
    'each other (create, then edit, then delete the same item), you need a strictly ordered queue\n' +
    'and a stop-on-first-failure policy — otherwise the edit arrives for an item that does not\n' +
    'exist yet. Most apps need per-entity ordering: parallel across entities, serial within one.\n\n' +
    'And the piece that follows from all of this: the record you queued was written against a\n' +
    'version of the data that may have changed by the time it is delivered. That is lab 04.';
});
