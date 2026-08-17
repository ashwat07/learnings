// Lab 02 — LCP: attribute it to a phase before you fix it.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';
import { vitals, onVitals, vitalsHud, rate } from '/shared/vitals.js';

const log = new Log('#log');
const out = $('out');
vitalsHud();

const scenario = new URLSearchParams(location.search).get('s') || 'baseline';
const HERO = '/api/image.svg?name=hero&delay=500&w=620&h=220&label=hero+image';
const stage = $('#stage');

// Each scenario differs ONLY in how the browser learns the hero exists.
const SCENARIOS = {
  baseline: () => { stage.innerHTML = `<img src="${HERO}" alt="hero" fetchpriority="auto">`; },

  css: () => {
    // The preload scanner cannot see this: the URL is inside a stylesheet that must be fetched and
    // parsed first, and the element must be matched before the image is even requested.
    stage.innerHTML = '<div id="hero" style="height:220px;max-width:620px;border-radius:8px;' +
      'background-size:cover"></div>';
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = `/api/style.css?delay=400&name=heroCss&img=${encodeURIComponent(HERO)}`;
    document.head.append(style);
  },

  js: () => {
    // Worse: nothing exists until a script has downloaded, parsed and run.
    setTimeout(() => { stage.innerHTML = `<img src="${HERO}" alt="hero">`; }, 900);
  },

  lazy: () => {
    // loading="lazy" on an above-the-fold image defers the request until layout has decided the
    // element is near the viewport — which is after layout, which is after CSS.
    stage.innerHTML = `<img src="${HERO}" alt="hero" loading="lazy">`;
  },

  preload: () => {
    const link = document.createElement('link');
    link.rel = 'preload'; link.as = 'image'; link.href = HERO; link.fetchPriority = 'high';
    document.head.prepend(link);
    stage.innerHTML = `<img src="${HERO}" alt="hero" fetchpriority="high" decoding="async">`;
  },

  text: () => {
    stage.innerHTML = '<h2 class="big">A large block of text is a perfectly good LCP element — ' +
      'and it needs no network request at all, provided the font it renders in is already there.</h2>';
  },
};
(SCENARIOS[scenario] ?? SCENARIOS.baseline)();

for (const key of Object.keys(SCENARIOS)) {
  on(`s-${key}`, () => { location.search = `?s=${key}`; });
}

const NOTES = {
  baseline: 'The <img> is in the initial HTML, so the preload scanner finds it while the parser is\n' +
    'still working. This is the floor: TTFB + the image download.',
  css: 'The image URL lives inside a stylesheet. The chain is HTML → CSS → match the selector →\n' +
    'request the image. The preload scanner never sees it, because a preload scanner scans HTML.\n' +
    'This is the single most common cause of a slow LCP on a real site.',
  js: 'Nothing exists until a script has downloaded, parsed, executed and mutated the DOM. Every\n' +
    'client-rendered hero pays this. See rendering-strategies lab 01.',
  lazy: 'loading="lazy" defers the request until layout knows the element is near the viewport —\n' +
    'so it cannot start before CSS. NEVER lazy-load anything above the fold. This one-line\n' +
    '"optimisation" regularly costs a second.',
  preload: 'A <link rel=preload as=image fetchpriority=high> in the head starts the download at\n' +
    'the earliest possible moment, and the priority tells the browser not to queue it behind\n' +
    'scripts. Preload does not make the download faster; it makes the DISCOVERY earlier.',
  text: 'No request at all. The fastest LCP is the one that does not need the network — which is\n' +
    'why a text hero with a system font, or a font with size-adjust metrics, beats a hero image\n' +
    'every time on slow connections.',
};

onVitals((v) => {
  renderTable('#results', [
    { measure: 'scenario', value: scenario },
    { measure: 'TTFB', value: v.TTFB == null ? '—' : `${Math.round(v.TTFB)}ms` },
    { measure: 'FCP', value: v.FCP == null ? '—' : `${Math.round(v.FCP)}ms` },
    { measure: 'LCP', value: v.LCP == null ? '—' : `${Math.round(v.LCP)}ms`, verdict: rate('LCP', v.LCP) },
    { measure: 'LCP element', value: v.lcpElement ?? '—' },
  ], { columns: ['measure', 'value', 'verdict'] });
});

setTimeout(() => {
  log.head(`scenario "${scenario}": LCP ${Math.round(vitals.LCP ?? 0)}ms on ${vitals.lcpElement}`);
  out.textContent = NOTES[scenario] + '\n\nRun the others and write the numbers down — the point is ' +
    'the SPREAD, not any single value.';
}, 2500);

on('phases', () => {
  renderTable('#results', [
    { phase: '1. TTFB', typical: '~40%', fix: 'server time, redirects, CDN, edge cache, streaming the shell' },
    { phase: '2. Resource load delay', typical: 'the big one', fix: 'preload scanner visibility, preconnect, no CSS/JS in the discovery chain, fetchpriority' },
    { phase: '3. Resource load duration', typical: 'small if you sized it right', fix: 'format (AVIF/WebP), responsive srcset, compression, CDN' },
    { phase: '4. Element render delay', typical: 'the sneaky one', fix: 'render-blocking CSS, blocking fonts, hydration, a JS framework painting late' },
  ], { columns: ['phase', 'typical', 'fix'] });
  out.textContent =
    'This breakdown is the entire debugging method, and it is why "the image is 400KB" is usually\n' +
    'the wrong answer. Phase 2 — LOAD DELAY — dominates on most real sites: the browser could have\n' +
    'downloaded the image in 200ms, but did not know it existed until 2s in.\n\n' +
    'Get the breakdown for free with the web-vitals library:\n' +
    "  onLCP(m => console.log(m.attribution), {reportAllChanges: false})\n" +
    'which gives you element, url, timeToFirstByte, resourceLoadDelay, resourceLoadDuration and\n' +
    'elementRenderDelay. Send those to your RUM, not just the total.';
});

on('checklist', () => {
  renderTable('#results', [
    { rule: 'The LCP image is a plain <img> in the initial HTML', why: 'the preload scanner can find it' },
    { rule: 'fetchpriority="high" on it', why: 'images default to Low priority until layout says otherwise' },
    { rule: 'Never loading="lazy" above the fold', why: 'defers discovery until after layout' },
    { rule: 'preconnect to the image host if it is a third party', why: 'DNS+TLS is 100–300ms you pay before the request' },
    { rule: 'No LCP image referenced only from CSS or JS', why: 'the discovery chain is the cost' },
    { rule: 'srcset/sizes so mobile does not download the desktop asset', why: 'phase 3' },
    { rule: 'Fonts: font-display:swap or optional + size-adjust', why: 'a text LCP blocked on a font is phase 4' },
    { rule: 'Critical CSS inline, the rest deferred', why: 'render-blocking CSS delays the paint of an image already in memory' },
    { rule: 'Measure the p75 on a mid-range Android', why: 'your laptop is not the 75th percentile' },
  ], { columns: ['rule', 'why'] });
  out.textContent =
    'Related labs, because LCP is where four courses meet:\n' +
    '  · resource-hints lab 02–04 — preconnect, preload, fetchpriority, the preload scanner\n' +
    '  · asset-optimization labs 01–03 — formats, srcset, fonts\n' +
    '  · rendering-strategies labs 02–06 — TTFB and streaming\n' +
    '  · critical-rendering-path labs 01–04 — render-blocking CSS and the paint';
});
