// Lab 04 — Cache API.

import { $, on, Log, renderTable, fmt, storageEstimate } from '/shared/lab-ui.js';
import { openDB, deleteDB, putMany, withStore, req } from '/browser-storage/idb.js';

const log = new Log('#log');
const out = $('out');
const CACHE = 'lab04';

on('basics', async () => {
  log.head('— put / match / keys / delete —');
  const cache = await caches.open(CACHE);

  // put() takes a Request (or URL string) and a Response. The Response body is consumed, so
  // you clone it if you also want to read it.
  const res = await fetch('/api/asset?name=cache-basics&type=json&cc=no-store');
  await cache.put('/api/asset?name=cache-basics&type=json&cc=no-store', res.clone());
  log.ok('stored one response');

  const hit = await cache.match('/api/asset?name=cache-basics&type=json&cc=no-store');
  log.line(`match → status ${hit.status}, ${(await hit.clone().text()).length} bytes`, 'macro');

  const keys = await cache.keys();
  log.line(`cache.keys() → ${keys.length} Request object(s): ${keys.map((k) => new URL(k.url).search).join(' ')}`, 'macro');

  const names = await caches.keys();
  log.line(`caches.keys() → ${names.join(', ')}`, 'macro');

  await cache.delete('/api/asset?name=cache-basics&type=json&cc=no-store');
  log.line(`after delete, match → ${await cache.match('/api/asset?name=cache-basics&type=json&cc=no-store') ? 'still there' : 'gone'}`, 'good');

  out.textContent =
    'The whole API is five methods: caches.open/keys/delete/match, and on a cache:\n' +
    '  match(request, options) · matchAll · add · addAll · put · delete · keys\n\n' +
    'Two things to internalise:\n' +
    '  • the KEY is a Request, not a string — so method, and (with Vary) headers, participate\n' +
    '  • there is NO expiry, NO LRU, NO size limit. Nothing is ever removed unless you remove it\n' +
    '    or the browser evicts the whole origin. Every retention policy is yours to write.';
});

on('addAll', async () => {
  log.head('— addAll, and how it fails —');
  const cache = await caches.open(CACHE);

  const good = ['/shared/lab.css', '/shared/lab-ui.js'];
  const t0 = performance.now();
  await cache.addAll(good);
  log.ok(`addAll of ${good.length} URLs in ${fmt.ms(performance.now() - t0)}`);

  try {
    await cache.addAll(['/shared/lab.css', '/definitely-not-here.js']);
    log.bad('addAll succeeded with a 404 in the list — unexpected');
  } catch (err) {
    log.ok(`addAll rejected: ${err.name} — ${err.message}`);
    log.muted('One failure rejects the whole call and NOTHING is added (it is atomic). That is ' +
      'the behaviour you want for a precache — a half-populated app shell is worse than none — ' +
      'and it means one stale URL in a hand-written manifest blocks every deploy.');
  }

  log.muted('add()/addAll() fetch with the default cache mode, so they can store a stale HTTP-cached ' +
    'copy. For a precache, fetch with { cache: "reload" } and put() the result instead.');
});

on('matchOptions', async () => {
  log.head('— matchOptions —');
  const cache = await caches.open(CACHE);
  const base = '/api/asset?name=match-demo&type=json&cc=no-store';
  await cache.put(base, await fetch(base));

  const withQuery = `${base}&utm_source=newsletter`;
  log.line(`match("${'…&utm_source=newsletter'}") → ${await cache.match(withQuery) ? 'HIT' : 'miss'}`, 'macro');
  log.line(`match(…, {ignoreSearch: true}) → ${await cache.match(withQuery, { ignoreSearch: true }) ? 'HIT' : 'miss'}`, 'good');

  log.muted('ignoreSearch drops the query string from the comparison. Useful for analytics ' +
    'parameters that do not change the resource — and dangerous for anything where the query IS ' +
    'the resource (a search, a page number, an id).');
  log.muted('ignoreVary ignores the stored response\'s Vary header. Without it, a stored response ' +
    'with `Vary: Accept-Encoding` only matches a request with the same Accept-Encoding — which is ' +
    'why service-worker caches sometimes "miss" a resource that is visibly in the cache.');
  log.muted('ignoreMethod treats a HEAD request as a GET.');

  out.textContent =
    'The cache key is a Request. That means the query string counts, the method counts, and the\n' +
    'stored response\'s Vary header counts. Three separate reasons for a "why is this a miss when\n' +
    'I can see it in DevTools" bug, and three flags that fix them.\n\n' +
    'caches.match(request) (on the global, not a specific cache) searches EVERY cache in order,\n' +
    'which is convenient and makes it very easy to get a hit from a cache you had forgotten about.';
});

