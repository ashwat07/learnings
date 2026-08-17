// Lab 02 — Viewports & containers.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const readout = () => {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;height:100svh;width:0;visibility:hidden';
  document.body.append(el);
  const svh = el.getBoundingClientRect().height;
  el.style.height = '100lvh'; const lvh = el.getBoundingClientRect().height;
  el.style.height = '100dvh'; const dvh = el.getBoundingClientRect().height;
  el.remove();
  $('#readout').textContent =
    `innerWidth ${innerWidth} · innerHeight ${innerHeight} · visualViewport ${Math.round(visualViewport.width)}×${Math.round(visualViewport.height)} ` +
    `· 100svh ${Math.round(svh)} · 100lvh ${Math.round(lvh)} · 100dvh ${Math.round(dvh)} · dpr ${devicePixelRatio}`;
};
readout();
addEventListener('resize', readout);
visualViewport.addEventListener('resize', readout);

on('units', () => {
  renderTable('#results', [
    { unit: 'vh', is: 'the LARGE viewport height — as if the browser bars are hidden', gotcha: 'on mobile this is TALLER than what you can see; content is cut off' },
    { unit: 'svh', is: 'the SMALL viewport — bars visible', gotcha: 'safe, but leaves a gap when the bars retract' },
    { unit: 'lvh', is: 'the LARGE viewport — bars hidden', gotcha: 'same as the old vh' },
    { unit: 'dvh', is: 'the DYNAMIC viewport — changes as bars appear', gotcha: 'correct, but it RESIZES during scroll, which can cause reflow' },
    { unit: 'vi / vb', is: 'inline / block viewport size', gotcha: 'writing-mode aware — the logical version' },
    { unit: 'visualViewport', is: 'what is actually visible, including pinch-zoom and the keyboard', gotcha: 'a JS API, not a unit — the only way to know about the on-screen keyboard' },
  ], { columns: ['unit', 'is', 'gotcha'] });
  out.textContent =
    'THE 100vh BUG, precisely: on mobile, 100vh has always meant the viewport height WITH THE BROWSER\n' +
    'BARS HIDDEN. So a full-height hero with height: 100vh is taller than the visible area whenever\n' +
    'the bars are showing, and its bottom is cut off — which is where "my button is under the URL\n' +
    'bar" comes from.\n\n' +
    'The fix is the newer units:\n' +
    '  height: 100svh   always fits (small viewport) — the safe default for a full-screen layout\n' +
    '  height: 100dvh   fills exactly, and animates as the bars move — nicer, but it triggers layout\n' +
    '                   during scroll, so avoid it on anything expensive\n\n' +
    'AND THE ON-SCREEN KEYBOARD is a separate problem that no CSS unit solves. When it opens, the\n' +
    'VISUAL viewport shrinks but the layout viewport usually does not, so a position: fixed footer\n' +
    'sits behind the keyboard. The only reliable signal is the visualViewport API:\n\n' +
    "  visualViewport.addEventListener('resize', () => {\n" +
    '    const inset = innerHeight - visualViewport.height - visualViewport.offsetTop;\n' +
    '    document.documentElement.style.setProperty("--kb", inset + "px");\n' +
    '  });\n\n' +
    '(The newer VirtualKeyboard API gives this directly, where supported.)';
});

