// Lab 05 — Vary & cache keys.

import { $, on, Log, renderTable, resourceInfo, fmt, sleep } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

let generation = Math.floor(Math.random() * 1e6);
const showGen = () => { $('gen').textContent = `generation ${generation}`; };
showGen();

async function serverHits(name) {
  const stats = await (await fetch('/api/stats', { cache: 'no-store' })).json();
  return stats.hits[`asset:${name}`] || 0;
}

/** Fetch with a custom header and report the body + whether the network was used. */
async function get(url, headers = {}) {
  const res = await fetch(url, { headers });
  const body = await res.json();
  await sleep(0);
  const info = resourceInfo(url) || {};
  return {
    echo: body.echo,
    version: body.version,
    fromCache: info.transferSize === 0,
    wire: info.transferSize,
  };
}

// ---------------------------------------------------------------------------
// 1 & 2 — content negotiation, with and without Vary
// ---------------------------------------------------------------------------

async function varyTest(sendVary) {
  const name = `vary${sendVary ? 'Y' : 'N'}-${generation}-${Date.now()}`;
  const url = `/api/asset?name=${name}&type=json&cc=max-age%3D60&echoHeader=x-lang` +
    (sendVary ? '&vary=x-lang' : '');

  log.head(`— body depends on x-lang; Vary: x-lang ${sendVary ? 'IS' : 'is NOT'} sent —`);

  const rows = [];
  const sequence = [
    ['en', 'first request'],
    ['en', 'same language again'],
    ['de', 'different language'],
    ['de', 'same language again'],
    ['en', 'back to the first language'],
  ];

  for (const [lang, note] of sequence) {
    const r = await get(url, { 'x-lang': lang });
    const correct = r.echo === lang;
    rows.push({
      'requested x-lang': lang,
      note,
      'body received': `echo=${r.echo}`,
      correct: correct ? 'yes' : 'NO — wrong content',
      network: r.fromCache ? 'cache (0 bytes)' : `network (${fmt.bytes(r.wire)})`,
      _correctClass: correct ? 'ok' : 'no',
    });
    log.line(`x-lang: ${lang.padEnd(3)} → body says ${String(r.echo).padEnd(16)} ` +
      `${r.fromCache ? 'from cache' : 'from network'}  ${correct ? '' : '  ← WRONG CONTENT'}`,
      correct ? 'good' : 'bad');
  }

  renderTable('#results', rows, {
    columns: ['requested x-lang', 'note', 'body received', 'correct', 'network'],
  });

  const hits = await serverHits(name);
  log.muted(`server saw ${hits} of 5 requests`);

  out.textContent = sendVary
    ? `Correct. The cache stored TWO entries under the same URL — one per x-lang value — because\n` +
      `Vary told it the header is part of the key. Server hits: ${hits} of 5 (one per language).\n\n` +
      `Cost: your hit rate is now divided by the number of distinct values of that header. That is\n` +
      `fine for a 2-value header and catastrophic for User-Agent (demo 3).`
    : `Poisoned. The cache stored ONE entry and served the English body to the German request,\n` +
      `because nothing told it the header mattered. Server hits: ${hits} of 5.\n\n` +
      `This is not a browser bug — the browser did exactly what the response said. Every cache in\n` +
      `the chain does the same thing, which is why this bug shows up as "some users see the wrong\n` +
      `language/currency/theme" and is impossible to reproduce locally.\n\n` +
      `Rule: if a request header changes the response body, that header MUST be in Vary.`;
}

on('withVary', () => varyTest(true).catch((e) => log.bad(e.message)));
on('withoutVary', () => varyTest(false).catch((e) => log.bad(e.message)));

// ---------------------------------------------------------------------------
// 3 — cache shattering
// ---------------------------------------------------------------------------

async function shatter() {
  log.head('— what Vary costs you: one entry per distinct header value —');

  const name = `shatter-${generation}-${Date.now()}`;
  const url = `/api/asset?name=${name}&type=json&cc=max-age%3D60&vary=x-variant&echoHeader=x-variant`;

  const VARIANTS = 12;
  for (let i = 0; i < VARIANTS; i++) {
    await get(url, { 'x-variant': `client-build-${i}` });
  }
  // Now repeat the whole set: with a shattered cache, none of these should be free… they will be,
  // because each variant has its own entry. The cost is the FIRST visit, times N.
  let cached = 0;
  for (let i = 0; i < VARIANTS; i++) {
    const r = await get(url, { 'x-variant': `client-build-${i}` });
    if (r.fromCache) cached++;
  }
  const hits = await serverHits(name);

  renderTable('#results', [{
    'distinct header values': VARIANTS,
    'requests made': VARIANTS * 2,
    'server hits': hits,
    'cache hits on the repeat pass': cached,
  }], { columns: ['distinct header values', 'requests made', 'server hits', 'cache hits on the repeat pass'] });

  log.line(`${VARIANTS} variants → ${hits} server hits for ${VARIANTS * 2} requests`, 'macro');

  out.textContent =
    'Every distinct value of a Vary header creates a separate cache entry for the same URL.\n\n' +
    'With 12 variants you need 12 downloads before anyone benefits. Now consider\n' +
    '`Vary: User-Agent`: there are hundreds of thousands of distinct UA strings in the wild, so a\n' +
    'CDN cache keyed on it has an effective hit rate near zero, and your origin serves nearly every\n' +
    'request. It is the single most expensive header misuse there is.\n\n' +
    'If you need UA-based responses, normalise first: have the edge map the UA to a small set\n' +
    '(mobile/desktop/bot) and Vary on THAT — most CDNs expose exactly this as a feature.\n\n' +
    'Safe to Vary on: Accept-Encoding (2–3 values), Accept (few), Accept-Language (normalise to\n' +
    'your supported set), a normalised device class.\n' +
    'Dangerous: User-Agent, Cookie (unnormalised), Referer, anything with unbounded values.';
}