on('synthetic', async () => {
  log.head('— storing a response you constructed —');
  const cache = await caches.open(CACHE);

  const body = JSON.stringify({ generated: true, at: new Date().toISOString(), items: [1, 2, 3] });
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-cached-at': String(Date.now()) },
  });
  await cache.put('/virtual/my-data', response);

  const hit = await cache.match('/virtual/my-data');
  log.ok(`stored under a URL that does not exist: ${await hit.text()}`);
  log.muted(`its x-cached-at header: ${(await cache.match('/virtual/my-data')).headers.get('x-cached-at')}`);

  out.textContent =
    'Nothing requires a cached Response to have come from the network, or the URL to exist. You\n' +
    'can synthesise responses and store them under any same-origin URL.\n\n' +
    'This is how you attach metadata: the Cache API stores no metadata of its own, so a store\n' +
    'timestamp, an etag you computed, or a "this is stale" flag goes into a header on a\n' +
    'reconstructed Response. Every expiry implementation over Cache Storage does exactly this.\n\n' +
    'It is also how offline fallbacks and mock APIs are built inside a service worker.';
});

on('vsIdb', async () => {
  const count = Number($('count').value), mb = Number($('mb').value);
  log.head(`— ${count} × ${mb}MB binary: Cache API vs IndexedDB —`);
  const bytes = count * mb * 1048576;
  const results = [];

  const before = await storageEstimate();

  // Cache API
  const cache = await caches.open('lab04-blobs');
  let t0 = performance.now();
  for (let i = 0; i < count; i++) {
    const buf = new Uint8Array(mb * 1048576).fill(i % 255);
    await cache.put(`/blob/${i}`, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }));
  }
  const cacheWrite = performance.now() - t0;

  t0 = performance.now();
  for (let i = 0; i < count; i++) await (await cache.match(`/blob/${i}`)).arrayBuffer();
  const cacheRead = performance.now() - t0;

  // IndexedDB
  const db = await openDB('lab04-blobs', 1, (d) => {
    if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'id' });
  });
  t0 = performance.now();
  const items = Array.from({ length: count }, (_, i) => ({
    id: i, blob: new Blob([new Uint8Array(mb * 1048576).fill(i % 255)]),
  }));
  await putMany(db, 'blobs', items);
  const idbWrite = performance.now() - t0;

  t0 = performance.now();
  for (let i = 0; i < count; i++) {
    const rec = await withStore(db, 'blobs', 'readonly', (s) => req(s.get(i)));
    await rec.blob.arrayBuffer();
  }
  const idbRead = performance.now() - t0;
  db.close();

  const after = await storageEstimate();

  results.push(
    { api: 'Cache API', 'write ms': Math.round(cacheWrite), 'read ms': Math.round(cacheRead),
      'write MB/s': Math.round((bytes / 1048576) / (cacheWrite / 1000)) },
    { api: 'IndexedDB (Blob)', 'write ms': Math.round(idbWrite), 'read ms': Math.round(idbRead),
      'write MB/s': Math.round((bytes / 1048576) / (idbWrite / 1000)) },
  );
  renderTable('#results', results, { columns: ['api', 'write ms', 'read ms', 'write MB/s'] });
  log.muted(`storage usage: ${before.usageFmt} → ${after.usageFmt}`);

  out.textContent =
    'Both store binary efficiently. The choice is not about speed, it is about what you need:\n\n' +
    'Cache API when the thing IS an HTTP response: you want to serve it back from a service\n' +
    '  worker fetch handler, you care about its headers, and the URL is the natural key.\n\n' +
    'IndexedDB when the thing is DATA: you need queries, indexes, transactions, or partial\n' +
    '  updates. A Blob in an IDB record can sit alongside its metadata in one atomic write —\n' +
    '  with the Cache API you would need a second store for the metadata and no way to keep\n' +
    '  the two consistent.\n\n' +
    'Common good design: metadata and small fields in IndexedDB, the bytes in Cache Storage keyed\n' +
    'by URL — with the IDB record holding the URL. You get queries AND a fetch-handler-friendly\n' +
    'binary store. Just remember that "consistent across two storage systems" is now your problem.';
});

on('usage', async () => {
  const e = await storageEstimate();
  const names = await caches.keys();
  const detail = [];
  for (const name of names) {
    const c = await caches.open(name);
    detail.push({ cache: name, entries: (await c.keys()).length });
  }
  renderTable('#results', detail, { columns: ['cache', 'entries'] });
  log.line(`origin usage ${e.usageFmt} of ${e.quotaFmt} (${(e.pct * 100).toFixed(2)}%)`, 'macro');
  if (e.details) log.muted(`per-API breakdown: ${JSON.stringify(e.details)}`);
  log.muted('usageDetails (Chrome only) splits usage by API — the only way to see whether it is ' +
    'your Cache Storage or your IndexedDB that grew.');
});

on('clearAll', async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await deleteDB('lab04-blobs').catch(() => {});
  log.bad('all caches and the blob database deleted');
  const e = await storageEstimate();
  log.muted(`usage now ${e.usageFmt}`);
});