on('containers', () => {
  renderTable('#results', [
    { concept: 'container-type: inline-size', does: 'makes an element a query container for its width' },
    { concept: '@container (min-width: 380px)', does: 'styles children based on the CONTAINER, not the viewport' },
    { concept: 'container-name', does: 'lets you target a specific ancestor container' },
    { concept: 'cqw / cqi / cqb units', does: 'percentages of the container, usable in calc()' },
    { concept: 'style queries', does: '@container style(--variant: compact) — query a custom property' },
    { concept: ':has()', does: 'the other half — style a parent based on its children' },
  ], { columns: ['concept', 'does'] });
  out.textContent =
    'Drag the box: the card switches from stacked to side-by-side WITHOUT THE VIEWPORT CHANGING.\n\n' +
    'This is the fix for the oldest problem in component design. A card in the main column and the\n' +
    'same card in a 300px sidebar need different layouts, and a media query cannot tell them apart —\n' +
    'so component libraries grew size PROPS ("variant=compact"), which pushed a layout decision up\n' +
    'into every caller and made components impossible to move.\n\n' +
    'With container queries the component knows its own size and decides for itself. That is a real\n' +
    'architectural change, not a convenience: it makes components genuinely portable, which is the\n' +
    'thing design systems have always claimed and rarely delivered (architecture-and-state lab 06).\n\n' +
    'Two practical notes:\n' +
    '  · container-type: inline-size CONTAINS the element in the inline direction, which can change\n' +
    '    layout on its own — apply it to a wrapper, not to the styled element itself\n' +
    '  · you still want media queries for PAGE-LEVEL decisions (how many columns the grid has) and\n' +
    '    container queries for COMPONENT-level ones. They are complementary, not a replacement.';
});

on('safe', () => {
  renderTable('#results', [
    { thing: 'viewport-fit=cover', needed: 'required in the meta tag before env() returns anything non-zero' },
    { thing: 'env(safe-area-inset-top/right/bottom/left)', needed: 'the notch, the home indicator, rounded corners' },
    { thing: 'env(keyboard-inset-height)', needed: 'the VirtualKeyboard API, where supported' },
    { thing: 'padding: max(16px, env(safe-area-inset-left))', needed: 'the standard pattern — a floor plus the inset' },
    { thing: 'display-mode: standalone', needed: 'an installed PWA has no browser chrome to protect you' },
  ], { columns: ['thing', 'needed'] });
  out.textContent =
    'The pattern to memorise:\n\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n\n' +
    '  .app {\n' +
    '    padding-top:    max(16px, env(safe-area-inset-top));\n' +
    '    padding-bottom: max(16px, env(safe-area-inset-bottom));\n' +
    '    padding-inline: max(16px, env(safe-area-inset-left));\n' +
    '  }\n\n' +
    'max() rather than a bare env() because the inset is 0 on most devices and you still want your\n' +
    'normal padding. Without viewport-fit=cover the env() values are all zero and nothing happens,\n' +
    'which is the usual reason "safe areas do not work".\n\n' +
    'This matters most in an INSTALLED PWA (offline-and-pwa lab 01), where there is no browser\n' +
    'chrome between your header and the notch — and in landscape, where the left/right insets\n' +
    'suddenly matter and almost nobody tests.';
});

on('fluid', () => {
  out.textContent =
    'FLUID TYPE AND SPACE, without a breakpoint in sight:\n\n' +
    '  font-size: clamp(1rem, 0.9rem + 0.5vw, 1.5rem);\n' +
    '  gap:       clamp(8px, 2vw, 24px);\n' +
    '  width:     min(100%, 65ch);\n' +
    '  padding:   max(16px, env(safe-area-inset-left));\n\n' +
    'clamp(MIN, PREFERRED, MAX) removes an entire category of breakpoints. The important detail is\n' +
    'the middle term: use a rem PLUS a viewport unit (0.9rem + 0.5vw), never a bare vw. A bare vw\n' +
    'does not respond to the user\'s browser font-size setting, so a page built from pure vw type is\n' +
    'unzoomable — a WCAG 1.4.4 failure. Including a rem keeps user scaling working.\n\n' +
    'The other units worth knowing:\n' +
    '  ch     the width of a "0" — min(100%, 65ch) gives a readable measure at any size\n' +
    '  rem    always for type and spacing; px only for hairlines and borders\n' +
    '  %      of the parent; often what you actually meant when you reached for vw\n\n' +
    'And the layout primitives that make most breakpoints unnecessary:\n' +
    '  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));\n' +
    '  flex-wrap: wrap; with flex-basis\n' +
    'Both reflow continuously instead of jumping at arbitrary widths — which is the whole point,\n' +
    'because there are no standard device widths any more and never really were.';
});
