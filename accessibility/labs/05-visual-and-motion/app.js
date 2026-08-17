// Lab 05 — Visual & motion. Real contrast maths, real measurements.

import { $, $$, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

// WCAG relative luminance and contrast ratio — 12 lines, worth reading once so the numbers
// stop being magic.
const channel = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const parse = (css) => css.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
const ratio = (fg, bg) => {
  const [a, b] = [luminance(parse(fg)), luminance(parse(bg))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

on('contrast', () => {
  const rows = $$('.swatch').map((el) => {
    const cs = getComputedStyle(el);
    const r = ratio(cs.color, cs.backgroundColor);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = large ? 3 : 4.5;
    return {
      swatch: el.textContent, ratio: r.toFixed(2), needs: `${need}:1${large ? ' (large text)' : ''}`,
      verdict: r >= need ? 'passes AA' : 'FAILS',
      _verdictClass: r >= need ? 'ok' : 'no',
    };
  });
  renderTable('#results', rows, { columns: ['swatch', 'ratio', 'needs', 'verdict'] });
  out.textContent =
    'The thresholds, and what each is for:\n\n' +
    '  4.5:1   normal text (AA)                 — the one you will be measured against\n' +
    '  3:1     large text (≥24px, or ≥18.7px bold)\n' +
    '  3:1     UI COMPONENTS and meaningful graphics (AA 1.4.11) — borders, icons, focus rings,\n' +
    '          chart lines, the edge of an input. This one is missed constantly.\n' +
    '  7:1     normal text (AAA)\n\n' +
    'Two things the formula does NOT capture, which is why it is being replaced:\n' +
    '  · it treats all hues alike, so some passing combinations are genuinely hard to read and some\n' +
    '    failing ones are fine (light text on dark is systematically underrated by it)\n' +
    '  · it says nothing about font weight or size beyond one threshold\n' +
    'APCA (in draft for WCAG 3) models this properly. Use it to make better decisions; use the\n' +
    'current formula for compliance, because that is what the law references today.\n\n' +
    'And the practical one: 1 in 12 men has a colour vision deficiency. NEVER USE COLOUR ALONE —\n' +
    'add an icon, a label, a pattern, a position. A red/green status dot with no text is invisible\n' +
    'information to millions of people.';
});

on('zoom', () => {
  renderTable('#results', [
    { requirement: 'Reflow (1.4.10, AA)', means: 'usable at 320 CSS px wide with no 2-D scrolling', test: 'set the window to 1280px and zoom to 400%' },
    { requirement: 'Resize text (1.4.4, AA)', means: 'text scales to 200% without loss', test: 'browser zoom, and text-only zoom in Firefox' },
    { requirement: 'Text spacing (1.4.12, AA)', means: 'survives increased line/word/letter spacing', test: 'the WCAG text-spacing bookmarklet' },
    { requirement: 'Orientation (1.3.4, AA)', means: 'do not lock to portrait or landscape', test: 'rotate' },
  ], { columns: ['requirement', 'means', 'test'] });
  out.textContent =
    'THE 400% ZOOM TEST, in one line: set your browser window to 1280px and zoom to 400%. That is\n' +
    'the equivalent of a 320px viewport, which is the requirement.\n\n' +
    'Do it on your own app now. What usually breaks:\n' +
    '  · fixed heights on anything containing text (the text overflows or is clipped)\n' +
    '  · position: fixed headers and footers that now occupy the whole screen\n' +
    '  · horizontal scrolling, which is the actual failure condition\n' +
    '  · tables — the one legitimate exception, and even then wrap them in a scroll container\n' +
    '  · absolutely positioned "tooltips" landing off-screen\n\n' +
    'The reason this test is so effective is that it is the SAME failure surface as a small phone,\n' +
    'so it doubles as responsive QA. And the fix is almost always the same: use min-height instead\n' +
    'of height, rem instead of px for anything text-sized, and let content wrap.\n\n' +
    'The text-spacing criterion catches the other half: line-height 1.5, letter-spacing 0.12em,\n' +
    'word-spacing 0.16em, paragraph spacing 2em applied to everything. If your buttons clip their\n' +
    'labels under that, they were relying on a fixed height they should not have had.';
});

on('motion', () => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  log[reduced ? 'ok' : 'muted'](`prefers-reduced-motion: ${reduced ? 'reduce' : 'no-preference'}`);
  out.textContent =
    `Your system currently says: ${reduced ? 'REDUCE' : 'no preference'}.\n\n` +
    'The animated square above is stopped by the media query in /shared/lab.css. Turn the setting on\n' +
    '(macOS: Accessibility → Display → Reduce motion; Windows: Settings → Accessibility → Visual\n' +
    'effects → Animation effects) and watch it stop.\n\n' +
    'This is not a stylistic preference. Vestibular disorders are real and common, and large\n' +
    'parallax, zoom and slide transitions can cause genuine nausea and dizziness. Someone who has\n' +
    'turned this setting on has told you something about their body.\n\n' +
    'The blanket reset (in lab.css) is a good default:\n\n' +
    '  @media (prefers-reduced-motion: reduce) {\n' +
    '    *, *::before, *::after { animation-duration: .01ms !important;\n' +
    '      animation-iteration-count: 1 !important; transition-duration: .01ms !important;\n' +
    '      scroll-behavior: auto !important; }\n' +
    '  }\n\n' +
    'But "reduce" does not mean "remove". A cross-fade or an instant state change is usually\n' +
    'BETTER than a hard cut, because motion often carries meaning (this panel came from there).\n' +
    'The rule of thumb: remove MOVEMENT (translate, scale, parallax, spin), keep opacity.\n\n' +
    'Also in scope, and separately required:\n' +
    '  · WCAG 2.2.2 — anything that moves, blinks or auto-updates for more than 5 seconds needs a\n' +
    '    pause/stop/hide control. Carousels, tickers, animated backgrounds.\n' +
    '  · WCAG 2.3.1 — nothing may flash more than 3 times per second (seizure risk).\n' +
    '  · Autoplaying video: pause it under reduced motion, and never autoplay with sound.';
});

on('targets', () => {
  const rows = $$('.targets button').map((el) => {
    const r = el.getBoundingClientRect();
    const min = Math.min(r.width, r.height);
    return {
      button: el.textContent,
      size: `${Math.round(r.width)}×${Math.round(r.height)}`,
      'AA (24px)': min >= 24 ? 'passes' : 'FAILS',
      'AAA / mobile (44px)': min >= 44 ? 'passes' : 'small',
    };
  });
  renderTable('#results', rows, { columns: ['button', 'size', 'AA (24px)', 'AAA / mobile (44px)'] });
  out.textContent =
    'WCAG 2.2 added 2.5.8 Target Size (Minimum): 24×24 CSS px, at AA. 2.5.5 (AAA) asks for 44×44,\n' +
    'which is also Apple\'s long-standing guidance and roughly the size of a fingertip.\n\n' +
    'The exceptions in 2.5.8 matter in practice: inline links in a sentence are exempt, and a small\n' +
    'target is allowed if there is 24px of SPACING around it — which is why a row of tiny icon\n' +
    'buttons packed together is the failing case, not a small button on its own.\n\n' +
    'Cheap ways to fix it without changing the design:\n' +
    '  · padding on the interactive element (not margin on a wrapper — padding is part of the\n' +
    '    target, margin is not)\n' +
    '  · a ::before pseudo-element with negative insets to extend the hit area invisibly\n' +
    '  · make the whole row/card the target instead of the icon inside it\n\n' +
    'And the group most affected is not who people assume: it is anyone with a tremor, anyone using\n' +
    'a phone one-handed on a moving train, and anyone over about 60. This is a usability\n' +
    'requirement that happens to be written down.';
});

on('other', () => {
  renderTable('#results', [
    { query: 'prefers-reduced-motion', respond: 'remove movement, keep opacity' },
    { query: 'prefers-color-scheme', respond: 'a real dark theme; do not just invert' },
    { query: 'prefers-contrast: more', respond: 'stronger borders and text; drop subtle greys' },
    { query: 'forced-colors: active', respond: 'Windows High Contrast — do not fight it; use forced-color-adjust sparingly' },
    { query: 'prefers-reduced-transparency', respond: 'drop the frosted-glass backdrop' },
    { query: 'prefers-reduced-data', respond: 'smaller images, no autoplay video' },
    { query: 'inverted-colors', respond: 'compensate images so photos are not negatives' },
  ], { columns: ['query', 'respond'] });
  out.textContent =
    'forced-colors (Windows High Contrast Mode) is the one that breaks custom components hardest,\n' +
    'and it is worth ten minutes of your time to try. Windows replaces your palette entirely with\n' +
    'the user\'s chosen system colours. What survives: native elements, borders, and text. What\n' +
    'disappears: background images used as icons, box-shadow-only borders, colour-only state,\n' +
    'and anything whose visibility depended on a background colour you set.\n\n' +
    'The fixes are mostly structural: use borders rather than shadows to delimit things, use\n' +
    'currentColor for icons so they follow text colour, use system colour keywords (ButtonText,\n' +
    'Canvas, Highlight) inside a forced-colors media query, and test that a "selected" state is\n' +
    'still visible when your background colour is ignored.\n\n' +
    'The general principle behind every row of that table: THE USER HAS TOLD THE BROWSER SOMETHING\n' +
    'ABOUT HOW THEY NEED TO SEE. Reading it is free; ignoring it is a choice.';
});
