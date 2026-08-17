// Lab 03 — Degradation: which parts of the page survive which failure.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const WIDGETS = {
  product: { tier: 'critical', url: '/api/data/product/3?x=1' },
  reviews: { tier: 'important', url: '/api/data/reviews/3?x=1' },
  recs: { tier: 'nice to have', url: '/api/data/recommends/3?x=1' },
  social: { tier: 'decorative', url: '/api/data/products?x=1' },
};

function set(name, state, html) {
  const el = $(`#w-${name}`);
  el.className = `widget ${state}`;
  el.querySelector('.body').innerHTML = html;
}

async function load(name, { fail = false, delay = 0 } = {}) {
  const w = WIDGETS[name];
  set(name, 'loading', '<span class="hint">loading…</span>');
  const url = fail ? '/api/asset?name=down&status=503' : `${w.url}${delay ? `&delay=${delay}` : ''}`;
  // A timeout per widget: without one, "slow" and "broken" are the same thing to the user, and
  // the slow case is the one that holds the whole page hostage.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 1500);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    set(name, 'ok', `<span class="hint">loaded</span><br><code>${JSON.stringify(data).slice(0, 90)}…</code>`);
    log.ok(`${name}: ok`);
  } catch (e) {
    const fallback = FALLBACKS[name];
    set(name, fallback ? 'degraded' : 'failed', fallback ?? '<span class="hint">unavailable</span>');
    log.bad(`${name}: ${e.name === 'AbortError' ? 'timed out' : e.message} → ${fallback ? 'degraded' : 'hidden'}`);
  } finally {
    clearTimeout(timer);
  }
}

// A fallback is not an error message. It is the smallest useful thing you can still show.
const FALLBACKS = {
  product: '<b>Something went wrong loading this product.</b><br>' +
    '<button onclick="location.reload()">Retry</button> — this one is critical, so we say so.',
  reviews: '<span class="hint">Reviews are unavailable right now.</span> ' +
    'The rest of the page still works, and you can still buy the thing.',
  recs: null,        // nice-to-have: hide it entirely, silently
  social: null,      // decorative: hide it entirely, silently
};

on('all-ok', async () => {
  log.head('— all four widgets —');
  await Promise.allSettled(Object.keys(WIDGETS).map((n) => load(n)));
  out.textContent =
    'Note Promise.allSettled, not Promise.all. Promise.all rejects as soon as ONE promise rejects,\n' +
    'which in a UI means one failed widget discards the results of the three that succeeded.\n\n' +
    'That single choice is the most common cause of "the whole page is broken because one API is\n' +
    'down". Use allSettled and handle each result, or give each widget its own independent load.';
});

on('fail-one', async () => {
  log.head('— recommendations service is down —');
  await Promise.allSettled([load('product'), load('reviews'), load('recs', { fail: true }), load('social')]);
  out.textContent =
    'The recommendations widget is gone; nothing else noticed.\n\n' +
    'It disappeared SILENTLY, and that is the right call for a nice-to-have: a user who never knew\n' +
    'recommendations existed does not need an apology for their absence. An error box in its place\n' +
    'would be worse than the gap — it draws attention to a failure the user does not care about,\n' +
    'and it makes the page look broken when it is not.\n\n' +
    'The rule: MATCH THE VISIBILITY OF THE FAILURE TO THE IMPORTANCE OF THE FEATURE. Critical\n' +
    'failures are loud and offer a retry. Decorative failures are invisible. Getting this backwards\n' +
    'is how you get a page covered in yellow warning triangles that everyone has learned to ignore.';
});

