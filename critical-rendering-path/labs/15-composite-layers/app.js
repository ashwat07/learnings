// Lab 15 — Composite layers.
// Everything here is a control panel for experiments. The measurements come from the
// Layers panel and Rendering → Frame rendering stats, not from this file — there is no web
// API that reports layer count, which is itself worth knowing.

PerfHUD.start();

const cardsEl = document.getElementById('cards');
const overlap = document.getElementById('overlap');
const out = document.getElementById('out');
const root = document.documentElement;

let cards = [];

function build(n) {
  [...cardsEl.querySelectorAll('.card')].forEach(c => c.remove());
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div class="title">card ${i}</div>` +
      `<div>text that has to be rasterized — watch what a scale animation does to it</div>`;
    frag.appendChild(card);
  }
  cardsEl.appendChild(frag);
  cards = [...cardsEl.querySelectorAll('.card')];
  // The "promote-one" strategy needs exactly one card marked.
  cards[0]?.classList.add('animating');
  report();
}

/**
 * The browser exposes no layer count to JS, so this is an ESTIMATE based on what the
 * current strategy is likely to promote. Use it to reason about magnitude; use the Layers
 * panel for the truth. (When your estimate and the panel disagree — and they will, because
 * of overlap promotion — the panel is right and the gap is the interesting part.)
 */
function estimate() {
  const dpr = devicePixelRatio;
  const strategy = document.getElementById('promotion').value;
  const anim = document.getElementById('animation').value;
  const promoted =
    strategy === 'promote-all' || strategy === 'promote-translatez' ? cards.length
    : strategy === 'promote-one' ? 1
    : anim === 'anim-transform' || anim === 'anim-scale' ? cards.length   // animation-driven promotion
    : 0;

  const sample = cards[0]?.getBoundingClientRect();
  const perLayer = sample ? sample.width * sample.height * dpr * dpr * 4 : 0;
  const total = promoted * perLayer;

  return {
    promoted,
    perLayerMB: perLayer / 1048576,
    totalMB: total / 1048576,
    dpr,
    cardSize: sample ? `${Math.round(sample.width)}×${Math.round(sample.height)}` : '?',
  };
}

function report(extra = '') {
  const e = estimate();
  out.textContent = [
    `cards: ${cards.length}   promotion: ${document.getElementById('promotion').value || 'none'}   ` +
      `animation: ${document.getElementById('animation').value || 'none'}   ` +
      `overlap: ${root.classList.contains('explode') ? 'on' : 'off'}`,
    '',
    `FPS: ${PerfHUD.stats.fps}   worst frame: ${PerfHUD.stats.worstEver.toFixed(1)}ms   ` +
      `long tasks: ${PerfHUD.stats.longTasks}`,
    '',
    `estimated promoted layers: ${e.promoted}`,
    `card size ${e.cardSize} at DPR ${e.dpr} → ${e.perLayerMB.toFixed(2)} MB per layer`,
    `estimated GPU memory: ${e.totalMB.toFixed(1)} MB` +
      (e.totalMB > 250 ? '   ← this is a lot. Check the Layers panel and Task Manager.' : ''),
    '',
    'Compare against: Rendering → Frame rendering stats (GPU memory), and the Layers panel.',
    'Where the panel shows MORE layers than estimated, ask why — overlap promotion is the usual answer.',
    extra ? `\n${extra}` : '',
  ].join('\n');
}
setInterval(() => report(), 500);

document.getElementById('promotion').addEventListener('change', e => {
  root.classList.remove('promote-all', 'promote-translatez', 'promote-one');
  if (e.target.value) root.classList.add(e.target.value);
  PerfHUD.reset();
  report('strategy changed — the Layers panel updates live. Read the compositing reasons.');
});

document.getElementById('animation').addEventListener('change', e => {
  root.classList.remove('anim-transform', 'anim-left', 'anim-scale');
  if (e.target.value) root.classList.add(e.target.value);
  PerfHUD.reset();
  report(e.target.value === 'anim-scale'
    ? 'scale animation on — look closely at the TEXT mid-animation. Why is it soft?'
    : 'animation changed — now press "block main thread" and see which one survives.');
});

document.getElementById('explode').addEventListener('change', e => {
  root.classList.toggle('explode', e.target.checked);
  report(e.target.checked
    ? 'overlap on — count layers in the Layers panel now, and read the reason on the overlap element.'
    : 'overlap off');
});

document.getElementById('block').addEventListener('click', () => {
  report('blocking the main thread for 2000ms…');
  requestAnimationFrame(() => {
    const t = performance.now();
    while (performance.now() - t < 2000) { /* deliberately blocking */ }
    report('unblocked. Did the animation keep moving, or freeze and jump? ' +
      'That answer is the difference between composited and not.');
  });
});

/**
 * The subtle one: a composited animation is off-thread, but if JS forces layout every frame,
 * the compositor has to wait for the main thread. This button proves that a "composited"
 * animation is not immune to your own bad code.
 */
let readLoopId = 0, reading = false;
document.getElementById('readLoop').addEventListener('click', e => {
  reading = !reading;
  e.target.setAttribute('aria-pressed', String(reading));
  if (!reading) { cancelAnimationFrame(readLoopId); report('read loop off'); return; }
  PerfHUD.reset();
  (function frame() {
    for (const c of cards) {
      c.style.setProperty('--noop', '1');   // dirty the tree…
      void c.getBoundingClientRect();       // …then force a flush. Every frame.
    }
    readLoopId = requestAnimationFrame(frame);
  })();
  report('read loop ON — a transform animation is composited, but watch what this does to it.');
});

document.getElementById('estimate').addEventListener('click', () => {
  const e = estimate();
  console.table(e);
  report('estimate printed to the console. Now compare with the Layers panel — where do they ' +
    'disagree, and why?');
});

document.getElementById('rebuild').addEventListener('click', () => build(+document.getElementById('count').value));
document.getElementById('reset').addEventListener('click', () => { PerfHUD.reset(); report('reset'); });

build(+document.getElementById('count').value);

// ---------------------------------------------------------------------------
// TODO — the fix work (see README for the full list):
//
// [ ] Promote on demand: add will-change on pointerenter / animation start, remove it on
//     animationend. Measure GPU memory at rest vs during animation.
//     at rest: ______ MB   during: ______ MB
//
// [ ] Then test whether will-change bought anything at all: remove it and let the CSS
//     animation promote on its own. Measure the FIRST frame of the animation specifically —
//     that's where will-change earns its keep, if it does.
//     first frame without will-change: ______ms   with: ______ms
//
// [ ] Fix the layer explosion so only the intended element is promoted. What worked?
//     ____________________________________________
//
// [ ] Fix the blurry scaled text (wrapper scale + counter-scale, or accept layout cost).
//
// [ ] Write your budget: max promoted layers ______, max GPU memory ______ MB,
//     justified by: ____________________________________________
// ---------------------------------------------------------------------------
