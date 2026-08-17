// Lab 02 — Validators.

import { $, on, Log, renderTable, resourceInfo, fmt, sleep } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

let generation = Math.floor(Math.random() * 1e6);
const showGen = () => { $('gen').textContent = `generation ${generation}`; };
showGen();

const rows = [];

function assetUrl(name, extra) {
  return `/api/asset?name=${name}&type=txt&size=${$('size').value}&delay=${$('delay').value}${extra}`;
}

async function stats() {
  return (await fetch('/api/stats', { cache: 'no-store' })).json();
}

/**
 * Fetch a URL and report what the network actually did. `resourceInfo` reads the
 * PerformanceResourceTiming entry, which is the only place a page can see transferSize.
 */
async function timedFetch(url, label) {
  const t0 = performance.now();
  const res = await fetch(url);
  const body = await res.text();
  const wall = performance.now() - t0;
  await sleep(0);
  const info = resourceInfo(url) || {};
  log.line(
    `${label.padEnd(26)} ${String(res.status).padStart(3)}  ${fmt.ms(wall).padStart(8)}  ` +
    `wire ${fmt.bytes(info.transferSize).padStart(9)}  body ${fmt.bytes(body.length).padStart(9)}  ` +
    `${info.source ?? ''}`,
    info.transferSize === 0 ? 'good' : info.transferSize < 500 ? 'micro' : 'macro');
  return { status: res.status, wall, transferSize: info.transferSize, bodyLength: body.length, source: info.source };
}

function record(row) {
  rows.push(row);
  renderTable('#results', rows, {
    columns: ['scenario', 'first ms', 'first wire', 'second ms', 'second wire', 'saved', 'verdict'],
  });
}

/**
 * The standard shape for every demo: fetch twice with max-age=0 (so the second one is stale
 * and must revalidate), and compare.
 */
async function revalidationTest(scenario, validatorParams, note = '') {
  const name = `${scenario.replace(/\W+/g, '-')}-${generation}-${Date.now()}`;
  const url = assetUrl(name, `&cc=max-age%3D0${validatorParams}`);
  log.head(`— ${scenario} —`);

  const first = await timedFetch(url, 'first (cold)');
  const second = await timedFetch(url, 'second (stale)');

  const saved = first.transferSize - second.transferSize;
  record({
    scenario,
    'first ms': Math.round(first.wall),
    'first wire': fmt.bytes(first.transferSize),
    'second ms': Math.round(second.wall),
    'second wire': fmt.bytes(second.transferSize),
    saved: fmt.bytes(Math.max(saved, 0)),
    verdict: second.status === 304 || second.transferSize < 500 ? '304 — body reused' : '200 — full download',
    _savedClass: saved > 1000 ? 'ok' : 'no',
  });
  if (note) out.textContent = note;
  return { first, second };
}

// ---------------------------------------------------------------------------

on('etag', () => revalidationTest('ETag', '&etag=1',
  'The second request sent If-None-Match: "<etag>". The server compared it, found no change, and\n' +
  'replied 304 with no body. You paid one round trip (network latency) and saved the entire\n' +
  'payload. That is the whole deal: revalidation converts a bandwidth cost into a latency cost.'
).catch((e) => log.bad(e.message)));

on('lastmod', () => revalidationTest('Last-Modified', '&lm=1',
  'Same trade, weaker validator. If-Modified-Since has ONE SECOND of resolution, so a file that\n' +
  'changes twice within the same second is indistinguishable from one that did not change. It is\n' +
  'also date-based, so a clock skew between your servers turns into cache bugs.\n\n' +
  'Use it as a fallback, never as your only validator.'
).catch((e) => log.bad(e.message)));

on('novalidator', () => revalidationTest('no validator', '',
  'No ETag, no Last-Modified: nothing to revalidate WITH. The browser cannot ask "has this\n' +
  'changed?", so every stale entry costs a full download. This is the invisible half of\n' +
  '`Cache-Control: no-cache` — without a validator it is exactly as expensive as no-store.'
).catch((e) => log.bad(e.message)));

on('weak', async () => {
  await revalidationTest('strong ETag', '&etag=1');
  await revalidationTest('weak ETag (W/)', '&etag=1&weak=1');
  out.textContent =
    'Both revalidate fine — for caching, weak and strong ETags behave identically.\n\n' +
    'The difference is what else the ETag may be used for:\n' +
    '  strong: byte-for-byte identical. Usable for Range requests (resuming a download) and for\n' +
    '          If-Match on writes (optimistic concurrency control).\n' +
    '  weak:   "semantically equivalent". A gzip level change or a timestamp comment in the body\n' +
    '          does not break it — but a range request against it could splice two different\n' +
    '          bodies together, so servers must refuse.\n\n' +
    'If your ETag is a hash of the response body, it is strong. If it is a hash of the underlying\n' +
    'record ("post 42 rev 7"), it is weak — mark it W/ and stop lying.';
});

// ---------------------------------------------------------------------------
// 5. Content actually changed
// ---------------------------------------------------------------------------

on('changed', async () => {
  const name = `changed-${generation}-${Date.now()}`;
  const url = assetUrl(name, '&cc=max-age%3D0&etag=1');
  log.head('— content changes between requests —');

  const a = await timedFetch(url, 'first');
  await fetch(`/api/bump?name=${name}`);           // the file changed on the server
  log.muted('server content bumped to v2');
  const b = await timedFetch(url, 'after change');

  record({
    scenario: 'ETag, content changed',
    'first ms': Math.round(a.wall),
    'first wire': fmt.bytes(a.transferSize),
    'second ms': Math.round(b.wall),
    'second wire': fmt.bytes(b.transferSize),
    saved: '0 B',
    verdict: '200 — new body, correctly',
  });
  out.textContent =
    'The ETag changed, so the conditional request missed and the server sent the new body with\n' +
    '200. This is the system working: the browser asked, the server answered honestly, the user\n' +
    'got fresh content. One round trip of overhead vs no-store — for a payload that DID change.';
});

