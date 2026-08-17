// Lab 04 — SSG & ISR.

import { $, on, Log, renderTable, renderBars, fmt, sleep } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const revalidate = () => Number($('revalidate').value);

/** Fetch a page and report what the cache did, plus the content version it contains. */
async function hit(mode) {
  const url = `/render/${mode}/product/3?revalidate=${revalidate()}`;
  const t0 = performance.now();
  const res = await fetch(url, { cache: 'no-store' });
  const html = await res.text();
  const ms = performance.now() - t0;
  const version = Number(html.match(/<small>v(\d+)<\/small>/)?.[1] ?? 0);
  return {
    ms,
    version,
    cache: res.headers.get('x-cache') ?? '–',
    age: Number(res.headers.get('x-age') ?? 0),
    serverRender: Number(res.headers.get('x-render-ms') ?? 0),
  };
}

on('poll', async () => {
  log.clear();
  $('#bars').textContent = '';
  const samples = [];
  const rows = [];
  log.head(`— polling /render/isr/product/3?revalidate=${revalidate()} every second for 20s —`);
  log.muted('click "change the content" partway through');

  for (let i = 0; i < 20; i++) {
    const r = await hit('isr');
    samples.push({
      label: `t+${i}s`,
      value: r.ms,
      cls: r.cache === 'HIT' ? 'good' : r.cache === 'STALE' ? 'wait' : 'bad',
      text: `${Math.round(r.ms)}ms ${r.cache} v${r.version}`,
    });
    renderBars('#bars', samples, { max: 1200 });
    rows.push({ 't+s': i, 'ms': Math.round(r.ms), cache: r.cache, 'age s': r.age, 'content version': r.version });
    renderTable('#results', rows, { columns: ['t+s', 'ms', 'cache', 'age s', 'content version'] });
    log.line(`t+${String(i).padStart(2)}s  ${String(Math.round(r.ms)).padStart(5)}ms  ${r.cache.padEnd(6)}  ` +
      `age ${r.age}s  content v${r.version}`,
      r.cache === 'HIT' ? 'good' : r.cache === 'STALE' ? 'macro' : 'bad');
    await sleep(1000);
  }

  const firstNewVersion = rows.findIndex((r) => r['content version'] > rows[0]['content version']);
  out.textContent =
    'Three states, and each one is a different deal:\n\n' +
    '  MISS  — nothing cached. Someone waits the full render time. On a real ISR page this is the\n' +
    '          first visitor after a deploy, or the first visitor to a page nobody has requested.\n' +
    '  HIT   — inside the revalidate window. Served from memory, ~0ms, and possibly stale.\n' +
    '  STALE — past the window. Served from memory ANYWAY (~0ms), with a refresh kicked off in\n' +
    '          the background. The next request gets the new copy.\n\n' +
    (firstNewVersion > 0
      ? `You bumped the content and the new version first appeared ${firstNewVersion} poll(s) later.\n` +
        'That gap is your staleness window, and it is the number to put in a design document.\n\n'
      : '') +
    'Notice what nobody waited for: the regeneration. That is the difference between ISR and a\n' +
    'plain cache with an expiry — an expiring cache makes the unlucky request pay the full render;\n' +
    'stale-while-revalidate makes nobody pay it.';
});

on('bump', async () => {
  const r = await (await fetch('/api/render?bumpVersion=1')).json();
  log.bad(`server content is now v${r.version} — cached HTML still says the old version`);
});

on('invalidate', async () => {
  const r = await (await fetch('/api/render?invalidate=1')).json();
  log.ok(`invalidated ${r.invalidated} cached render(s) — the next request is a MISS and pays for it`);
  out.textContent =
    'On-demand invalidation is what you want when content changes for a reason you KNOW about: an\n' +
    'editor published, a price changed, a webhook fired. It converts "stale for up to N seconds"\n' +
    'into "stale until the webhook lands", which is usually a much better product.\n\n' +
    'The trade you just made explicit: the next request is a MISS and pays the full render. On a\n' +
    'popular page that is a small thundering herd — every request arriving during the regeneration\n' +
    'either waits or gets served stale, depending on your implementation. Next.js\n' +
    'revalidatePath/revalidateTag and a CDN purge both have this property.\n\n' +
    'The grown-up version: invalidate by TAG, not by path (one product change should not invalidate\n' +
    'the whole catalogue), and regenerate in the background rather than on the next request.';
});

