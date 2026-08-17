// Lab 06 — Design a header policy.
//
// A grader, not a quiz: several rows have more than one defensible answer, and the feedback
// explains the trade rather than just marking it.

import { $, on, renderTable, fmt } from '/shared/lab-ui.js';

// ---------------------------------------------------------------------------
// The policies you can choose from. Each is a real header string.
// ---------------------------------------------------------------------------

const POLICIES = {
  nostore: { header: 'no-store', fresh: 0, revalidates: false, stores: false },
  nocachePrivate: { header: 'private, no-cache', fresh: 0, revalidates: true, stores: true, private: true },
  nocachePublic: { header: 'no-cache', fresh: 0, revalidates: true, stores: true },
  short: { header: 'public, max-age=60', fresh: 60, revalidates: true, stores: true },
  shortPrivate: { header: 'private, max-age=60', fresh: 60, revalidates: true, stores: true, private: true },
  medium: { header: 'public, max-age=3600', fresh: 3600, revalidates: true, stores: true },
  swr: { header: 'public, max-age=60, stale-while-revalidate=86400', fresh: 60, swr: 86400, revalidates: true, stores: true },
  swrPrivate: { header: 'private, max-age=60, stale-while-revalidate=600', fresh: 60, swr: 600, revalidates: true, stores: true, private: true },
  year: { header: 'public, max-age=31536000', fresh: 31536000, revalidates: false, stores: true },
  yearImmutable: { header: 'public, max-age=31536000, immutable', fresh: 31536000, revalidates: false, stores: true, immutable: true },
  mustRevalidate: { header: 'public, max-age=60, must-revalidate', fresh: 60, revalidates: true, stores: true },
};

const VARY = {
  none: '(no Vary)',
  encoding: 'Vary: Accept-Encoding',
  origin: 'Vary: Origin',
  originEncoding: 'Vary: Origin, Accept-Encoding',
  cookie: 'Vary: Cookie',
  ua: 'Vary: User-Agent',
  language: 'Vary: Accept-Language',
};

// ---------------------------------------------------------------------------
// The app being designed. `size` in bytes, `perVisit` = requests per page view,
// `changes` = how often the content actually changes.
// ---------------------------------------------------------------------------