// ---------------------------------------------------------------------------
// 6. The server lies
// ---------------------------------------------------------------------------

on('frozen', async () => {
  const name = `frozen-${generation}-${Date.now()}`;
  const url = assetUrl(name, '&cc=max-age%3D0&etag=1&freeze=1');
  log.head('— a server whose ETag does not track its content —');

  const first = await fetch(url).then((r) => r.text());
  log.line(`first body starts: ${first.slice(0, 24)}`, 'macro');

  await fetch(`/api/bump?name=${name}`);
  log.muted('server content bumped to v2 — but this endpoint pins its ETag to v1');

  const second = await fetch(url).then((r) => r.text());
  log.line(`second body starts: ${second.slice(0, 24)}`, first === second ? 'bad' : 'good');

  const same = first.split('\n')[0] === second.split('\n')[0];
  log.line(same
    ? 'the browser served the STALE body — the change is invisible until the cache entry dies'
    : 'the browser got the new body (your cache had already dropped the entry)',
    same ? 'bad' : 'micro');

  out.textContent =
    'This is the failure mode nobody debugs quickly, because the server is behaving "correctly" —\n' +
    'it received If-None-Match, the tags matched, it returned 304. The bug is upstream: the ETag\n' +
    'is derived from something that is not the response body.\n\n' +
    'Real examples: ETag from the template file rather than the rendered output; ETag from the\n' +
    'DB row while the response also embeds a feature flag; ETag from the file inode on one server\n' +
    'in a load-balanced pool (inodes differ per machine → cache thrash, the opposite failure).\n\n' +
    'Rule: an ETag must be a function of the exact bytes you are about to send. Anything else is\n' +
    'a guess with a 304 attached to it.';
});

// ---------------------------------------------------------------------------
// 7. Revalidation storm
// ---------------------------------------------------------------------------

on('storm', async () => {
  log.head('— 30 assets, max-age=0 + ETag vs max-age=60 —');
  const N = 30;

  const run = async (label, cc) => {
    const base = `storm-${cc.replace(/\W/g, '')}-${generation}-${Date.now()}`;
    const urls = Array.from({ length: N }, (_, i) => assetUrl(`${base}-${i}`, `&cc=${cc}&etag=1`));
    await Promise.all(urls.map((u) => fetch(u).then((r) => r.text())));    // prime
    const before = (await stats()).hits;
    const t0 = performance.now();
    await Promise.all(urls.map((u) => fetch(u).then((r) => r.text())));    // repeat visit
    const wall = performance.now() - t0;
    const after = (await stats()).hits;
    const serverHits = Object.keys(after)
      .filter((k) => k.includes(base))
      .reduce((n, k) => n + (after[k] - (before[k] || 0)), 0);
    log.line(`${label.padEnd(28)} ${fmt.ms(wall).padStart(9)} for the repeat visit, ${serverHits} server hits`,
      serverHits === 0 ? 'good' : 'bad');
    return { strategy: label, 'repeat visit ms': Math.round(wall), 'server hits': serverHits };
  };

  const a = await run('max-age=0 + ETag', 'max-age%3D0');
  const b = await run('max-age=60', 'max-age%3D60');

  renderTable('#results', [a, b], { columns: ['strategy', 'repeat visit ms', 'server hits'] });
  rows.length = 0;
  out.textContent =
    `Both are "cached". One of them still costs ${a['server hits']} round trips on every single page\n` +
    'load, serialised behind the connection limit.\n\n' +
    'This is the most common real-world caching failure: everything has an ETag, everything\n' +
    'revalidates, nothing is ever fresh, and the site is slow on repeat visits *despite* a 100%\n' +
    'cache hit rate. The metric that hides it is "cache hit ratio" — 304s count as hits.\n\n' +
    'Watch the request count, not the hit ratio.';
});

// ---------------------------------------------------------------------------
// 8. Does a 304 refresh freshness?
// ---------------------------------------------------------------------------

on('refresh304', async () => {
  const name = `refresh-${generation}-${Date.now()}`;
  const url = assetUrl(name, '&cc=max-age%3D3&etag=1');
  log.head('— max-age=3: fetch, wait 4s (stale), revalidate, then fetch again immediately —');

  await timedFetch(url, 'first');
  log.muted('waiting 4s…');
  await sleep(4000);
  await timedFetch(url, 'after 4s (stale)');
  const third = await timedFetch(url, 'immediately after');

  log.line(third.transferSize === 0
    ? 'served from cache with NO network — the 304 refreshed the entry\'s freshness'
    : 'hit the network again — freshness was not extended',
    third.transferSize === 0 ? 'good' : 'bad');

  out.textContent =
    'A 304 is not just "no body" — it carries headers, and those headers replace the stored ones.\n' +
    'So a 304 that includes Cache-Control: max-age=3 restarts the freshness clock, and the next\n' +
    'request within 3 seconds needs no network at all.\n\n' +
    'Corollary: if your 304 responses omit Cache-Control (a very common misconfiguration in\n' +
    'hand-rolled conditional-request code), every subsequent request revalidates forever.';
});

on('fresh', () => {
  generation = Math.floor(Math.random() * 1e6);
  showGen();
  rows.length = 0;
  $('results').textContent = '';
  log.clear();
});
