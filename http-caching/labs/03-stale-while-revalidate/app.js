// Lab 03 — stale-while-revalidate.

import { $, on, Log, renderTable, renderBars, resourceInfo, fmt, sleep } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

let generation = Math.floor(Math.random() * 1e6);
const showGen = () => { $('gen').textContent = `generation ${generation}`; };
showGen();

const summary = [];

async function serverHits(name) {
  const stats = await (await fetch('/api/stats', { cache: 'no-store' })).json();
  return stats.hits[`asset:${name}`] || 0;
}

/**
 * Poll one URL repeatedly, bumping the server-side content halfway through, and record
 * latency + which version the caller actually received.
 */
async function poll({ label, cc, extra = '', status = null }) {
  const n = Number($('polls').value);
  const delay = Number($('delay').value);
  const name = `swr-${label.replace(/\W+/g, '')}-${generation}-${Date.now()}`;
  const url = `/api/asset?name=${name}&type=json&delay=${delay}` +
    (cc ? `&cc=${encodeURIComponent(cc)}` : '') + extra;

  log.head(`— ${label} — polling every 800ms, ${n} times, server delay ${delay}ms —`);
  $('bars').textContent = '';

  const samples = [];
  const bumpAt = Math.floor(n / 2);
  let staleServed = 0;
  let networkHits = 0;
  let sawNewVersionAt = null;

  for (let i = 0; i < n; i++) {
    if (i === bumpAt) {
      await fetch(`/api/bump?name=${name}`, { cache: 'no-store' });
      log.bad(`poll ${i}: server content bumped to v2 ←`);
    }
    if (i === bumpAt + 1 && status) {
      log.bad('the origin is now failing (503) for the rest of the run');
    }

    const t0 = performance.now();
    let version = '?';
    let ok = true;
    try {
      const res = await fetch(status && i > bumpAt ? `${url}&status=${status}` : url);
      const text = await res.text();
      version = (() => { try { return JSON.parse(text).version; } catch { return `HTTP ${res.status}`; } })();
      ok = res.ok;
    } catch (err) {
      version = 'network error';
      ok = false;
    }
    const wall = performance.now() - t0;
    await sleep(0);
    const info = resourceInfo(url.split('&t=')[0]) || {};
    const fromCache = wall < delay * 0.5;
    if (fromCache) staleServed++; else networkHits++;
    if (version === 2 && sawNewVersionAt === null) sawNewVersionAt = i;

    samples.push({
      label: `poll ${i}${i === bumpAt ? ' (bump)' : ''}`,
      value: wall,
      cls: fromCache ? 'good' : 'bad',
      text: `${fmt.ms(wall)}  v${version}`,
    });
    renderBars('#bars', samples, { max: Math.max(delay * 1.4, 200) });
    log.line(`poll ${String(i).padStart(2)}  ${fmt.ms(wall).padStart(8)}  version ${version}  ` +
      `${fromCache ? 'from cache' : 'from network'}  ${ok ? '' : '(response not ok)'}`,
      fromCache ? 'good' : 'macro');

    await sleep(800);
  }

  const hits = await serverHits(name);
  const avg = samples.reduce((a, b) => a + b.value, 0) / samples.length;
  summary.push({
    config: label,
    'avg ms': Math.round(avg),
    'slow polls (network)': networkHits,
    'instant polls (cache)': staleServed,
    'server hits': hits,
    'polls until v2 seen': sawNewVersionAt === null ? 'never' : sawNewVersionAt - bumpAt,
    _avgClass: avg < 100 ? 'ok' : avg < 400 ? 'meh' : 'no',
  });
  renderTable('#results', summary, {
    columns: ['config', 'avg ms', 'slow polls (network)', 'instant polls (cache)', 'server hits', 'polls until v2 seen'],
  });
  return summary[summary.length - 1];
}

// ---------------------------------------------------------------------------

