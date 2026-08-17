// Lab 03 — CLS: find the node that moved, then look upward for the cause.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';
import { vitals, onVitals, vitalsHud, rate } from '/shared/vitals.js';

const log = new Log('#log');
const out = $('out');
vitalsHud();

const stage = $('#stage');
const CONTENT = `
  <p>Layout shift is scored as <b>impact fraction × distance fraction</b>. The impact fraction is
  how much of the viewport was occupied by things that moved; the distance fraction is how far the
  biggest of them travelled, as a share of the viewport. So one element crossing the whole screen
  and half the screen twitching score similarly — the metric is about how much of what you were
  looking at jumped.</p>
  <p>That is also why shifts <em>below the fold</em> still count when they are in the viewport, and
  why a shift at the top of a long article is so expensive: everything below it moves.</p>`;

function reset() {
  stage.innerHTML = CONTENT;
  $('#results').textContent = '';
}
reset();
on('reset', reset);

const sources = () => setTimeout(() => {
  renderTable('#results', [
    { detail: 'CLS', value: vitals.CLS.toFixed(4), verdict: rate('CLS', vitals.CLS) },
    ...vitals.clsSources.map((s) => ({ detail: `moved: ${s.node}`, value: s.value.toFixed(4), verdict: `${s.from} → ${s.to}` })),
  ], { columns: ['detail', 'value', 'verdict'] });
  log[vitals.CLS > 0.1 ? 'bad' : 'ok'](`CLS ${vitals.CLS.toFixed(4)}`);
}, 2200);

on('c-img', () => {
  reset();
  // No width/height and no aspect-ratio: the img occupies 0px until the bytes arrive, then jumps
  // to its intrinsic size and shoves everything below it down.
  stage.insertAdjacentHTML('afterbegin',
    '<img src="/api/image.svg?delay=1200&w=620&h=220&label=no+dimensions&name=cls1" alt="">');
  sources();
  out.textContent =
    'The classic. An <img> with no dimensions occupies zero height until the bytes arrive.\n\n' +
    'The fix is older than the metric: width and height attributes. Modern browsers turn them into\n' +
    'a default aspect-ratio, so the box is reserved at the right SHAPE even when CSS makes the\n' +
    'width fluid. You do not have to choose between responsive images and reserved space — you\n' +
    'never did.\n\n' +
    '  <img src="hero.jpg" width="620" height="220" style="width:100%;height:auto">';
});

on('c-banner', () => {
  reset();
  setTimeout(() => {
    const b = document.createElement('div');
    b.style.cssText = 'background:#3b2a10;padding:18px;border-radius:8px;margin-bottom:10px';
    b.textContent = 'Cookie notice, A/B test variant, or a "you are offline" bar — inserted at the top.';
    stage.prepend(b);
  }, 900);
  sources();
  out.textContent =
    'Note which node the entry blames: the PARAGRAPH moved. The banner did not shift — it appeared.\n\n' +
    'That is the debugging trap. The layout-shift source is the victim, not the cause. Always look\n' +
    'for what was inserted ABOVE the node that moved. In DevTools, the Performance panel\'s\n' +
    '"Layout Shift" markers give you the same information with a screenshot either side, which is\n' +
    'usually faster than reasoning about it.\n\n' +
    'Fixes, in order of preference:\n' +
    '  1. Do not insert above existing content. Overlay it (position: fixed) or put it at the\n' +
    '     bottom. A cookie banner as a fixed bar scores zero.\n' +
    '  2. Reserve the space in the initial HTML (min-height on a wrapper) if it must be inline.\n' +
    '  3. Decide it server-side so it is in the first paint. This is the real fix for A/B tests,\n' +
    '     and the reason client-side experiment scripts wreck CLS.';
});

on('c-ad', () => {
  reset();
  const slot = document.createElement('div');
  slot.style.cssText = 'background:#141420;border-radius:8px;height:0;transition:none';
  slot.textContent = '';
  stage.prepend(slot);
  setTimeout(() => { slot.style.height = '250px'; slot.textContent = 'ad loaded (250px)'; }, 1000);
  sources();
  out.textContent =
    'A slot that grows from 0 to its real size. Ads, embeds, and "related content" widgets all do\n' +
    'this, and third-party slots are the single largest source of CLS on commercial sites.\n\n' +
    'What actually works:\n' +
    '  · Reserve the LARGEST size the slot can return, not the average. An under-reserved slot\n' +
    '    shifts; an over-reserved one only wastes space.\n' +
    '  · If sizes vary, reserve per breakpoint with a min-height, and take the whitespace hit.\n' +
    '  · Never insert a slot above content that has already rendered. Below the fold, and\n' +
    '    pre-reserved.\n' +
    '  · Hold your vendors to it: this is a contract term, not a front-end task.';
});

on('c-font', () => {
  reset();
  stage.insertAdjacentHTML('afterbegin',
    '<h2 class="late-font">A heading rendered in the fallback font, which is about to be replaced ' +
    'by one with different metrics — exactly what a web font arriving late does to a page.</h2>');
  setTimeout(() => stage.querySelector('.late-font').classList.add('swapped'), 1200);
  sources();
  out.textContent =
    'FOUT: the fallback renders, the web font arrives 1.5s later, and every line re-flows because\n' +
    'the two fonts have different metrics.\n\n' +
    'font-display governs WHEN this happens, not whether:\n' +
    '  swap      always shows text, always risks the shift  (best for LCP, worst for CLS)\n' +
    '  block     invisible text for up to 3s, then swaps    (hides FOUT, hurts LCP badly)\n' +
    '  optional  uses the font only if it is nearly instant; otherwise stays on the fallback for\n' +
    '            this page load. ZERO shift, and the font still gets cached for the next\n' +
    '            navigation. Underrated.\n\n' +
    'The real fix is metric matching — make the fallback occupy the same space:\n\n' +
    '  @font-face {\n' +
    '    font-family: "Fallback"; src: local("Arial");\n' +
    '    size-adjust: 107%; ascent-override: 90%; descent-override: 22%; line-gap-override: 0%;\n' +
    '  }\n\n' +
    'Then swap costs nothing, because nothing moves. See asset-optimization lab 04.';
});

