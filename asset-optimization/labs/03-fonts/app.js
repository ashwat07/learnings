// Lab 03 — Fonts.

import { $, on, Log, renderTable, fmt } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const params = new URLSearchParams(location.search);
const CASE = params.get('case') || 'swap';
const DELAY = Number(params.get('delay') || 2500);
$('delay').value = DELAY;

on($('delay'), 'change', (e) => {
  params.set('delay', e.target.value);
  params.set('case', CASE);
  location.search = params.toString();
});

// ---------------------------------------------------------------------------
// The @font-face rule for this case
//
// Playfair Display is used deliberately: its metrics are very different from the Georgia
// fallback, so the swap produces a VISIBLE layout shift. A fallback with similar metrics would
// hide the problem this lab is about.
// ---------------------------------------------------------------------------

const FONT_URL = `/api/font?name=playfair-700&delay=${DELAY}`;

const CASES = {
  block: { display: 'block', preload: false, adjust: false },
  swap: { display: 'swap', preload: false, adjust: false },
  fallback: { display: 'fallback', preload: false, adjust: false },
  optional: { display: 'optional', preload: false, adjust: false },
  preload: { display: 'swap', preload: true, adjust: false },
  adjust: { display: 'swap', preload: false, adjust: true },
};
const config = CASES[CASE] ?? CASES.swap;

// A preload injected this late is nearly useless — it is here so the lab can demonstrate the
// difference between a preload in the HTML and one added by script. Case 5's readout explains it.
if (config.preload) {
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'font';
  link.type = 'font/woff2';
  link.href = FONT_URL;
  link.crossOrigin = 'anonymous';        // mandatory for fonts, even same-origin
  document.head.prepend(link);
}

const style = document.createElement('style');
style.textContent = `
@font-face {
  font-family: LabFont;
  src: url("${FONT_URL}") format("woff2");
  font-weight: 700;
  font-display: ${config.display};
  ${config.adjust ? `
  /* Metric overrides: make the FALLBACK occupy the same space as the web font, so the swap
     changes the glyphs and not the layout. The numbers come from comparing the two fonts'
     ascent/descent/line-gap and average character width. */
  size-adjust: 108%;
  ascent-override: 92%;
  descent-override: 22%;
  line-gap-override: 0%;` : ''}
}`;
document.head.append(style);

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

const metrics = { cls: 0, shifts: [], fontLoadedAt: null, firstPaint: null, fcp: null };

try {
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.hadRecentInput) continue;
      metrics.cls += e.value;
      metrics.shifts.push({ at: Math.round(e.startTime), value: +e.value.toFixed(4) });
    }
    paint();
  }).observe({ type: 'layout-shift', buffered: true });

  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') metrics.fcp = e.startTime;
    paint();
  }).observe({ type: 'paint', buffered: true });
} catch { /* unsupported */ }

// document.fonts tells you exactly when the face became usable.
document.fonts.ready.then(() => {
  const loaded = [...document.fonts].filter((f) => f.family === 'LabFont' && f.status === 'loaded');
  metrics.fontLoadedAt = performance.now();
  metrics.fontLoaded = loaded.length > 0;
  $('which').textContent = loaded.length
    ? `rendered in LabFont (Playfair) at ${Math.round(metrics.fontLoadedAt)}ms`
    : 'still the fallback (Georgia) — the web font never became usable';
  log.line(loaded.length
    ? `font became usable at ${fmt.ms(metrics.fontLoadedAt)}`
    : 'font did not load (offline? run make-fonts.mjs) — the timeline above is still real',
  loaded.length ? 'good' : 'bad');
  paint();
});

function paint() {
  renderTable('#scoreboard', [{
    case: `${CASE} (font-display: ${config.display}${config.preload ? ' + preload' : ''}${config.adjust ? ' + overrides' : ''})`,
    'font delay': `${DELAY}ms`,
    FCP: metrics.fcp ? fmt.ms(metrics.fcp) : '–',
    'font usable': metrics.fontLoadedAt ? fmt.ms(metrics.fontLoadedAt) : '–',
    CLS: metrics.cls.toFixed(4),
    shifts: metrics.shifts.length,
    _CLSClass: metrics.cls > 0.1 ? 'no' : metrics.cls > 0.02 ? 'meh' : 'ok',
  }], { columns: ['case', 'font delay', 'FCP', 'font usable', 'CLS', 'shifts'] });
}

