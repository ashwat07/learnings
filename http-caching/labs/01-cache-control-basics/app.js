// Lab 01 — Cache-Control basics.
//
// Method: fetch the same URL N times, then ask the server how many of those it saw.
// Every URL gets a unique name per "generation" so a re-run is never polluted by an
// earlier run's cached copy.

import { $, on, Log, renderTable, resourceInfo, fmt, sleep } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

let generation = Math.floor(Math.random() * 1e6);
const showGen = () => { $('gen').textContent = `generation ${generation}`; };
showGen();

// ---------------------------------------------------------------------------
// The presets. `params` is appended to /api/asset.
// ---------------------------------------------------------------------------

const PRESETS = [
  {
    id: 'nothing',
    label: '(no Cache-Control at all)',
    params: '',
    expect: 'heuristic — the cache guesses',
  },
  {
    id: 'lastmod-only',
    label: '(none, but Last-Modified present)',
    params: '&lm=1',
    expect: 'heuristic freshness ≈ 10% of age since Last-Modified',
  },
  {
    id: 'nostore',
    label: 'no-store',
    params: '&cc=no-store',
    expect: 'never stored — 3 server hits',
  },
  {
    id: 'nocache',
    label: 'no-cache',
    params: '&cc=no-cache&etag=1',
    expect: 'stored, but revalidated every time — 3 hits, 2 of them 304s',
  },
  {
    id: 'maxage',
    label: 'max-age=60',
    params: '&cc=max-age%3D60',
    expect: 'fresh for 60s — 1 server hit',
  },
  {
    id: 'maxage-zero',
    label: 'max-age=0',
    params: '&cc=max-age%3D0&etag=1',
    expect: 'immediately stale → revalidate every time',
  },
  {
    id: 'maxage-mustrevalidate',
    label: 'max-age=60, must-revalidate',
    params: '&cc=max-age%3D60,must-revalidate&etag=1',
    expect: 'same as max-age until stale; then no serving stale, ever',
  },
  {
    id: 'private',
    label: 'private, max-age=60',
    params: '&cc=private,max-age%3D60',
    expect: 'browser caches it; a CDN must not',
  },
  {
    id: 'public',
    label: 'public, max-age=60',
    params: '&cc=public,max-age%3D60',
    expect: 'anyone may cache it, including intermediaries',
  },
  {
    id: 'age',
    label: 'max-age=60 with Age: 55',
    params: '&cc=max-age%3D60&age=55&etag=1',
    expect: 'only 5s of freshness left — Age counts against max-age',
  },
  {
    id: 'expired-age',
    label: 'max-age=60 with Age: 120',
    params: '&cc=max-age%3D60&age=120&etag=1',
    expect: 'born stale — arrives already expired',
  },
];

// ---------------------------------------------------------------------------

function urlFor(preset) {
  return `/api/asset?name=${preset.id}-${generation}&type=json${preset.params}`;
}

async function serverHits(name) {
  const res = await fetch('/api/stats', { cache: 'no-store' });
  const stats = await res.json();
  return stats.hits[`asset:${name}`] || 0;
}

async function runPreset(preset) {
  const repeats = Number($('repeats').value);
  const name = `${preset.id}-${generation}`;
  const url = urlFor(preset);

  const before = await serverHits(name);
  const sources = [];
  const times = [];

  for (let i = 0; i < repeats; i++) {
    const t0 = performance.now();
    const res = await fetch(url);
    await res.text();
    times.push(performance.now() - t0);
    // Give the resource timing entry a moment to be recorded.
    await sleep(0);
    const info = resourceInfo(url);
    sources.push(info ? info.source : '?');
  }

  const after = await serverHits(name);
  const hits = after - before;

  log.line(
    `${preset.label.padEnd(34)} ${hits}/${repeats} server hits   ` +
    `sources: ${sources.join(' → ')}`,
    hits === 0 ? 'good' : hits < repeats ? 'micro' : 'bad');

  return {
    'Cache-Control': preset.label,
    'server hits': `${hits} / ${repeats}`,
    '2nd request': sources[1] ?? '–',
    '2nd ms': times[1] != null ? Number(times[1].toFixed(1)) : '–',
    'expected': preset.expect,
    _serverClass: hits <= 1 ? 'ok' : hits < repeats ? 'meh' : 'no',
  };
}

async function runAll() {
  log.clear();
  log.head(`— generation ${generation}, ${$('repeats').value} fetches per preset —`);
  const rows = [];
  for (const preset of PRESETS) {
    rows.push(await runPreset(preset));
    renderTable('#results', rows, {
      columns: ['Cache-Control', 'server hits', '2nd request', '2nd ms', 'expected'],
    });
  }
  out.textContent =
    'Read the "server hits" column first. 1/3 means the cache served two of the three requests\n' +
    'with no network at all. 3/3 with "revalidated (304)" in the source column means the network\n' +
    'happened but the body did not — you paid a round trip to save the bytes.\n\n' +
    'Now explain the two heuristic rows to yourself: why does the one with Last-Modified behave\n' +
    'differently from the one with no headers at all?';
}

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

