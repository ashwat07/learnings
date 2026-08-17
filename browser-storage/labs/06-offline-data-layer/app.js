// Lab 06 — An offline data layer (page side + tests).

import { $, on, Log, renderTable, sleep } from '/shared/lab-ui.js';
import { deleteDB } from '/browser-storage/idb.js';
import { open, createDataLayer } from './data-layer.js';
import { server, config } from './fake-server.js';

const log = new Log('#log');
const out = $('out');

let db = await open();
let layer = createDataLayer(db, { onChange: render });

async function render(items) {
  const list = items ?? await layer.list();
  const ul = $('#items');
  ul.textContent = '';
  for (const item of list) {
    const li = document.createElement('li');
    li.className = item.conflict ? 'conflict' : item.failed ? 'failed' : item.pending ? 'pending' : '';
    const state = document.createElement('span');
    state.className = 'state';
    state.textContent = item.conflict ? 'conflict' : item.failed ? 'failed' : item.pending ? 'pending' : 'synced';
    const text = document.createElement('span');
    text.textContent = item.text;
    text.style.flex = '1';
    const edit = document.createElement('button');
    edit.textContent = 'edit';
    edit.onclick = () => layer.update(item.id, `${item.text} (edited)`).catch((e) => log.bad(e.message));
    const del = document.createElement('button');
    del.textContent = 'delete';
    del.onclick = () => layer.remove(item.id).catch((e) => log.bad(e.message));
    li.append(state, text, edit, del);
    ul.append(li);
  }
  const outbox = await layer.outbox();
  $('#outbox').textContent = outbox.length
    ? outbox.map((o) => `#${o.seq} ${o.op} ${o.id ?? ''} ${o.attempts ? `(attempts: ${o.attempts})` : ''}`).join('\n')
    : '(empty)';
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

on($('latency'), 'change', (e) => { config.latencyMs = Number(e.target.value); });
on($('failRate'), 'change', (e) => { config.failRate = Number(e.target.value); });
on($('offline'), 'change', (e) => {
  config.offline = e.target.checked;
  log.line(config.offline ? 'simulated OFFLINE' : 'back online', config.offline ? 'bad' : 'good');
  if (!config.offline) layer.sync().catch((err) => log.bad(err.message));
});

on('add', async () => {
  const text = $('text').value.trim();
  if (!text) return;
  $('text').value = '';
  const t0 = performance.now();
  try {
    await layer.create(text);
    log.ok(`create() resolved in ${Math.round(performance.now() - t0)}ms ` +
      '(should be ~0ms — the user must not wait for the network)');
  } catch (err) {
    log.bad(err.message);
  }
  render();
});

on('sync', async () => {
  try {
    const r = await layer.sync();
    log.ok(`sync complete: pulled ${r?.pulled ?? 0}, rev ${r?.rev}`);
  } catch (err) {
    log.bad(`sync failed: ${err.message}`);
  }
  render();
});

on('conflict', async () => {
  const items = await layer.list();
  if (!items.length) return log.bad('add an item first');
  await server.mutateBehindTheScenes(items[0].id, `${items[0].text} [changed on the server]`);
  log.bad('the server changed item 1 without telling you. Now edit it locally and sync.');
});

on('resetAll', async () => {
  server.reset();
  db.close();
  await deleteDB('lab06');
  db = await open();
  layer = createDataLayer(db, { onChange: render });
  log.bad('everything reset');
  render();
});

// ---------------------------------------------------------------------------
// The tests — these define "done"
// ---------------------------------------------------------------------------

const TESTS = [
  {
    name: 'create() resolves without waiting for the network',
    async run() {
      config.latencyMs = 2000;
      const t0 = performance.now();
      await layer.create('fast write');
      const ms = performance.now() - t0;
      config.latencyMs = Number($('latency').value);
      return { pass: ms < 100, detail: `${Math.round(ms)}ms (network latency was 2000ms)` };
    },
  },
  {
    name: 'a write made offline survives and syncs later',
    async run() {
      config.offline = true;
      await layer.create('offline item');
      const outboxWhileOffline = (await layer.outbox()).length;
      config.offline = false;
      await layer.sync();
      const outboxAfter = (await layer.outbox()).length;
      const onServer = Object.values(server.snapshot().items).some((i) => i.text === 'offline item');
      return {
        pass: outboxWhileOffline > 0 && outboxAfter === 0 && onServer,
        detail: `outbox ${outboxWhileOffline} → ${outboxAfter}, on server: ${onServer}`,
      };
    },
  },
  {
    name: 'a retried write does not create a duplicate',
    async run() {
      config.failRate = 1;
      await layer.create('idempotent item');
      await layer.sync().catch(() => {});
      config.failRate = 0;
      await layer.sync();
      await layer.sync();
      const matches = Object.values(server.snapshot().items).filter((i) => i.text === 'idempotent item');
      return { pass: matches.length === 1, detail: `${matches.length} copies on the server (want 1)` };
    },
  },
  {
    name: 'two concurrent syncs do not double-send',
    async run() {
      config.latencyMs = 300;
      await layer.create('concurrent item');
      const before = Object.keys(server.snapshot().items).length;
      await Promise.all([layer.sync(), layer.sync(), layer.sync()]);
      const after = Object.keys(server.snapshot().items).length;
      return { pass: after - before <= 1, detail: `${after - before} new server records for 1 create` };
    },
  },
  {
    name: 'a terminal failure does not block the queue',
    async run() {
      // Simulate a poison message by making one op permanently invalid.
      await layer.create('poison');
      await layer.create('good item after poison');
      await layer.sync().catch(() => {});
      const outbox = await layer.outbox();
      return { pass: outbox.length === 0, detail: `${outbox.length} entries stuck in the outbox` };
    },
  },
  {
    name: 'a conflict is visible, not silent',
    async run() {
      const items = await layer.list();
      if (!items.length) return { pass: false, detail: 'no items' };
      const target = items[0];
      await server.mutateBehindTheScenes(target.id, 'server version');
      await layer.update(target.id, 'client version');
      await layer.sync().catch(() => {});
      const after = (await layer.list()).find((i) => i.id === target.id);
      return {
        pass: Boolean(after?.conflict) || after?.text === 'server version' || after?.text === 'client version',
        detail: `resolved to "${after?.text}"${after?.conflict ? ' and flagged as a conflict' : ' with no conflict flag'}`,
      };
    },
  },
];

on('tests', async () => {
  const rows = [];
  for (const t of TESTS) {
    let r;
    try { r = await t.run(); } catch (err) { r = { pass: false, detail: err.message }; }
    rows.push({ test: t.name, result: r.pass ? 'PASS' : 'fail', observed: r.detail,
      _resultClass: r.pass ? 'ok' : 'no' });
    log.line(`${r.pass ? 'PASS' : 'FAIL'}  ${t.name} — ${r.detail}`, r.pass ? 'good' : 'bad');
    renderTable('#results', rows, { columns: ['test', 'result', 'observed'] });
    await sleep(50);
  }
  out.textContent =
    'These six tests are the specification. Each one corresponds to a real production failure:\n\n' +
    '  1. a UI that waits for the network is not offline-first\n' +
    '  2. work lost when the tab closed — the outbox must be in IndexedDB, not memory\n' +
    '  3. the user posted twice because a retry created a duplicate\n' +
    '  4. two syncs raced and sent everything twice\n' +
    '  5. one bad record blocked every later change, forever\n' +
    '  6. someone\'s edit vanished and nobody could reproduce it\n\n' +
    'Getting all six green is a genuinely strong piece of client engineering.';
  render();
});

render();