on('fail-critical', async () => {
  log.head('— the product service is down —');
  await Promise.allSettled([load('product', { fail: true }), load('reviews'), load('recs'), load('social')]);
  out.textContent =
    'The critical widget failed, so we say so, clearly, with a retry — and the rest of the page is\n' +
    'still there.\n\n' +
    'The temptation is to replace the whole page with an error screen. Resist it when there is\n' +
    'still something useful: the header, the navigation, the search box and the reviews all still\n' +
    'work, and a user who can navigate away is in a much better position than one staring at a\n' +
    'full-page "Something went wrong".\n\n' +
    'Reserve the full-page error for the case where nothing on the page can be trusted — and even\n' +
    'then, keep the navigation.';
});

on('slow', async () => {
  log.head('— everything is slow (2s), with a 1.5s per-widget timeout —');
  await Promise.allSettled(Object.keys(WIDGETS).map((n) => load(n, { delay: 2000 })));
  out.textContent =
    'Every widget hit its timeout and degraded. That is the timeout doing its job, and it is worth\n' +
    'being precise about why it exists.\n\n' +
    'WITHOUT A TIMEOUT, "SLOW" AND "BROKEN" ARE THE SAME EXPERIENCE — except that slow is worse,\n' +
    'because the user waits before finding out. A request with no timeout can hang for the\n' +
    'browser\'s default (minutes), holding a spinner and a connection the whole time.\n\n' +
    'AbortController is the mechanism, and it is two lines:\n\n' +
    '  const ac = new AbortController();\n' +
    '  const t = setTimeout(() => ac.abort(), 1500);\n' +
    '  await fetch(url, { signal: ac.signal });\n\n' +
    '(AbortSignal.timeout(1500) is the modern one-liner, and it aborts with a TimeoutError so you\n' +
    'can distinguish it from a user-initiated cancel.)\n\n' +
    'Choose the number from the USER, not the network: how long is waiting still useful to them?\n' +
    'For a page widget that is often 1–3 seconds. Lab 04.';
});

on('tiers', () => {
  renderTable('#results', [
    { tier: 'critical', example: 'the product, the price, the checkout button', onFailure: 'say so, loudly, with a retry', blocks: 'yes — the page has no purpose without it' },
    { tier: 'important', example: 'reviews, stock, delivery estimate', onFailure: 'a labelled placeholder; keep the page usable', blocks: 'no' },
    { tier: 'nice to have', example: 'recommendations, recently viewed', onFailure: 'hide it silently', blocks: 'no' },
    { tier: 'decorative', example: 'social proof, animations, avatars', onFailure: 'hide it silently', blocks: 'no' },
    { tier: 'analytics', example: 'tracking, experiments', onFailure: 'fail silently and NEVER block rendering', blocks: 'never' },
  ], { columns: ['tier', 'example', 'onFailure', 'blocks'] });
  out.textContent =
    'Do this exercise on your own product, in writing, with the people who own the features. It\n' +
    'takes an hour and it settles arguments that otherwise happen during an incident.\n\n' +
    'Three things that fall out of it immediately:\n\n' +
    '1. ANALYTICS AND EXPERIMENTS ARE TIER 5, ALWAYS. A tracking script that blocks rendering, or\n' +
    '   an experiment framework whose failure leaves the page blank, is a self-inflicted outage\n' +
    '   caused by code that produces no user value. Load them async, wrap them, and let them fail.\n' +
    '2. THE TIER DETERMINES THE FETCH STRATEGY. Critical data is server-rendered or fetched first,\n' +
    '   with a generous timeout and a retry. Decorative data is fetched last, with a short timeout\n' +
    '   and no retry.\n' +
    '3. A FALLBACK IS NOT AN ERROR MESSAGE. It is the smallest useful thing you can still show:\n' +
    '   cached data with a timestamp, a static default, a reduced feature. "Reviews unavailable" is\n' +
    '   a fallback; a red box with a stack trace is not.\n\n' +
    'And the version of this that lives in your code: SSR and streaming let you send the critical\n' +
    'tier first and let the rest arrive when it can (rendering-strategies lab 06), and Suspense\n' +
    'boundaries express the same tiering in a component tree.';
});
