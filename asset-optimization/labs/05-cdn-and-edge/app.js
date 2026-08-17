// Lab 05 — CDN & edge.

import { $, on, Log, renderTable, fmt, sleep } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const originPath = () => `/api/asset?name=edge-demo&type=json&delay=${$('delay').value}&size=40000`;

async function edge({ pop = 'lhr', ttl = null, path = null, extra = '' } = {}) {
  const url = `/api/edge?path=${encodeURIComponent(path ?? originPath())}` +
    `&pop=${pop}&ttl=${ttl ?? $('ttl').value}${extra}`;
  const t0 = performance.now();
  const res = await fetch(url, { cache: 'no-store' });
  await res.arrayBuffer();
  return {
    ms: performance.now() - t0,
    cache: res.headers.get('x-cache'),
    pop: res.headers.get('x-cache-pop'),
    age: res.headers.get('age'),
    originMs: res.headers.get('x-origin-ms'),
  };
}

on('basics', async () => {
  log.head('— a cold POP, then a warm one —');
  await fetch(`/api/edge?path=${encodeURIComponent(originPath())}&purge=1`);
  const rows = [];
  for (const label of ['first request (cold)', 'second', 'third']) {
    const r = await edge();
    rows.push({
      request: label, ms: Math.round(r.ms), 'x-cache': r.cache, age: r.age,
      'origin ms': r.originMs ?? '—',
      _cacheClass: r.cache === 'HIT' ? 'ok' : 'meh',
    });
    log.line(`${label.padEnd(22)} ${String(Math.round(r.ms)).padStart(5)}ms  ${r.cache}`,
      r.cache === 'HIT' ? 'good' : 'macro');
  }
  renderTable('#results', rows, { columns: ['request', 'ms', 'x-cache', 'age', 'origin ms'] });

  out.textContent =
    'The first request pays the origin; every request after it is served from the edge until the\n' +
    'TTL expires.\n\n' +
    'That is the entire value proposition, and it has two independent parts that people conflate:\n' +
    '  1. FEWER ORIGIN REQUESTS — your servers do less work, which is a capacity and cost win\n' +
    '  2. SHORTER DISTANCE — the response comes from a POP near the user, which is a latency win\n' +
    'and only the second one requires the CDN to be geographically distributed. A single-location\n' +
    'reverse-proxy cache gets you the first.';
});

on('pops', async () => {
  log.head('— the same object at four POPs —');
  await fetch(`/api/edge?path=${encodeURIComponent(originPath())}&purge=1`);
  const rows = [];
  for (const pop of ['lhr', 'jfk', 'nrt', 'syd']) {
    const first = await edge({ pop });
    const second = await edge({ pop });
    rows.push({
      POP: pop,
      'first request': `${Math.round(first.ms)}ms ${first.cache}`,
      'second request': `${Math.round(second.ms)}ms ${second.cache}`,
    });
    log.line(`${pop}: ${first.cache} then ${second.cache}`, 'macro');
  }
  renderTable('#results', rows, { columns: ['POP', 'first request', 'second request'] });

  out.textContent =
    'Every POP has its own cache, so every POP pays its own first miss. Consequences that matter:\n\n' +
    '  • your cache hit ratio is lower than you expect for long-tail content, because each POP\n' +
    '    must independently discover each object. A page viewed twice worldwide may miss twice.\n' +
    '  • the first user in each region pays origin latency, and that is exactly the user furthest\n' +
    '    from your origin\n' +
    '  • a purge must reach every POP, so purges are eventually-consistent by nature\n\n' +
    'Mitigations real CDNs offer: tiered caching (POPs pull from a regional parent rather than\n' +
    'from your origin, so the origin sees one miss instead of forty), and origin shielding (a\n' +
    'single designated POP is the only one allowed to talk to your origin). If your hit ratio is\n' +
    'poor and your origin load is high, that is the setting to look for.';
});

on('purge', async () => {
  log.head('— purging —');
  await edge({ pop: 'lhr' }); await edge({ pop: 'jfk' });
  log.muted('two POPs warmed');

  const before = await edge({ pop: 'lhr' });
  const purged = await (await fetch(`/api/edge?path=${encodeURIComponent(originPath())}&purge=1`)).json();
  const after = await edge({ pop: 'lhr' });

  renderTable('#results', [
    { step: 'before purge', result: `${Math.round(before.ms)}ms ${before.cache}` },
    { step: 'purge', result: `${purged.purged} entries across ${purged.pops.join(', ')}` },
    { step: 'after purge', result: `${Math.round(after.ms)}ms ${after.cache}` },
  ], { columns: ['step', 'result'] });

  out.textContent =
    'A purge invalidates the object everywhere and the next request pays the origin again.\n\n' +
    'What to know about real purges:\n' +
    '  • they are eventually consistent — "purge complete" means the instruction was accepted, not\n' +
    '    that every POP has applied it. Budget seconds, and do not build a workflow that assumes\n' +
    '    otherwise\n' +
    '  • purge BY TAG (surrogate keys), not by URL. One product change should invalidate that\n' +
    '    product page and the listings it appears on, and nothing else. Purging by URL means\n' +
    '    maintaining the dependency list in your application code, which rots\n' +
    '  • purge-all is a stampede: every POP misses simultaneously and your origin gets the full\n' +
    '    load. Treat it as an incident tool, not a deploy step\n' +
    '  • the alternative to purging is not purging: content-addressed URLs never need it\n' +
    '    (http-caching lab 04), which is why hashed asset filenames matter here too';
});

