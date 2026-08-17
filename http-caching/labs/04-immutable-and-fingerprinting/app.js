// Lab 04 — Immutable & fingerprinting.

import { $, on, Log, renderTable, resourceInfo, fmt, sleep } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

// A small app's asset manifest. Only `app` changes on a typical deploy.
const ASSETS = [
  { file: 'vendor', size: 300000 },
  { file: 'app', size: 80000 },
  { file: 'styles', size: 40000 },
  { file: 'icons', size: 120000 },
];

const YEAR = 'max-age%3D31536000';

let run = Math.floor(Math.random() * 1e6);
let deployNo = 1;

/**
 * The four strategies. Each maps (asset, deployNo) -> a URL.
 *
 * The only thing that differs is whether the URL changes when the CONTENT changes.
 */
const STRATEGIES = {
  unversioned: {
    label: 'A. stable URL + max-age=1y',
    url: (a) => `/api/asset?name=${run}-A-${a.file}&type=txt&size=${a.size}&cc=${YEAR}`,
    // Content changes are pushed to the same URL, so the server bumps the asset version.
    changed: (a) => a.file === 'app',
    bumpsServer: true,
  },
  queryVersion: {
    label: 'B. ?v=N query + max-age=1y',
    url: (a, d) => `/api/asset?name=${run}-B-${a.file}&type=txt&size=${a.size}&cc=${YEAR}&v=${a.file === 'app' ? d : 1}`,
    changed: (a) => a.file === 'app',
  },
  hashed: {
    label: 'C. hashed name + immutable',
    url: (a, d) => `/api/asset?name=${run}-C-${a.file}-${a.file === 'app' ? `h${d}` : 'h1'}&type=txt&size=${a.size}&cc=${YEAR},immutable`,
    changed: (a) => a.file === 'app',
  },
  allHashed: {
    label: 'D. hashed, but every hash changes',
    url: (a, d) => `/api/asset?name=${run}-D-${a.file}-h${d}&type=txt&size=${a.size}&cc=${YEAR},immutable`,
    changed: () => true,
  },
};

/** Load every asset for a strategy and report what came over the wire. */
async function loadAll(key, deploy) {
  const s = STRATEGIES[key];
  let wire = 0;
  let stale = 0;
  let fresh = 0;

  for (const a of ASSETS) {
    const url = s.url(a, deploy);
    const res = await fetch(url);
    const body = await res.text();
    await sleep(0);
    const info = resourceInfo(url) || { transferSize: 0 };
    wire += info.transferSize;

    // "Stale" means: this asset's content changed on the server, the URL did not, and the
    // browser answered from cache — so the user is running old code and cannot know it.
    const servedFromCache = info.transferSize === 0 && body.length > 0;
    if (s.bumpsServer && s.changed(a) && deploy > 1 && servedFromCache) stale++;
    else if (servedFromCache) fresh++;
  }
  return { wire, stale, cached: fresh };
}

const table = [];

async function firstVisit() {
  log.head(`— first visit (cold cache), run ${run} —`);
  table.length = 0;
  for (const key of Object.keys(STRATEGIES)) {
    const r = await loadAll(key, 1);
    table.push({
      strategy: STRATEGIES[key].label,
      'first visit': fmt.bytes(r.wire),
      'after deploy': '–',
      'stale assets': '–',
      verdict: '–',
    });
  }
  renderTable('#results', table, {
    columns: ['strategy', 'first visit', 'after deploy', 'stale assets', 'verdict'],
  });
  $('state').textContent = `deploy ${deployNo} live, cache warm`;
  out.textContent = 'Cold cache: every strategy downloads 540KB. Nothing is interesting yet.\n' +
    'Now click "deploy" — that changes only the 80KB app bundle — and then "returning visit".';
}

async function deploy() {
  deployNo++;
  // Strategy A pushes new content to the same URL, so the *server* content must change.
  for (const a of ASSETS) {
    if (STRATEGIES.unversioned.changed(a)) {
      await fetch(`/api/bump?name=${run}-A-${a.file}`, { cache: 'no-store' });
    }
  }
  log.bad(`deployed v${deployNo}: only "app" (80KB) changed`);
  $('state').textContent = `deploy ${deployNo} live`;
  out.textContent = 'Deployed. Now click "returning visit" — this is a user who has the previous ' +
    'version fully cached.';
}

