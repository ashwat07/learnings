// Lab 06 — Choose per route.

import { $, on, renderTable } from '/shared/lab-ui.js';

const STRATEGIES = {
  ssg: 'SSG — built once, served static',
  isr: 'ISR — static + background revalidation',
  ssr: 'SSR — rendered per request',
  stream: 'streaming SSR — shell first, slow parts later',
  csr: 'CSR — a shell + client-side render',
  rsc: 'RSC + streaming — server components, client islands',
  static: 'fully static, no data at all',
};

/**
 * Each route carries the facts that decide the answer. The grader checks the DECISION against
 * those facts, which is why several routes accept more than one strategy.
 */
const ROUTES = [
  {
    id: 'marketing', name: '/ (marketing home)',
    facts: 'identical for everyone · changes when marketing deploys · SEO critical · highest traffic',
    best: ['ssg', 'static'], ok: ['isr'],
    why: 'Nothing per-user, nothing fresher than a deploy. SSG is strictly better than everything ' +
      'else here: no server work, cacheable at the edge, and the fastest possible LCP.',
    trap: 'SSR on a page that never changes is pure cost — you pay a render per request for output ' +
      'that is byte-identical.',
  },
  {
    id: 'docs', name: '/docs/* (10k pages, markdown)',
    facts: 'identical for everyone · changes on merge · SEO critical · long tail of traffic',
    best: ['ssg'], ok: ['isr'],
    why: 'The archetypal SSG case. 10k pages is a long but survivable build, and incremental ' +
      'builds make it routine. Content is the product, so HTML must be complete.',
    trap: 'If the build crosses ~20 minutes, move to ISR before the build time starts shaping how ' +
      'often you deploy.',
  },
  {
    id: 'catalogue', name: '/products (listing, 200k SKUs)',
    facts: 'same for everyone · prices change hourly · SEO critical · 200k pages',
    best: ['isr'], ok: ['stream', 'rsc'],
    why: '200k pages is not a build. ISR renders on first request and keeps it cached, with a ' +
      'revalidate window sized to how stale a price may be. Pages added today work with no deploy.',
    trap: 'SSG here is a multi-hour build and a deploy you will stop doing.',
  },
  {
    id: 'product', name: '/products/:id (detail)',
    facts: 'same for everyone except stock · price + stock change · SEO critical · slow reviews query',
    best: ['isr', 'stream'], ok: ['rsc', 'ssr'],
    why: 'Two good answers with different shapes. ISR for the cacheable body plus a client or ' +
      'streamed island for live stock. Or streaming SSR: the product in the shell, reviews and ' +
      'recommendations behind boundaries.',
    trap: 'Do not let the 900ms reviews query decide the TTFB of the whole page — that is the ' +
      'mistake this course exists to prevent.',
  },
  {
    id: 'search', name: '/search?q=… (results)',
    facts: 'unbounded query space · results change constantly · SEO not wanted (noindex) · fast queries',
    best: ['ssr', 'csr'], ok: ['stream', 'rsc'],
    why: 'Unbounded keys means nothing to pre-render. SSR for a shareable first result; CSR is ' +
      'defensible when search lives inside an already-loaded app and the first paint came from the ' +
      'shell.',
    trap: 'ISR/SSG on an unbounded query space fills a cache with entries used once.',
  },
  {
    id: 'dashboard', name: '/app/dashboard (logged in)',
    facts: 'entirely per-user · must be fresh · behind auth, no SEO · heavy interactivity',
    best: ['csr', 'rsc'], ok: ['stream', 'ssr'],
    why: 'No SEO requirement and no cacheable output, so SSR buys little — its main gain would be ' +
      'a faster first paint, which a shell plus a good skeleton also gives. If the data layer is ' +
      'heavy, RSC keeps it off the client.',
    trap: 'SSR-ing a per-user dashboard means every request costs a full render and can be cached ' +
      'by nothing. Make sure it is `private` if you do (see the caching course).',
  },
  {
    id: 'settings', name: '/app/settings',
    facts: 'per-user · rarely visited · behind auth · form-heavy',
    best: ['csr'], ok: ['ssr', 'rsc'],
    why: 'Low traffic, no SEO, inside an app the user has already loaded. Rendering it on the ' +
      'server optimises a page nobody measures.',
  },
  {
    id: 'checkout', name: '/checkout',
    facts: 'per-user · correctness critical · no SEO · money',
    best: ['ssr', 'rsc'], ok: ['csr'],
    why: 'Freshness and correctness dominate: prices, stock and totals must be right at render ' +
      'time. Server rendering puts the authoritative numbers in the HTML instead of trusting a ' +
      'client that may be running a stale bundle.',
    trap: 'Never cache this. `private, no-store` on the response, and no ISR — a cached checkout is ' +
      'a security incident, not a performance win.',
  },
  {
    id: 'blogpost', name: '/blog/:slug',
    facts: 'identical for everyone · edited occasionally · SEO critical · comments are slow',
    best: ['ssg', 'isr'], ok: ['stream'],
    why: 'Static body, and comments behind a streaming boundary or loaded client-side. An editor ' +
      'publishing should trigger on-demand invalidation rather than waiting out a revalidate window.',
    trap: 'Letting the comments query block the article is the classic version of this mistake.',
  },
  {
    id: 'pricing', name: '/pricing (A/B tested)',
    facts: 'two variants · SEO critical · marketing changes it weekly · variant chosen per user',
    best: ['isr', 'ssg'], ok: ['stream', 'ssr'],
    why: 'Cache each VARIANT statically and choose at the edge (or stream the variant-specific part ' +
      'into a static shell). Two cache entries, not one per user.',
    trap: 'SSR per request "because it is personalised" throws away caching for a two-value ' +
      'decision. And if you cache without `Vary`/a cache key on the variant, you serve the wrong ' +
      'one — see the caching course, lab 05.',
  },
  {
    id: 'status', name: '/status (live incident page)',
    facts: 'same for everyone · must be seconds-fresh · huge traffic spikes exactly when it matters',
    best: ['isr'], ok: ['ssr', 'stream'],
    why: 'The page everyone loads when your infrastructure is on fire. It must survive a traffic ' +
      'spike with your origin degraded, so it has to be cacheable — ISR with a 5–10s window, ' +
      'served from the edge, with stale-if-error.',
    trap: 'SSR on the status page means your status page goes down with your app. This is a real ' +
      'and recurring outage pattern.',
  },
  {
    id: 'admin', name: '/admin/reports (internal)',
    facts: '12 internal users · heavy queries · no SEO · used daily',
    best: ['csr'], ok: ['ssr', 'rsc'],
    why: 'Twelve users. Optimise for build simplicity and developer time, not delivery. A CSR app ' +
      'with a loading state is completely fine and cheaper to maintain.',
    trap: 'Rendering-strategy work here is effort spent where nobody can perceive it.',
  },
  {
    id: 'embed', name: '/embed/widget (third-party iframe)',
    facts: 'embedded on customer sites · must be tiny and fast · no SEO · slightly personalised',
    best: ['ssg', 'isr'], ok: ['stream'],
    why: 'You are a guest on someone else\'s page, so your JS competes with theirs. Static HTML plus ' +
      'the minimum island is the polite and fast option.',
    trap: 'Shipping a framework runtime into a customer\'s page to render six elements is how embeds ' +
      'get removed.',
  },
  {
    id: 'feed', name: '/feed (personalised, infinite scroll)',
    facts: 'per-user · fresh · no SEO for the feed itself · heavy interactivity',
    best: ['stream', 'rsc'], ok: ['csr', 'ssr'],
    why: 'Stream (or server-render) the first screen so there is something immediately, and load ' +
      'the rest client-side. The first screen is the only part where rendering strategy is ' +
      'perceptible.',
    trap: 'CSR for the whole thing means a spinner on every cold load; SSR for the whole thing ' +
      'means rendering pages of content nobody scrolls to.',
  },
];

