// Lab 02 — Image loading.
//
// Each case is a separate page load (the buttons are links), because LCP and CLS are only
// meaningful for a real navigation.

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const stage = $('#stage');
const BASE = '/asset-optimization/images';

const CASE = new URLSearchParams(location.search).get('case') || 'baseline';

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const metrics = { lcp: null, lcpElement: null, cls: 0, shifts: [] };

try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      metrics.lcp = e.startTime;
      metrics.lcpElement = e.element?.tagName + (e.element?.className ? `.${e.element.className}` : '');
      metrics.lcpUrl = e.url?.split('/').pop() ?? '';
    }
    paint();
  }).observe({ type: 'largest-contentful-paint', buffered: true });

  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.hadRecentInput) continue;
      metrics.cls += e.value;
      metrics.shifts.push({ at: e.startTime, value: e.value });
    }
    paint();
  }).observe({ type: 'layout-shift', buffered: true });
} catch { /* unsupported */ }

function paint() {
  renderTable('#scoreboard', [{
    case: CASE,
    LCP: metrics.lcp ? fmt.ms(metrics.lcp) : '–',
    'LCP element': metrics.lcpUrl || metrics.lcpElement || '–',
    CLS: metrics.cls.toFixed(3),
    shifts: metrics.shifts.length,
    _LCPClass: metrics.lcp > 2500 ? 'no' : metrics.lcp > 1200 ? 'meh' : 'ok',
    _CLSClass: metrics.cls > 0.1 ? 'no' : metrics.cls > 0.05 ? 'meh' : 'ok',
  }], { columns: ['case', 'LCP', 'LCP element', 'CLS', 'shifts'] });
}

// ---------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------

const thumb = (i, attrs = '') =>
  `<img src="${BASE}/thumb-${i}.png?delay=300" width="110" height="62" alt="" ${attrs}>`;

const hero = (attrs = '') =>
  `<img class="hero" src="${BASE}/hero-1200.png?delay=600" width="1200" height="675"
        alt="the LCP element" ${attrs}>`;

const CASES = {
  // Twelve thumbnails declared before the hero. The preload scanner queues them first, so on a
  // connection-limited origin the hero waits behind images nobody is looking at.
  baseline: () => `
    <div class="demo"><h3>12 thumbnails, then the hero — no hints</h3>
    <div class="strip">${Array.from({ length: 12 }, (_, i) => thumb(i)).join('')}</div>
    ${hero()}</div>`,

  priority: () => `
    <div class="demo"><h3>same page, fetchpriority on the hero and the thumbnails</h3>
    <div class="strip">${Array.from({ length: 12 }, (_, i) => thumb(i, 'fetchpriority="low"')).join('')}</div>
    ${hero('fetchpriority="high"')}</div>`,

  // loading="lazy" on the LCP element: the request cannot start until layout proves it is visible.
  lazyhero: () => `
    <div class="demo"><h3>the hero is loading="lazy" — the codemod bug</h3>
    ${hero('loading="lazy"')}
    <div class="strip">${Array.from({ length: 12 }, (_, i) => thumb(i, 'loading="lazy"')).join('')}</div></div>`,

  lazyrest: () => `
    <div class="demo"><h3>hero eager + high priority; thumbnails lazy</h3>
    ${hero('fetchpriority="high" loading="eager" decoding="async"')}
    <div style="height:900px" class="hint">↓ the thumbnails are below the fold ↓</div>
    <div class="strip">${Array.from({ length: 12 }, (_, i) => thumb(i, 'loading="lazy"')).join('')}</div></div>`,

  // No width/height: every image that arrives pushes the content below it down.
  cls: () => `
    <div class="demo"><h3>no width/height attributes</h3>
    <p class="shifty">This paragraph is above the images. Watch it move.</p>
    ${Array.from({ length: 4 }, (_, i) =>
    `<img src="${BASE}/hero-800.png?delay=${400 + i * 500}" alt="" style="max-width:100%">`).join('')}
    <p class="shifty">…and this one is below them.</p></div>`,

  fixed: () => `
    <div class="demo"><h3>width/height attributes present</h3>
    <p class="shifty">This paragraph is above the images. It should not move.</p>
    ${Array.from({ length: 4 }, (_, i) =>
    `<img src="${BASE}/hero-800.png?delay=${400 + i * 500}&v=fixed" width="800" height="450"
          style="max-width:100%;height:auto" alt="">`).join('')}
    <p class="shifty">…and this one is below them.</p></div>`,
};

