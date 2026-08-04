// Lab 06 — Expensive CSS.
// Nothing here is "broken code to fix" — the lab IS the experiment. Your job is the
// ablation study and the cost table. See the TODOs at the bottom for the fix work.

PerfHUD.start();

const cardsEl = document.getElementById('cards');
const out = document.getElementById('out');
const root = document.documentElement;

function build(n) {
  cardsEl.textContent = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const card = document.createElement('div');
    card.className = 'card';
    card.textContent = `card ${i} — some text so glyph rasterization is in the mix too`;
    frag.appendChild(card);
  }
  cardsEl.appendChild(frag);
  report();
}

function activeEffects() {
  return [...root.classList].filter(c => c.startsWith('fx-'));
}

function report(extra = '') {
  const fx = activeEffects();
  out.textContent =
    `active effects (${fx.length}): ${fx.length ? fx.join(', ') : 'none — this is your baseline'}\n` +
    `cards: ${cardsEl.children.length}   FPS: ${PerfHUD.stats.fps}   worst frame: ${PerfHUD.stats.worstEver.toFixed(1)}ms\n` +
    `${extra}`;
}
setInterval(() => report(), 500);

document.getElementById('fx').addEventListener('click', e => {
  const btn = e.target.closest('button[data-fx]');
  if (!btn) return;
  const on = root.classList.toggle(btn.dataset.fx);
  btn.setAttribute('aria-pressed', String(on));
  PerfHUD.reset();
  report('changed effects — reset the HUD and re-scroll before reading numbers');
});

document.getElementById('all').addEventListener('click', () => {
  document.querySelectorAll('#fx button[data-fx]').forEach(b => {
    root.classList.add(b.dataset.fx);
    b.setAttribute('aria-pressed', 'true');
  });
  PerfHUD.reset();
});

document.getElementById('none').addEventListener('click', () => {
  document.querySelectorAll('#fx button[data-fx]').forEach(b => {
    root.classList.remove(b.dataset.fx);
    b.setAttribute('aria-pressed', 'false');
  });
  PerfHUD.reset();
});

/** Repeatable scroll, so your numbers compare across runs instead of across wrists. */
document.getElementById('autoscroll').addEventListener('click', () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  const t0 = performance.now();
  PerfHUD.reset();
  (function step() {
    const p = (performance.now() - t0) / 3000;
    if (p >= 1) { report('scroll done — read Paint total from the trace'); return; }
    scrollTo(0, max * (p < 0.5 ? p * 2 : (1 - p) * 2));
    requestAnimationFrame(step);
  })();
});

/** A composited animation, so you can separate "expensive to paint once" from
 *  "expensive to paint every frame". */
let animating = false, animId = 0;
document.getElementById('animate').addEventListener('click', e => {
  animating = !animating;
  e.target.setAttribute('aria-pressed', String(animating));
  PerfHUD.reset();
  if (!animating) {
    cancelAnimationFrame(animId);
    [...cardsEl.children].forEach(c => { c.style.transform = ''; });
    return;
  }
  const cards = [...cardsEl.children];
  (function frame(t) {
    for (let i = 0; i < cards.length; i++) {
      cards[i].style.transform = `translateY(${Math.sin(t / 400 + i) * 6}px)`;
    }
    animId = requestAnimationFrame(frame);
  })(performance.now());
});

document.getElementById('rebuild').addEventListener('click', () => build(+document.getElementById('count').value));
document.getElementById('reset').addEventListener('click', () => { PerfHUD.reset(); report('reset'); });

build(+document.getElementById('count').value);

// ---------------------------------------------------------------------------
// TODO — the fix work. Each of these is a code change in this file or index.html.
//
// 1. PROMOTION. Add `.promoted .card { will-change: transform; }` to index.html and a
//    toggle here. Measure "shadow lg + animate" with and without it.
//    Then open the Layers panel and write down the GPU memory both ways.
//      finding: ______________________________________
//
// 2. FAKE THE SHADOW. Replace .fx-shadow-l with one of:
//      · a 9-slice border-image
//      · a single shared shadow element positioned behind each card
//      · a data-URI PNG background
//    Implement at least one, measure it, and judge whether it looks close enough.
//      cost before: ______  after: ______  visually acceptable? ______
//
// 3. CHEAPEN THE BLUR. Take .fx-blur from blur(24px) on a full-size pseudo-element to a
//    small element blurred by 6px and scaled up 4×. Measure both.
//      cost before: ______  after: ______
//
// 4. KILL THE BACKDROP-FILTER. Two alternatives, measured, with a screenshot comparison.
//
// 5. VISIBLE-ONLY DECORATION. Use IntersectionObserver to apply .fx-shadow-l only to cards
//    near the viewport. Measure. Then decide whether you'd ship it, and why.
//
// 6. Write your cost table into README.md. That table is the artefact you keep.
// ---------------------------------------------------------------------------