on('nostore', () => poll({ label: 'A. no-store', cc: 'no-store' }).then(() => {
  out.textContent =
    'Every poll pays the full server delay. Always correct, always slow. This is the baseline\n' +
    'that people reach for when they are scared of staleness — note that it also means the user\n' +
    'waits on every single interaction, and your origin takes every single request.';
}).catch((e) => log.bad(e.message)));

on('maxage', () => poll({ label: 'B. max-age=3', cc: 'max-age=3', extra: '&etag=1' }).then(() => {
  out.textContent =
    'A sawtooth: instant while fresh, then one slow poll when the entry goes stale, then instant\n' +
    'again. The user experience is inconsistent — most interactions are free and every fourth one\n' +
    'takes 600ms, which feels worse than a uniformly slow page because it is unpredictable.\n\n' +
    'Note when the version number caught up: the first request AFTER expiry both waited AND got\n' +
    'the new data. Correct, but the waiting is what we want to remove.';
}).catch((e) => log.bad(e.message)));

on('swr', () => poll({
  label: 'C. max-age=3, swr=30',
  cc: 'max-age=3, stale-while-revalidate=30',
  extra: '&etag=1',
}).then((row) => {
  out.textContent =
    'Every poll is instant, including the ones after expiry — the browser serves the stale copy\n' +
    'immediately and revalidates in the background. Look at the "server hits" column: the network\n' +
    `still happened (${row['server hits']} times), it just happened off the critical path.\n\n` +
    'The cost is exactly one poll of staleness: after the bump, one caller still receives v1, and\n' +
    'the next caller gets v2. For a nav menu, a config blob, a feature-flag payload, an avatar —\n' +
    'that is a trade worth making every time. For a bank balance it is not.';
}).catch((e) => log.bad(e.message)));

on('sie', () => poll({
  label: 'D. stale-if-error=60',
  cc: 'max-age=3, stale-if-error=60',
  extra: '&etag=1',
  status: 503,
}).then(() => {
  out.textContent =
    'stale-if-error says: if revalidation fails (5xx, timeout, connection error), keep serving the\n' +
    'stale copy for N more seconds instead of surfacing the error.\n\n' +
    'IMPORTANT: browser support is thin — Chrome does not implement stale-if-error in its HTTP\n' +
    'cache (it does implement stale-while-revalidate). If you saw the 503 reach your code above,\n' +
    'that is why. CDNs (Fastly, Cloudflare, Akamai) DO implement it, and it is one of the highest\n' +
    'value-per-character headers you can add at the edge.\n\n' +
    'In the browser you get this behaviour by implementing it yourself — which is demo E, and the\n' +
    'service-worker course does it properly.';
}).catch((e) => log.bad(e.message)));

// ---------------------------------------------------------------------------
// E. TODO — implement SWR yourself.
//
// Requirements:
//   1. swrFetch(url, { maxAge, staleWhileRevalidate, staleIfError }) returns a Response.
//   2. Fresh entry  → return it, no network.
//   3. Stale but within the SWR window → return it immediately AND kick off a background
//      refresh. Do not await the refresh.
//   4. Stale beyond the SWR window → await the network.
//   5. Network fails and the entry is within the staleIfError window → return the stale entry
//      and attach a header or property saying so.
//   6. Only ONE background refresh per URL may be in flight at a time (request coalescing).
//      This matters more than it sounds: without it, a stale entry read by 20 components fires
//      20 identical requests in the same tick.
//   7. Storage: use the Cache API, so it survives a reload. `caches.open('swr-v1')`.
//
// Then run this demo and compare its bars to C.
// ---------------------------------------------------------------------------

async function manualSwr() {
  throw new Error('TODO: implement swrFetch() in app.js — see the README');
}

on('manual', () => manualSwr().catch((e) => log.bad(e.message)));

on('reset', () => {
  generation = Math.floor(Math.random() * 1e6);
  showGen();
  summary.length = 0;
  $('results').textContent = '';
  $('bars').textContent = '';
  log.clear();
});