const RESOURCES = [
  {
    id: 'html', name: 'index.html (SPA shell)', size: 4000, perVisit: 1, changes: 'every deploy',
    what: 'References the hashed bundles. This is the pointer that makes everything else work.',
    best: ['nocachePublic', 'nocachePrivate'], ok: ['short'],
    vary: ['encoding'],
    why: 'The entry point carries the URLs of everything else, so it must be revalidated every ' +
      'time — with an ETag that costs ~200 bytes. Cache it long and a deploy cannot reach users. ' +
      '`private` if the HTML is personalised at all (most authenticated apps).',
    trap: 'Long max-age on HTML is the single most expensive caching mistake there is.',
  },
  {
    id: 'hashedJs', name: 'app.a1b2c3.js (fingerprinted)', size: 220000, perVisit: 3, changes: 'never (new URL instead)',
    what: 'Content-addressed bundle. The bytes at this URL can never change.',
    best: ['yearImmutable'], ok: ['year'],
    vary: ['encoding'],
    why: 'The whole point of fingerprinting. A year, immutable, and never think about it again.',
    trap: 'If the filename has no content hash, this policy is a time bomb.',
  },
  {
    id: 'unhashedJs', name: 'analytics.js (no hash, third-party-ish)', size: 30000, perVisit: 1, changes: 'weekly, silently',
    what: 'A stable URL whose contents get replaced in place. You do not control the deploys.',
    best: ['medium', 'swr'], ok: ['short', 'nocachePublic'],
    vary: ['encoding'],
    why: 'No fingerprint means no long cache. An hour with a validator is a reasonable ceiling; ' +
      'stale-while-revalidate is better still, since nobody is harmed by an hour-old analytics ' +
      'script and the user never waits for it.',
    trap: 'A year on an unhashed URL means you can never fix it.',
  },
  {
    id: 'css', name: 'main.9f8e7d.css (fingerprinted)', size: 60000, perVisit: 1, changes: 'never (new URL)',
    what: 'Render-blocking, fingerprinted.',
    best: ['yearImmutable'], ok: ['year'],
    vary: ['encoding'],
    why: 'Same as the JS bundle. Render-blocking makes the cache hit matter more, not less.',
  },
  {
    id: 'font', name: 'inter.woff2 (self-hosted)', size: 90000, perVisit: 1, changes: 'never',
    what: 'A font file. Never changes; if it did you would give it a new name.',
    best: ['yearImmutable'], ok: ['year'],
    vary: ['none', 'encoding'],
    why: 'Fonts are the archetypal immutable asset. Note the CORS wrinkle: fonts are fetched in ' +
      'CORS mode, so if they come from another origin you also need Access-Control-Allow-Origin ' +
      'and (if it is not `*`) Vary: Origin.',
    trap: 'Already-compressed formats (woff2) should not be re-compressed; Vary: Accept-Encoding ' +
      'is harmless but pointless there.',
  },
  {
    id: 'avatar', name: '/avatars/42.jpg (user-uploaded)', size: 25000, perVisit: 8, changes: 'when the user changes it',
    what: 'User content at a stable URL, shown many times per page.',
    best: ['swr', 'medium'], ok: ['short', 'year'],
    vary: ['none'],
    why: 'Nobody is harmed by seeing a slightly old avatar, and it is requested a lot. SWR is ' +
      'ideal. The grown-up version is to put a hash or version in the URL when the user uploads ' +
      'a new one, which turns this into the immutable case.',
    trap: 'Users notice when their OWN avatar does not update — that is the read-your-own-writes ' +
      'case, and it argues for versioned URLs rather than a longer max-age.',
  },
  {
    id: 'productJson', name: 'GET /api/products (public catalogue)', size: 40000, perVisit: 1, changes: 'a few times a day',
    what: 'Public, identical for everyone, changes occasionally.',
    best: ['swr', 'short'], ok: ['medium', 'nocachePublic'],
    vary: ['encoding', 'originEncoding'],
    why: 'Public data with tolerable staleness is exactly what SWR was designed for, and it is ' +
      'also cacheable at the edge (add s-maxage). Include Vary: Origin if the response echoes ' +
      'the request Origin in Access-Control-Allow-Origin.',
  },
  {
    id: 'search', name: 'GET /api/search?q=…', size: 12000, perVisit: 1, changes: 'constantly',
    what: 'High-cardinality query space, results change constantly, users retype the same queries.',
    best: ['short', 'swrPrivate'], ok: ['nocachePrivate', 'swr'],
    vary: ['encoding'],
    why: 'A 30–60 second max-age is enormously effective here because of back-navigation and ' +
      'repeated queries, and nobody can tell that results are a minute old. Careful with `public` ' +
      'if search results are personalised.',
    trap: 'no-store on search is the default people reach for, and it makes the back button slow.',
  },
  {
    id: 'me', name: 'GET /api/me (session + profile)', size: 2000, perVisit: 1, changes: 'when the user edits it',
    what: 'Per-user, security-relevant, small.',
    best: ['nocachePrivate'], ok: ['shortPrivate'],
    vary: ['none', 'cookie'],
    why: '`private` keeps it out of shared caches entirely; `no-cache` + ETag makes revalidation ' +
      'cost ~200 bytes. Small payload means revalidation is nearly free anyway.',
    trap: 'Any `public` policy here is a data leak waiting for a CDN misconfiguration. ' +
      'Vary: Cookie does NOT make it safe — it only changes the key.',
  },
  {
    id: 'cart', name: 'GET /api/cart', size: 3000, perVisit: 2, changes: 'the user just changed it',
    what: 'The user modifies this themselves and expects to see the result immediately.',
    best: ['nocachePrivate'], ok: ['nostore'],
    vary: ['none'],
    why: 'Read-your-own-writes. Any staleness is a bug report. SWR is specifically wrong here — ' +
      'it guarantees exactly the failure the user will notice.',
  },
  {
    id: 'admin', name: 'GET /admin/report.pdf (authenticated download)', size: 900000, perVisit: 0.2, changes: 'per generation',
    what: 'Big, private, expensive to generate.',
    best: ['nocachePrivate'], ok: ['shortPrivate', 'nostore'],
    vary: ['none'],
    why: '`private` plus a validator: the browser can revalidate a 900KB file for 200 bytes, ' +
      'which is a huge win on a repeat view, while shared caches never store it.',
    trap: 'no-store re-downloads 900KB every time. "Sensitive" and "uncacheable" are not the ' +
      'same requirement — `private` is the one that means "not shared".',
  },
  {
    id: 'sw', name: '/sw.js (service worker)', size: 8000, perVisit: 1, changes: 'every deploy',
    what: 'The service worker script itself.',
    best: ['nocachePublic'], ok: ['short'],
    vary: ['none'],
    why: 'Same role as HTML: it is the pointer that controls everything else. Browsers now cap ' +
      'its max-age at 24 hours regardless of what you send, precisely because sites shipped a ' +
      'year-long one and bricked themselves.',
    trap: 'A long-cached service worker can be genuinely unrecoverable for a user — it is the ' +
      'worst version of the stale-HTML bug.',
  },
  {
    id: 'manifest', name: '/manifest.webmanifest', size: 1200, perVisit: 1, changes: 'rarely',
    what: 'PWA manifest.',
    best: ['short', 'medium'], ok: ['nocachePublic', 'swr'],
    vary: ['none'],
    why: 'Small and rarely changing; an hour is plenty. Not worth a year because it is unhashed.',
  },
  {
    id: 'sitemap', name: '/sitemap.xml', size: 200000, perVisit: 0.01, changes: 'daily',
    what: 'Fetched by crawlers, not users.',
    best: ['medium', 'swr'], ok: ['short'],
    vary: ['encoding'],
    why: 'Crawlers respect caching headers and re-fetch often. An hour saves real origin load ' +
      'and nothing is time-critical.',
  },
  {
    id: 'pixel', name: 'POST /api/events (analytics beacon)', size: 300, perVisit: 12, changes: 'n/a',
    what: 'Fire-and-forget writes.',
    best: ['nostore'], ok: ['nocachePrivate'],
    vary: ['none'],
    why: 'POSTs are not cached anyway, so this is about being explicit. no-store also keeps ' +
      'intermediaries from holding request/response pairs containing user behaviour.',
    trap: 'The interesting question here is not caching but whether you should be using ' +
      'sendBeacon — see the event-loop course, Lab 05.',
  },
  {
    id: 'chunk', name: 'route-settings.4c5b6a.js (lazy chunk)', size: 45000, perVisit: 0.4, changes: 'never (new URL)',
    what: 'Code-split chunk, loaded on navigation to a route.',
    best: ['yearImmutable'], ok: ['year'],
    vary: ['encoding'],
    why: 'Immutable like any hashed asset. The real risk with lazy chunks is not caching but ' +
      'deletion: keep old builds on the CDN, or a user with stale HTML gets a 404 mid-navigation.',
  },
];