async function returningVisit() {
  log.head(`— returning visit after deploy ${deployNo} —`);
  const rows = [];
  for (const [i, key] of Object.keys(STRATEGIES).entries()) {
    const r = await loadAll(key, deployNo);
    const verdict = r.stale > 0
      ? `BROKEN — ${r.stale} stale asset(s), user runs old code`
      : r.wire > 200000 ? 'wasteful — re-downloaded unchanged files'
        : r.wire === 0 ? 'nothing downloaded (nothing changed?)'
          : 'correct — only the changed file';
    table[i] = {
      strategy: STRATEGIES[key].label,
      'first visit': table[i]?.['first visit'] ?? '–',
      'after deploy': fmt.bytes(r.wire),
      'stale assets': r.stale,
      verdict,
      _verdictClass: verdict.startsWith('correct') ? 'ok' : verdict.startsWith('BROKEN') ? 'no' : 'meh',
    };
    log.line(`${STRATEGIES[key].label.padEnd(34)} ${fmt.bytes(r.wire).padStart(10)} over the wire, ` +
      `${r.stale} stale`, verdict.startsWith('correct') ? 'good' : 'bad');
    rows.push(table[i]);
  }
  renderTable('#results', table, {
    columns: ['strategy', 'first visit', 'after deploy', 'stale assets', 'verdict'],
  });

  out.textContent =
    'A — the URL did not change, so the browser had no reason to ask. The user is running last\n' +
    '    week\'s JavaScript and there is nothing you can deploy to fix it. This is the one that\n' +
    '    ends up as an incident.\n' +
    'B — the query string changed, so it is a new cache key. Correct, and 80KB. The caveat is\n' +
    '    that some CDNs and older proxies ignore or strip query strings when building cache keys;\n' +
    '    a path-based hash has no such ambiguity.\n' +
    'C — the same, in the path, plus `immutable` so browsers skip even the reload revalidation.\n' +
    '    This is the answer.\n' +
    'D — technically correct and 540KB per deploy: every file got a new hash because the build\n' +
    '    embeds the manifest into every chunk. Your users pay for your bundler config.';
}

on('visit', () => firstVisit().catch((e) => log.bad(e.message)));
on('deploy', () => deploy().catch((e) => log.bad(e.message)));
on('revisit', () => returningVisit().catch((e) => log.bad(e.message)));
on('reset', () => {
  run = Math.floor(Math.random() * 1e6);
  deployNo = 1;
  table.length = 0;
  $('results').textContent = '';
  log.clear();
  $('state').textContent = 'fresh run — nothing cached';
});

// ---------------------------------------------------------------------------
// Reload behaviour
// ---------------------------------------------------------------------------

const RELOAD_ASSETS = ['reload-classic', 'reload-immutable', 'reload-nocache'];

async function checkReload() {
  const stats = await (await fetch('/api/stats', { cache: 'no-store' })).json();
  const rows = RELOAD_ASSETS.map((name) => {
    const info = resourceInfo(`name=${name}`);
    return {
      asset: name,
      'Cache-Control': {
        'reload-classic': 'max-age=3600',
        'reload-immutable': 'max-age=3600, immutable',
        'reload-nocache': 'no-cache',
      }[name],
      'server hits total': stats.hits[`asset:${name}`] || 0,
      'this page load': info ? info.source : 'not seen',
    };
  });
  renderTable('#reloadResults', rows, {
    columns: ['asset', 'Cache-Control', 'server hits total', 'this page load'],
  });
  log.muted(`reload counters: ${rows.map((r) => `${r.asset}=${r['server hits total']}`).join(' ')}`);
}

on('checkReload', () => checkReload().catch((e) => log.bad(e.message)));
on('clearReload', async () => {
  await fetch('/api/reset', { cache: 'no-store' });
  log.muted('server counters reset — now reload the page and check again');
  checkReload();
});

checkReload();