async function expiryTest() {
  const name = `expiry-${generation}-${Date.now()}`;
  const url = `/api/asset?name=${name}&type=json&cc=max-age%3D5&etag=1`;
  log.head('— max-age=5: fetch, fetch, wait 6s, fetch —');

  for (const label of ['first', 'immediately again']) {
    await fetch(url).then((r) => r.text());
    await sleep(0);
    const info = resourceInfo(url);
    log.line(`${label.padEnd(20)} → ${info.source} (${fmt.ms(info.duration)}, ${fmt.bytes(info.transferSize)} over the wire)`,
      info.source.startsWith('cache') ? 'good' : 'macro');
  }

  for (let s = 6; s > 0; s--) {
    out.textContent = `waiting ${s}s for max-age=5 to expire…`;
    await sleep(1000);
  }

  await fetch(url).then((r) => r.text());
  await sleep(0);
  const info = resourceInfo(url);
  log.line(`after expiry         → ${info.source} (${fmt.ms(info.duration)}, ${fmt.bytes(info.transferSize)} over the wire)`,
    info.source === 'network' ? 'bad' : 'micro');

  const hits = await serverHits(name);
  log.ok(`server saw ${hits} requests total for 3 fetches`);
  out.textContent =
    `Server saw ${hits} of 3 fetches.\n\n` +
    'The third one was stale, so the browser revalidated. Because the content had not changed and\n' +
    'we sent an ETag, that revalidation was a 304: a round trip, but no body. That is the difference\n' +
    'between "expired" and "gone" — a stale cache entry is still an asset, not garbage.';
}

// ---------------------------------------------------------------------------
// fetch() cache modes
//
// RequestCache lets your code override the stored freshness rules. Worth knowing cold,
// because "why is my fetch not caching" is nearly always this.
// ---------------------------------------------------------------------------

const MODES = [
  ['default', 'normal HTTP semantics: fresh → cache, stale → revalidate'],
  ['no-store', 'do not read the cache, do not write the cache'],
  ['reload', 'always hit the network, but DO update the cache with the result'],
  ['no-cache', 'always revalidate, even if fresh (this is what Cmd-R does)'],
  ['force-cache', 'use the cached copy even if stale; only hit the network if absent'],
  ['only-if-cached', 'cached copy or a network error — never the network (same-origin, mode: same-origin)'],
];

async function testModes() {
  log.head('— fetch() cache modes against one max-age=60 URL —');
  const name = `modes-${generation}-${Date.now()}`;
  const url = `/api/asset?name=${name}&type=json&cc=max-age%3D60&etag=1`;

  // Prime the cache.
  await fetch(url).then((r) => r.text());
  const primed = await serverHits(name);
  log.muted(`primed the cache (server hits: ${primed})`);

  const rows = [];
  for (const [mode, note] of MODES) {
    const before = await serverHits(name);
    let result = 'ok';
    try {
      const res = await fetch(url, { cache: mode, mode: 'same-origin' });
      await res.text();
      result = `${res.status}${res.type === 'opaque' ? ' (opaque)' : ''}`;
    } catch (err) {
      result = `threw: ${err.message}`;
    }
    const after = await serverHits(name);
    rows.push({
      mode,
      'hit the server?': after > before ? 'yes' : 'no',
      result,
      meaning: note,
      _hitClass: after > before ? 'meh' : 'ok',
    });
    log.line(`${mode.padEnd(16)} server hit: ${after > before ? 'YES' : 'no '}  → ${result}`,
      after > before ? 'macro' : 'good');
    renderTable('#modeResults', rows, { columns: ['mode', 'hit the server?', 'result', 'meaning'] });
  }

  out.textContent =
    'The two people get wrong:\n' +
    '  reload  — hits the network AND writes the result to the cache (Cmd-Shift-R territory)\n' +
    '  no-cache — does NOT skip the cache; it revalidates it. If the server says 304 you get the\n' +
    '            cached body back, and no bytes were transferred.\n\n' +
    'only-if-cached requires mode: "same-origin" and throws if there is no stored response — it is\n' +
    'the primitive behind a real offline-first fetch wrapper.';
}

// ---------------------------------------------------------------------------

on('all', () => runAll().catch((e) => log.bad(e.message)));
on('expiry', () => expiryTest().catch((e) => log.bad(e.message)));
on('modes', () => testModes().catch((e) => log.bad(e.message)));
on('reset', () => {
  generation = Math.floor(Math.random() * 1e6);
  showGen();
  log.clear();
  $('results').textContent = '';
  $('modeResults').textContent = '';
  out.textContent = 'New generation — every URL is now unique, so nothing is cached yet.';
});