on('shatter', () => shatter().catch((e) => log.bad(e.message)));

// ---------------------------------------------------------------------------
// 4 — Vary: Cookie
// ---------------------------------------------------------------------------

async function cookies() {
  log.head('— Vary: Cookie, and why authenticated responses need `private` too —');

  // A cookie JS can see and change, so we can toggle "logged in" from the page.
  document.cookie = 'lab_user=alice; path=/; SameSite=Lax';
  const name = `cookie-${generation}-${Date.now()}`;
  const url = `/api/asset?name=${name}&type=json&cc=max-age%3D60&vary=cookie&echoHeader=cookie`;

  const rows = [];
  const a = await get(url);
  rows.push({ 'document.cookie': 'lab_user=alice', 'body echo': String(a.echo).slice(0, 40), network: a.fromCache ? 'cache' : 'network' });
  log.line(`as alice   → ${String(a.echo).slice(0, 50)}`, 'macro');

  document.cookie = 'lab_user=bob; path=/; SameSite=Lax';
  const b = await get(url);
  rows.push({ 'document.cookie': 'lab_user=bob', 'body echo': String(b.echo).slice(0, 40), network: b.fromCache ? 'cache' : 'network' });
  log.line(`as bob     → ${String(b.echo).slice(0, 50)}  ${b.fromCache ? '(FROM CACHE — would be alice\'s data without Vary)' : '(network — new cache key)'}`,
    b.fromCache ? 'bad' : 'good');

  document.cookie = 'lab_user=alice; path=/; SameSite=Lax';
  const c = await get(url);
  rows.push({ 'document.cookie': 'lab_user=alice (again)', 'body echo': String(c.echo).slice(0, 40), network: c.fromCache ? 'cache' : 'network' });
  log.line(`back to alice → ${c.fromCache ? 'served from cache — correct, it is her entry' : 'network'}`, 'good');

  renderTable('#results', rows, { columns: ['document.cookie', 'body echo', 'network'] });

  out.textContent =
    'Vary: Cookie makes the whole Cookie header part of the cache key. That is correct and almost\n' +
    'useless in production: every analytics cookie, consent cookie and A/B bucket changes the key,\n' +
    'so the hit rate collapses. And it does NOT make the response safe to store in a shared cache —\n' +
    'a CDN would happily hold per-user copies, keyed by a header containing session tokens.\n\n' +
    'What you actually do for authenticated responses:\n' +
    '  Cache-Control: private, no-cache      ← private keeps shared caches out entirely\n' +
    '  ETag: "<hash of the personalised body>"\n' +
    'and then, if you want edge caching, split the page: a cacheable public shell plus a small\n' +
    'private request for the personalised bits. That is what "cache the page, not the person"\n' +
    'means in practice.\n\n' +
    'Also note: a response to a request carrying `Authorization` must not be stored by shared\n' +
    'caches at all unless it explicitly says `public` (or s-maxage/must-revalidate). The spec\n' +
    'protects you there; nothing protects you from a Cookie-based session.';
}

on('cookies', () => cookies().catch((e) => log.bad(e.message)));

// ---------------------------------------------------------------------------
// 5 — the rest of the cache key
// ---------------------------------------------------------------------------

async function keys() {
  log.head('— what else changes the cache key? —');
  const base = `keys-${generation}-${Date.now()}`;
  const rows = [];

  const probe = async (label, url, init = {}) => {
    const before = await serverHits(url.match(/name=([^&]+)/)[1]);
    await fetch(url, init).then((r) => r.text()).catch(() => {});
    await fetch(url, init).then((r) => r.text()).catch(() => {});
    const after = await serverHits(url.match(/name=([^&]+)/)[1]);
    const shared = after - before <= 1;
    rows.push({ probe: label, 'server hits for 2 identical requests': after - before, 'reused the entry?': shared ? 'yes' : 'no' });
    log.line(`${label.padEnd(46)} ${after - before} hit(s)`, shared ? 'good' : 'macro');
  };

  const cc = '&cc=max-age%3D60';
  await probe('GET, same URL twice', `/api/asset?name=${base}-a&type=json${cc}`);
  await probe('same path, different query string', `/api/asset?name=${base}-b&type=json${cc}&extra=1`);
  await probe('POST (never cached)', `/api/asset?name=${base}-c&type=json${cc}`, { method: 'POST' })
    .catch(() => log.muted('POST to a static route is rejected by the lab server — that is fine, the point stands'));

  renderTable('#results', rows, { columns: ['probe', 'server hits for 2 identical requests', 'reused the entry?'] });

  out.textContent =
    'The HTTP cache key is, roughly:\n' +
    '   method + full URL (including query) + everything named by Vary\n' +
    'and in modern browsers, also:\n' +
    '   the top-level site (cache partitioning — since 2020 Chrome and Safari partition the HTTP\n' +
    '   cache by the top-level origin, so example.com and other.com no longer share a cached copy\n' +
    '   of the same CDN file). This killed the "shared CDN cache" argument for public libraries;\n' +
    '   loading React from a public CDN gets you no cross-site cache hit any more, only an extra\n' +
    '   connection.\n\n' +
    'Only GET (and HEAD) responses are cached. A POST is never served from cache — which is why\n' +
    '"we made it a POST for safety" quietly turns a cacheable read into an uncacheable one, and\n' +
    'is a real cause of load on GraphQL endpoints.';
}

on('keys', () => keys().catch((e) => log.bad(e.message)));

on('reset', () => {
  generation = Math.floor(Math.random() * 1e6);
  showGen();
  $('results').textContent = '';
  log.clear();
});