on('c-list', () => {
  reset();
  let n = 0;
  const add = () => {
    // Appending BELOW the viewport is free. Prepending, or inserting above the scroll position,
    // is not — which is why "load more" appends and "new messages" prepends carefully.
    stage.insertAdjacentHTML('afterbegin', `<div class="row">prepended row ${++n}</div>`);
    if (n < 6) setTimeout(add, 250);
  };
  setTimeout(add, 500);
  sources();
  out.textContent =
    'Prepending shifts everything below. Appending below the fold does not shift anything visible\n' +
    'and costs nothing.\n\n' +
    'This is why the session-window definition matters: an infinite feed that appended forever\n' +
    'would accumulate an unbounded score under the old total-sum rule, even though nothing ever\n' +
    'jumped. CLS scores the WORST 5-SECOND WINDOW, so a long-lived page is judged on its worst\n' +
    'moment rather than its lifetime.\n\n' +
    'For a chat or feed that must prepend: anchor the scroll (read scrollHeight before, restore\n' +
    'after), or use CSS overflow-anchor, which browsers apply automatically and which you can break\n' +
    'by setting overflow-anchor: none without realising.';
});

on('f-img', () => {
  reset();
  stage.insertAdjacentHTML('afterbegin', '<div class="reserved"></div>');
  const img = new Image();
  img.src = '/api/image.svg?delay=1200&w=620&h=220&label=space+reserved&name=cls2';
  img.style.cssText = 'width:100%;max-width:620px;border-radius:8px';
  img.onload = () => stage.querySelector('.reserved').replaceWith(img);
  sources();
  out.textContent =
    'Identical timing, identical image, CLS ≈ 0. The box was the right shape before the bytes\n' +
    'arrived, so nothing had to move.\n\n' +
    'aspect-ratio is the general form of the width/height attributes, and it works for anything\n' +
    'whose shape you know but whose size you do not: video embeds, maps, charts, skeleton cards.';
});

on('f-banner', () => {
  reset();
  stage.insertAdjacentHTML('afterbegin', '<div id="slot" style="min-height:56px"></div>');
  setTimeout(() => {
    $('#slot').innerHTML = '<div style="background:#12301c;padding:18px;border-radius:8px">' +
      'Same banner, arriving into space that was already reserved.</div>';
  }, 900);
  sources();
  out.textContent =
    'Same insertion, same delay, no shift — because the space existed in the first paint.\n\n' +
    'The cost is honest: you reserve 56px of whitespace on every load, including the loads where\n' +
    'the banner never appears. That trade — a little permanent whitespace against an occasional\n' +
    'jump — is the whole of CLS engineering.';
});

on('f-transform', () => {
  reset();
  const box = document.createElement('div');
  box.style.cssText = 'background:#12301c;padding:18px;border-radius:8px;margin-bottom:10px;' +
    'transform:translateY(-80px);transition:transform .4s';
  box.textContent = 'Animated in with transform — the compositor moves it, layout never changes.';
  stage.prepend(box);
  requestAnimationFrame(() => { box.style.transform = 'translateY(0)'; });
  sources();
  out.textContent =
    'CLS counts changes to an element\'s START POSITION in the layout. transform does not change\n' +
    'layout position — it is applied by the compositor after layout — so a transform animation\n' +
    'contributes nothing to CLS, however dramatic it looks.\n\n' +
    'This is the same fact as the one in critical-rendering-path lab 05, arriving from a different\n' +
    'direction: transform and opacity skip layout and paint. There they made animation cheap; here\n' +
    'they make it invisible to CLS.\n\n' +
    'Animating top/left/width/height does BOTH: janky frames AND layout shift.';
});

on('causes', () => {
  renderTable('#results', [
    { cause: 'images / video / iframes with no dimensions', fix: 'width+height attributes, or aspect-ratio' },
    { cause: 'content injected above existing content', fix: 'reserve space, overlay it, or render it server-side' },
    { cause: 'ad / embed slots that resize', fix: 'reserve the largest size, per breakpoint' },
    { cause: 'web fonts with different metrics', fix: 'size-adjust + ascent-override, or font-display: optional' },
    { cause: 'animating layout properties', fix: 'transform and opacity only' },
    { cause: 'client-side A/B tests and personalisation', fix: 'decide server-side; a flicker-free client swap is not really possible' },
  ], { columns: ['cause', 'fix'] });
  out.textContent =
    'Two things worth internalising about the definition:\n\n' +
    '1. SHIFTS WITHIN 500ms OF AN INPUT DO NOT COUNT (hadRecentInput). Opening an accordion,\n' +
    '   expanding a menu, filtering a list — all free. The metric is about UNEXPECTED movement, so\n' +
    '   you do not have to make your UI static, only predictable.\n' +
    '2. THE SCORE IS impact × distance. Half the viewport moving a little and a small element\n' +
    '   crossing the screen can score the same. A shift at the top of a long page is expensive\n' +
    '   because everything below it moves — which is why the header/banner area deserves the most\n' +
    '   attention.\n\n' +
    'And in the field: send the SOURCE NODE with the beacon (web-vitals attribution gives you\n' +
    'largestShiftTarget). A CLS number with no node is unactionable; with the node it is usually a\n' +
    'ten-minute fix.';
});