on('stampede', async () => {
  log.head('— 20 concurrent requests to a cold object —');
  await fetch(`/api/edge?path=${encodeURIComponent(originPath())}&purge=1`);

  const t0 = performance.now();
  const results = await Promise.all(Array.from({ length: 20 }, () => edge()));
  const wall = performance.now() - t0;
  const misses = results.filter((r) => r.cache !== 'HIT').length;

  renderTable('#results', [{
    'concurrent requests': 20,
    'origin misses': misses,
    'wall ms': Math.round(wall),
    verdict: misses > 3 ? 'STAMPEDE — the origin saw most of them' : 'collapsed to a few origin requests',
    _verdictClass: misses > 3 ? 'no' : 'ok',
  }], { columns: ['concurrent requests', 'origin misses', 'wall ms', 'verdict'] });
  log.line(`${misses} of 20 reached the origin`, misses > 3 ? 'bad' : 'good');

  out.textContent =
    'This toy CDN has no request collapsing, so a cold object under concurrent load sends every\n' +
    'request to the origin. That is a cache stampede, and it is how a caching layer turns a\n' +
    'traffic spike into an outage — the moment you most need the cache is the moment it is cold.\n\n' +
    'What real CDNs offer, and what to check your provider has enabled:\n' +
    '  • REQUEST COLLAPSING (coalescing): concurrent misses for the same key become ONE origin\n' +
    '    request; the rest wait for it. This is the single most important CDN setting nobody\n' +
    '    checks.\n' +
    '  • stale-while-revalidate at the edge: serve the old copy while refreshing (http-caching\n' +
    '    lab 03)\n' +
    '  • stale-if-error: keep serving when the origin is down. Free resilience.\n\n' +
    'It is the same coalescing pattern as the SWR map in the caching course and the `refreshing`\n' +
    'flag in the ISR lab. Every layer of a system needs it, and every layer forgets it.';
});

on('keys', () => {
  renderTable('#results', [
    { part: 'URL (path + query)', 'in the key by default': 'yes',
      note: 'strip tracking parameters at the edge, or ?utm_source=x is a separate copy of every page' },
    { part: 'Host', 'in the key by default': 'yes', note: '' },
    { part: 'Request method', 'in the key by default': 'yes', note: 'only GET/HEAD are cached' },
    { part: 'Anything in Vary', 'in the key by default': 'yes',
      note: 'Vary: Accept-Encoding is fine; Vary: User-Agent shatters the cache (caching lab 05)' },
    { part: 'Cookies', 'in the key by default': 'usually NO',
      note: 'but most CDNs BYPASS the cache entirely when a Set-Cookie or a cookie is present — check' },
    { part: 'Geo / device class', 'in the key by default': 'no',
      note: 'add it deliberately via a normalised header; never Vary on raw UA' },
    { part: 'Authorization', 'in the key by default': 'no',
      note: 'and shared caches must not store these responses unless marked public' },
  ], { columns: ['part', 'in the key by default', 'note'] });

  out.textContent =
    'The cache key is the whole game. Two failure modes, in opposite directions:\n\n' +
    '  TOO NARROW (over-varying): tracking parameters, cookies, or User-Agent in the key means\n' +
    '  every visitor gets their own copy and your hit ratio approaches zero. Symptom: high origin\n' +
    '  load with a "cached" site.\n\n' +
    '  TOO WIDE (under-varying): the personalised or locale-specific part of a response is cached\n' +
    '  and served to the wrong person. Symptom: users report seeing someone else\'s data. This is\n' +
    '  the incident version.\n\n' +
    'The design that avoids both: cache the SHARED shell aggressively and fetch or stream the\n' +
    'personal fragment separately (rendering-strategies lab 06). Then the key is simple and the\n' +
    'personalisation never touches the shared cache.';
});

on('cant', () => {
  renderTable('#results', [
    { problem: 'slow origin on a MISS', 'does the edge fix it?': 'no', why: 'the first user in every POP still waits' },
    { problem: 'uncacheable responses (per-user, no-store)', 'does the edge fix it?': 'no', why: 'nothing to cache' },
    { problem: 'too many bytes', 'does the edge fix it?': 'partly', why: 'closer, but the same bytes; compress and resize first' },
    { problem: 'render-blocking resources', 'does the edge fix it?': 'no', why: 'that is a page structure problem' },
    { problem: 'too much JavaScript', 'does the edge fix it?': 'no', why: 'the CPU is on the device' },
    { problem: 'hydration cost', 'does the edge fix it?': 'no', why: 'same' },
    { problem: 'a data waterfall in SSR', 'does the edge fix it?': 'no', why: 'it caches the result, not the process' },
    { problem: 'repeat visits to static assets', 'does the edge fix it?': 'YES', why: 'this is what it is for' },
    { problem: 'global latency to cacheable content', 'does the edge fix it?': 'YES', why: '' },
    { problem: 'origin capacity under load', 'does the edge fix it?': 'YES', why: 'with collapsing and a decent hit ratio' },
  ], { columns: ['problem', 'does the edge fix it?', 'why'] });

  out.textContent =
    'A CDN is a purchase order rather than a code change, which is why it is often the first thing\n' +
    'tried and rarely the biggest win. It moves cacheable bytes closer. It does nothing about\n' +
    'device CPU, page structure, JavaScript, or the shape of your data fetching.\n\n' +
    'The order that actually works (from the course README):\n' +
    '  1. do not ship it   2. ship fewer bytes   3. ship it at the right time\n' +
    '  4. do not ship it again   5. ship it from closer\n\n' +
    'Edge COMPUTE is a different question from edge CACHING, and worth separating: running code at\n' +
    'the edge helps when the work is small and the data is nearby (routing, redirects, A/B\n' +
    'assignment, auth checks, personalisation of a cached shell). It hurts when the code needs\n' +
    'your database, which is usually in one region — then you have added a network hop to every\n' +
    'query and made things slower with a very modern architecture diagram.';
});