const NOTES = {
  baseline:
    'The hero is the LCP element and it is queued behind twelve thumbnails, because the preload\n' +
    'scanner found them first and images start at LOW priority until layout proves they are in\n' +
    'the viewport.\n\n' +
    'Note the shape of the fix: nothing here is too big or too slow. The bytes are fine. The ORDER\n' +
    'is wrong, and order is free to change.',
  priority:
    'One attribute on the hero, one on the thumbnails, and the LCP element goes first.\n\n' +
    'fetchpriority="high" on the LCP image is the highest value-per-character change in this whole\n' +
    'course. It is free, it is one attribute, and on a contended connection it is worth hundreds of\n' +
    'milliseconds of LCP.\n\n' +
    'fetchpriority="low" on the thumbnails matters just as much: priority is a RANKING, so raising\n' +
    'one thing and lowering nothing changes less than you expect.',
  lazyhero:
    'loading="lazy" on the LCP element means the browser must run layout before it will even start\n' +
    'the request. Compare this LCP with case 2.\n\n' +
    'This is a real regression pattern: someone adds loading="lazy" to every <img> with a codemod\n' +
    '"for performance", and LCP gets measurably worse on every page. Lazy loading below the fold\n' +
    'saves real bytes; lazy loading the hero is a self-inflicted wound.\n\n' +
    'Rule: never lazy-load anything in the initial viewport.',
  lazyrest:
    'The right combination: the hero is eager and high priority; the thumbnails are lazy and are\n' +
    'not fetched at all until you scroll.\n\n' +
    'Scroll down and watch them appear in the Network panel. Bytes you never spend are the best\n' +
    'kind of optimisation — and on a listing page with 60 thumbnails this is the difference between\n' +
    'a 400KB page and a 3MB one.\n\n' +
    'decoding="async" is on the hero too: it lets the browser decode off the main thread. For a\n' +
    'large image that is a real TBT saving, and it is invisible unless you profile.',
  cls:
    'Every image that arrives pushes the paragraph below it down. The CLS number climbs with each\n' +
    'one, and the shifts land 400–2000ms in, which is exactly when a user might be reaching for a\n' +
    'link.\n\n' +
    'Cause: with no width/height, the browser cannot know how tall the image will be, so it\n' +
    'reserves zero space and reflows when the bytes arrive.',
  fixed:
    'Identical images, identical delays, CLS ≈ 0.\n\n' +
    'width and height attributes give the browser an ASPECT RATIO, from which it computes the\n' +
    'height for whatever width the CSS gives it. That is why the pairing is:\n\n' +
    '    <img width="800" height="450" style="max-width:100%; height:auto">\n\n' +
    'The attributes are NOT the display size — they are the intrinsic size, and modern browsers use\n' +
    'them purely to derive the ratio. Leaving them off is the single most common cause of CLS.\n\n' +
    'For images whose ratio you genuinely do not know, use aspect-ratio in CSS on a wrapper.',
};

// ---------------------------------------------------------------------------

stage.innerHTML = CASES[CASE]?.() ?? CASES.baseline();
out.textContent = NOTES[CASE] ?? '';
paint();

addEventListener('load', () => {
  setTimeout(() => {
    const imgs = performance.getEntriesByType('resource')
      .filter((e) => e.initiatorType === 'img')
      .sort((a, b) => a.startTime - b.startTime)
      .map((e) => ({
        image: e.name.split('/').pop().split('?')[0],
        'started ms': Math.round(e.startTime),
        'finished ms': Math.round(e.responseEnd),
        bytes: fmt.bytes(e.transferSize || e.encodedBodySize),
      }));
    renderTable('#results', imgs, { columns: ['image', 'started ms', 'finished ms', 'bytes'] });
    log.line(`${imgs.length} images fetched; LCP ${metrics.lcp ? Math.round(metrics.lcp) : '?'}ms; ` +
      `CLS ${metrics.cls.toFixed(3)}`, metrics.cls > 0.1 ? 'bad' : 'good');
    paint();
  }, 1200);
});