on('cost', async () => {
  log.head('— who pays for the regeneration? —');
  await fetch('/api/render?invalidate=1');

  // A cold MISS: someone waits.
  const cold = await hit('isr');
  log.line(`cold MISS: ${Math.round(cold.ms)}ms — this visitor waited for the full render`, 'bad');

  // A warm HIT.
  const warm = await hit('isr');
  log.line(`warm HIT: ${Math.round(warm.ms)}ms`, 'good');

  // Wait for staleness, then fire ten concurrent requests at the stale entry.
  log.muted(`waiting ${revalidate() + 1}s for the entry to go stale…`);
  await sleep((revalidate() + 1) * 1000);

  const t0 = performance.now();
  const burst = await Promise.all(Array.from({ length: 10 }, () => hit('isr')));
  const burstMs = performance.now() - t0;

  const slow = burst.filter((b) => b.ms > 200).length;
  log.line(`10 concurrent requests at a stale entry: ${slow} of 10 were slow, total ${Math.round(burstMs)}ms`,
    slow === 0 ? 'good' : 'bad');

  renderTable('#results', [
    { request: 'cold MISS', ms: Math.round(cold.ms), 'who waits': 'the first visitor' },
    { request: 'warm HIT', ms: Math.round(warm.ms), 'who waits': 'nobody' },
    { request: '10 concurrent, stale', ms: Math.round(burstMs / 10) + ' avg', 'who waits': slow ? `${slow} visitors` : 'nobody' },
  ], { columns: ['request', 'ms', 'who waits'] });

  out.textContent =
    'This is the question to ask about any ISR/SWR implementation: on a stale entry with 10\n' +
    'concurrent requests, how many people wait?\n\n' +
    '  A correct implementation: zero. All 10 get the stale copy; ONE background refresh runs.\n' +
    '  A naive implementation: 10 people wait, and your origin gets 10 identical renders.\n\n' +
    'That second case is a cache stampede, and it is how a caching layer turns a traffic spike\n' +
    'into an outage. The fix is exactly the coalescing map from the caching and service-worker\n' +
    'courses: one in-flight refresh per key, tracked, and everyone else served the stale copy.\n\n' +
    'Read cachedRender() in shared/app/render.mjs — the `refreshing` flag is the entire defence,\n' +
    'and it is four lines.';
});

on('scale', () => {
  const rows = [];
  for (const pages of [100, 1_000, 10_000, 100_000, 1_000_000]) {
    const perPage = 0.9;                       // seconds, this sandbox's parallel render
    const buildSec = pages * perPage;
    const withConcurrency = buildSec / 8;      // 8 workers
    rows.push({
      pages,
      'build (8 workers)': withConcurrency > 3600
        ? `${(withConcurrency / 3600).toFixed(1)} h`
        : `${(withConcurrency / 60).toFixed(1)} min`,
      'verdict': pages <= 1000 ? 'SSG is fine'
        : pages <= 10000 ? 'SSG with care (incremental builds)'
          : 'ISR or on-demand — do not build these',
    });
  }
  renderTable('#results', rows.map((r) => ({
    pages: r.pages,
    'build (8 workers)': r['build (8 workers)'],
    verdict: r.verdict,
  })), { columns: ['pages', 'build (8 workers)', 'verdict'] });

  out.textContent =
    'The other half of the SSG decision, and the half that decides it in practice: build time\n' +
    'scales with page count.\n\n' +
    'At ~0.9s of data-fetching per page and 8 concurrent workers, a million product pages is\n' +
    'about 31 hours. Long before that you have lost the ability to deploy casually — and a deploy\n' +
    'you cannot do casually is a deploy that does not happen, which is a bigger problem than\n' +
    'any rendering metric.\n\n' +
    'The practical ladder:\n' +
    '  hundreds of pages   → SSG, rebuild on every deploy\n' +
    '  thousands           → SSG plus incremental builds (only what changed) and cached data\n' +
    '  tens of thousands+  → ISR / on-demand: generate the first time someone asks, then cache\n' +
    '  per-user pages      → not static at all; SSR or streaming\n\n' +
    'And note ISR gets you something SSG cannot: pages that were never built. A product added\n' +
    'five minutes ago is renderable without a deploy.';
});

on('clear', () => { log.clear(); $('#bars').textContent = ''; $('#results').textContent = ''; });

// Keep the window arithmetic on screen.
function showWindow() {
  const r = revalidate();
  $('#window').textContent =
    `revalidate = ${r}s\n\n` +
    `worst case a user sees stale content:  ${r}s + one request\n` +
    `  (the entry goes stale at ${r}s; the next request is served stale and triggers the refresh;\n` +
    `   the request AFTER that gets the new copy)\n\n` +
    `so: "our prices can be up to ${r} seconds out of date, plus one request" — say that out loud\n` +
    `to whoever owns the data before you pick the number.`;
}
on($('revalidate'), 'input', showWindow);
showWindow();