// ---------------------------------------------------------------------------
// Build the table
// ---------------------------------------------------------------------------

const table = $('#table');

function build() {
  const head = document.createElement('tr');
  head.innerHTML = '<th>resource</th><th>Cache-Control</th><th>Vary</th><th>validator</th><th>feedback</th>';
  table.append(head);

  for (const r of RESOURCES) {
    const tr = document.createElement('tr');
    tr.dataset.id = r.id;

    const name = document.createElement('td');
    name.innerHTML = `<div>${r.name}</div><div class="what">${r.what}<br>` +
      `${fmt.bytes(r.size)} · ${r.perVisit} req/visit · changes: ${r.changes}</div>`;

    const ccCell = document.createElement('td');
    const cc = document.createElement('select');
    cc.innerHTML = '<option value="">— choose —</option>' +
      Object.entries(POLICIES).map(([k, v]) => `<option value="${k}">${v.header}</option>`).join('');
    ccCell.append(cc);

    const varyCell = document.createElement('td');
    const vary = document.createElement('select');
    vary.innerHTML = Object.entries(VARY).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    varyCell.append(vary);

    const valCell = document.createElement('td');
    const val = document.createElement('select');
    val.innerHTML = `<option value="etag">ETag</option>
      <option value="lastmod">Last-Modified</option>
      <option value="both">both</option>
      <option value="none">neither</option>`;
    valCell.append(val);

    const fb = document.createElement('td');
    fb.className = 'fb';

    tr.append(name, ccCell, varyCell, valCell, fb);
    table.append(tr);
    r._els = { cc, vary, val, fb };
  }
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

function gradeOne(r) {
  const cc = r._els.cc.value;
  const vary = r._els.vary.value;
  const val = r._els.val.value;
  const notes = [];
  let level = 'ok';

  if (!cc) return { level: 'meh', notes: ['no policy chosen'] };

  if (r.best.includes(cc)) {
    notes.push('✓ ' + r.why);
  } else if (r.ok.includes(cc)) {
    level = 'meh';
    notes.push('~ defensible, not ideal. ' + r.why);
  } else {
    level = 'no';
    notes.push('✗ ' + r.why);
    if (r.trap) notes.push('trap: ' + r.trap);
  }

  const p = POLICIES[cc];

  // Cross-cutting rules that apply regardless of the resource.
  const isPrivateData = ['me', 'cart', 'admin'].includes(r.id);
  if (isPrivateData && !p.private && p.stores) {
    level = 'no';
    notes.push('✗ this is per-user data stored without `private` — a shared cache may keep it');
  }
  if (p.immutable && !/\.[a-f0-9]{6}/.test(r.name) && !r.best.includes(cc)) {
    level = 'no';
    notes.push('✗ `immutable` on a URL with no content hash: you can never ship a fix to this');
  }
  if (p.stores && p.revalidates && val === 'none') {
    level = level === 'no' ? 'no' : 'meh';
    notes.push('~ revalidation with no validator means every stale hit is a full download');
  }
  if (val === 'lastmod' && !['sitemap', 'font', 'avatar'].includes(r.id)) {
    notes.push('~ Last-Modified alone has 1-second resolution and depends on clocks; prefer ETag');
  }
  if (vary === 'ua') {
    level = 'no';
    notes.push('✗ Vary: User-Agent shatters the cache — effectively a hit rate of zero');
  }
  if (vary === 'cookie' && p.stores && !p.private) {
    level = 'no';
    notes.push('✗ Vary: Cookie does not make a response private; it only changes the key');
  }
  if (r.vary?.includes('encoding') && vary === 'none' && r.size > 10000) {
    level = level === 'no' ? 'no' : 'meh';
    notes.push('~ this response is compressible: without Vary: Accept-Encoding a cache can serve ' +
      'a gzipped body to a client that did not ask for one');
  }
  if (cc === 'swr' && ['cart', 'me'].includes(r.id)) {
    level = 'no';
    notes.push('✗ SWR guarantees that the user who just made a change sees the old value once — ' +
      'exactly the case they will notice');
  }

  return { level, notes };
}

/**
 * Estimate what the policy costs a returning user (one hour after their last visit) and how
 * much staleness it exposes. Crude, deliberately: the point is relative comparison.
 */
function simulate() {
  const GAP = 3600;               // seconds since the previous visit
  const RTT = 60;                 // ms per round trip
  let requests = 0, bytes = 0, blockingMs = 0, staleRisk = 0;

  for (const r of RESOURCES) {
    const cc = r._els.cc.value;
    if (!cc) continue;
    const p = POLICIES[cc];
    const n = r.perVisit;

    if (!p.stores) {
      requests += n; bytes += n * r.size; blockingMs += n * RTT;
    } else if (p.fresh >= GAP) {
      // fully fresh: nothing at all
    } else if (p.swr && p.fresh + p.swr >= GAP) {
      requests += n;               // background revalidation, off the critical path
      bytes += 200 * n;
      staleRisk += 1;
    } else {
      requests += n; bytes += 200 * n; blockingMs += n * RTT;   // 304 revalidation
    }
  }

  renderTable('#sim', [{
    'blocking requests': Math.round(requests),
    'bytes over the wire': fmt.bytes(Math.round(bytes)),
    'added latency (60ms RTT)': `${Math.round(blockingMs)}ms`,
    'resources that may serve stale': staleRisk,
  }], {
    columns: ['blocking requests', 'bytes over the wire', 'added latency (60ms RTT)', 'resources that may serve stale'],
  });
}

function grade() {
  let good = 0, meh = 0, bad = 0;
  for (const r of RESOURCES) {
    const { level, notes } = gradeOne(r);
    r._els.fb.className = `fb ${level}`;
    r._els.fb.textContent = notes.join('\n');
    if (level === 'ok') good++; else if (level === 'meh') meh++; else bad++;
  }
  $('score').textContent = `${good} ideal · ${meh} defensible · ${bad} wrong`;
  simulate();
  $('out').textContent =
    'Now do the harder half: for every row you got right, say out loud what you would have to\n' +
    'change about the APPLICATION to make a better policy possible. (Hash that avatar URL. Split\n' +
    'that personalised page into a public shell plus a private fragment. Fingerprint that\n' +
    'analytics script by proxying it.) Header design is downstream of URL design.';
}

function showBest() {
  for (const r of RESOURCES) {
    r._els.cc.value = r.best[0];
    r._els.vary.value = r.vary?.[0] ?? 'none';
    r._els.val.value = POLICIES[r.best[0]].stores ? 'etag' : 'none';
  }
  grade();
}

build();
on('grade', grade);
on('best', showBest);
on('clear', () => {
  for (const r of RESOURCES) {
    r._els.cc.value = '';
    r._els.vary.value = 'none';
    r._els.val.value = 'etag';
    r._els.fb.textContent = '';
  }
  $('score').textContent = 'not graded yet';
  $('sim').textContent = '';
});