// ---------------------------------------------------------------------------

const NOTES = {
  block:
    'font-display: block — the browser hides the text for up to ~3 seconds waiting for the font.\n' +
    'That is FOIT: Flash Of Invisible Text. The content exists, it painted, and the user cannot\n' +
    'read it.\n\n' +
    'Watch the specimen: blank, then the text appears. FCP may even be recorded, because other\n' +
    'things painted — so a page can have a good FCP and no readable text, which is exactly the\n' +
    'kind of thing metrics miss and users do not.\n\n' +
    'Use it only where showing the wrong glyphs is worse than showing nothing: icon fonts (a\n' +
    'fallback would render random letters where icons should be) and almost nothing else.',
  swap:
    'font-display: swap — the fallback renders immediately and the real font swaps in when it\n' +
    'arrives. Text is readable the whole time.\n\n' +
    'The cost is in the CLS column. Playfair and Georgia have different metrics, so when the swap\n' +
    'happens every line re-flows and everything below it moves. That is a layout shift caused by a\n' +
    'font, and almost nobody attributes it correctly — it looks like an image or an ad.\n\n' +
    'swap is the right default. Case 6 removes the shift.',
  fallback:
    'font-display: fallback — a short block period (~100ms), then the fallback, and a swap only if\n' +
    'the font arrives within ~3 seconds. After that the fallback is kept for the rest of the page.\n\n' +
    'A compromise: a brief chance to avoid any flash at all, a bounded FOIT, and no late swap that\n' +
    'moves text under a reading user. Good for body copy on content sites.',
  optional:
    'font-display: optional — ~100ms block, then the fallback, and the browser may decide NOT to\n' +
    'use the web font at all on this page load (it will still cache it for the next one).\n\n' +
    'This is the only value that guarantees no layout shift from fonts, because the swap never\n' +
    'happens late. On a slow connection the user simply sees the fallback — and on their second\n' +
    'visit, the real font from cache with no shift.\n\n' +
    'It is the right choice more often than people think: if your brand font is nice-to-have\n' +
    'rather than load-bearing, `optional` gives you zero CLS and zero FOIT.',
  preload:
    'A preload removes one hop from the chain: normally the font is discovered only after the CSS\n' +
    'has downloaded, parsed, and matched a rule to text on the page.\n\n' +
    'Two rules, both easy to get wrong:\n' +
    '  • crossorigin is MANDATORY on a font preload, even same-origin — fonts are fetched in CORS\n' +
    '    mode, and a non-CORS preload cannot be reused, so you download it TWICE\n' +
    '  • it must be in the HTML <head> as sent by the server. This lab injects it with script to\n' +
    '    show you the mechanism, which is close to useless in practice: by the time the script has\n' +
    '    run, the CSS has usually already found the font\n\n' +
    'And preload only the fonts used ABOVE THE FOLD, at the weights you actually render. Preloading\n' +
    'six weights makes everything else on the critical path slower.',
  adjust:
    'Same swap, no shift. The @font-face carries metric overrides that make the FALLBACK occupy the\n' +
    'same space as the web font:\n\n' +
    '    size-adjust: 108%;      /* scale the fallback so its average width matches */\n' +
    '    ascent-override: 92%;\n' +
    '    descent-override: 22%;\n' +
    '    line-gap-override: 0%;\n\n' +
    'Now the swap changes the glyphs and not the geometry, so CLS stays near zero while the text is\n' +
    'readable from the first paint. This is what "zero-layout-shift font loading" means, and it is\n' +
    'what Next.js\'s next/font and Fontaine do for you automatically.\n\n' +
    'Getting the numbers by hand: compare the two fonts\' ascent, descent, lineGap and average\n' +
    'character width (there are online calculators, or use a script over the font tables). The\n' +
    'numbers in this file were tuned for Playfair over Georgia.',
};

out.textContent = NOTES[CASE] ?? '';

// Report whether the font files exist at all, so an offline reader is not confused.
fetch('/api/font?name=playfair-700', { method: 'HEAD' }).then((res) => {
  $('#fontStatus').textContent = res.ok
    ? 'font files present — the full demo works, including the swap.'
    : 'No font files found. Run `node asset-optimization/make-fonts.mjs` (needs internet once). ' +
      'Without them the block/swap TIMELINE is still real — the browser cannot know the request ' +
      'will fail until it does — but you will not see the moment of swapping.';
});

paint();