// Rough per-visit cost model, so a bad set of choices has a visible price.
const COST = {
  ssg: { serverMs: 0, cacheable: true, clientJsKb: 20, ttfb: 30 },
  static: { serverMs: 0, cacheable: true, clientJsKb: 0, ttfb: 25 },
  isr: { serverMs: 5, cacheable: true, clientJsKb: 25, ttfb: 40 },
  ssr: { serverMs: 900, cacheable: false, clientJsKb: 25, ttfb: 950 },
  stream: { serverMs: 900, cacheable: false, clientJsKb: 30, ttfb: 60 },
  csr: { serverMs: 0, cacheable: true, clientJsKb: 190, ttfb: 30 },
  rsc: { serverMs: 700, cacheable: false, clientJsKb: 90, ttfb: 750 },
};

const table = $('#table');

function build() {
  const head = document.createElement('tr');
  head.innerHTML = '<th>route</th><th>strategy</th><th>feedback</th>';
  table.append(head);

  for (const r of ROUTES) {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.innerHTML = `<div>${r.name}</div><div class="what">${r.facts}</div>`;

    const pick = document.createElement('td');
    const select = document.createElement('select');
    select.innerHTML = '<option value="">— choose —</option>' +
      Object.entries(STRATEGIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    pick.append(select);

    const fb = document.createElement('td');
    fb.className = 'fb';

    tr.append(name, pick, fb);
    table.append(tr);
    r._els = { select, fb };
  }
}

function grade() {
  let good = 0, meh = 0, bad = 0;
  for (const r of ROUTES) {
    const pick = r._els.select.value;
    const notes = [];
    let level = 'ok';

    if (!pick) { r._els.fb.className = 'fb meh'; r._els.fb.textContent = 'no choice made'; meh++; continue; }

    if (r.best.includes(pick)) notes.push('✓ ' + r.why);
    else if (r.ok?.includes(pick)) { level = 'meh'; notes.push('~ defensible, not ideal. ' + r.why); }
    else { level = 'no'; notes.push('✗ ' + r.why); if (r.trap) notes.push('trap: ' + r.trap); }

    // Cross-cutting rules that hold regardless of the route.
    const facts = r.facts;
    if (facts.includes('SEO critical') && pick === 'csr') {
      level = 'no';
      notes.push('✗ SEO-critical and client-rendered: the crawler may index an empty shell, and ' +
        'even when it renders JS you are competing for its render budget. See the SEO course.');
    }
    if (facts.includes('per-user') && ['ssg', 'isr', 'static'].includes(pick)) {
      level = 'no';
      notes.push('✗ per-user content cannot be statically cached — you will serve one user\'s page ' +
        'to another. If parts are shared, split the page rather than the strategy.');
    }
    if (facts.includes('money') && ['ssg', 'isr'].includes(pick)) {
      level = 'no';
      notes.push('✗ caching a checkout is a security incident, not an optimisation.');
    }
    if (facts.includes('traffic spikes') && !COST[pick].cacheable) {
      level = 'no';
      notes.push('✗ this page is loaded when your infrastructure is struggling. If it is not ' +
        'cacheable it goes down with everything else.');
    }
    if (facts.includes('unbounded query space') && ['ssg', 'isr'].includes(pick)) {
      level = 'no';
      notes.push('✗ unbounded keys means a cache full of entries used exactly once.');
    }
    if (facts.includes('12 internal users') && pick !== 'csr') {
      level = level === 'no' ? 'no' : 'meh';
      notes.push('~ twelve users. Whatever you gain here, nobody can perceive it; prefer the ' +
        'cheapest thing to maintain.');
    }

    r._els.fb.className = `fb ${level}`;
    r._els.fb.textContent = notes.join('\n');
    if (level === 'ok') good++; else if (level === 'meh') meh++; else bad++;
  }

  $('score').textContent = `${good} ideal · ${meh} defensible · ${bad} wrong`;
  simulate();
  $('out').textContent =
    'Now the part that separates a decision from a preference: for every route, name the ONE FACT\n' +
    'that decided it. If you cannot, you guessed.\n\n' +
    'The facts that actually decide, in rough order of force:\n' +
    '  1. is it per-user?            → rules out static caching (or forces a page split)\n' +
    '  2. does SEO matter?           → rules out client-only rendering\n' +
    '  3. how fresh must it be?      → sets the revalidate window, or rules out caching\n' +
    '  4. how many pages are there?  → rules out build-time generation\n' +
    '  5. is one query much slower?  → argues for streaming boundaries\n' +
    '  6. what is the traffic?       → decides whether any of this is worth your time\n\n' +
    'Everything else — framework, fashion, what the last team used — is downstream of those six.';
}

function simulate() {
  const rows = [];
  let serverMs = 0, clientKb = 0, uncacheable = 0;
  for (const r of ROUTES) {
    const pick = r._els.select.value;
    if (!pick) continue;
    const c = COST[pick];
    serverMs += c.serverMs;
    clientKb += c.clientJsKb;
    if (!c.cacheable) uncacheable++;
  }
  const n = ROUTES.filter((r) => r._els.select.value).length || 1;
  rows.push({
    'routes chosen': n,
    'avg server work per visit': `${Math.round(serverMs / n)}ms`,
    'avg client JS per route': `${Math.round(clientKb / n)}KB`,
    'uncacheable routes': `${uncacheable} of ${n}`,
  });
  renderTable('#sim', rows, {
    columns: ['routes chosen', 'avg server work per visit', 'avg client JS per route', 'uncacheable routes'],
  });
}

function showBest() {
  for (const r of ROUTES) r._els.select.value = r.best[0];
  grade();
}

build();
on('grade', grade);
on('best', showBest);
on('clear', () => {
  for (const r of ROUTES) { r._els.select.value = ''; r._els.fb.textContent = ''; }
  $('score').textContent = 'not graded yet';
  $('#sim').textContent = '';
  $('out').textContent = '';
});
