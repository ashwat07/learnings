// Lab 03 — Animating the wrong property.
// leftJs and leftCss are implemented. The rest are yours.

PerfHUD.start();

const track = document.getElementById('track');
const out = document.getElementById('out');
const strategySelect = document.getElementById('strategy');

const DISTANCE = 300;   // px of travel — keep this identical across every strategy
const PERIOD = 1200;    // ms for a full there-and-back

let runners = [];
let stop = () => {};

function build(n) {
  track.textContent = '';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const r = document.createElement('div');
    r.className = 'runner';
    r.style.top = (i * 12) % (track.clientHeight - 12) + 'px';
    frag.appendChild(r);
  }
  track.appendChild(frag);
  runners = [...track.children];
  report(`built ${n} runners`);
}

function report(msg) { out.textContent = msg; }

/** 0 → 1 → 0 triangle wave, so every strategy travels the same path. */
function progress(t) {
  const phase = (t % PERIOD) / PERIOD;
  return phase < 0.5 ? phase * 2 : (1 - phase) * 2;
}

function rafLoop(perFrame) {
  let id = requestAnimationFrame(function frame(t) {
    perFrame(progress(t) * DISTANCE);
    id = requestAnimationFrame(frame);
  });
  return () => cancelAnimationFrame(id);
}

function clearStyles() {
  runners.forEach(r => {
    r.style.left = '';
    r.style.marginLeft = '';
    r.style.transform = '';
    r.className = 'runner';
  });
}

// ---------------------------------------------------------------------------
// 1. BROKEN — write `left` every frame. Style + Layout + Paint + Composite, per frame.
// ---------------------------------------------------------------------------
function leftJs() {
  return rafLoop(x => {
    for (const r of runners) r.style.left = x + 'px';
  });
}

// ---------------------------------------------------------------------------
// 2. Provided — the same property, but animated by CSS.
//    Predict the trace before you record it. Most people guess wrong.
// ---------------------------------------------------------------------------
function leftCss() {
  runners.forEach(r => r.classList.add('css-left'));
  return () => runners.forEach(r => r.classList.remove('css-left'));
}

// ---------------------------------------------------------------------------
// 3. TODO — margin-left, via rAF.
//    Write your prediction here BEFORE implementing:
//    prediction: ______________________________________________
//    Then implement, measure, and note whether you were right and why.
// ---------------------------------------------------------------------------
function marginLeft() {
  throw new Error('TODO: marginLeft() — and write your prediction in the comment first');
}

// ---------------------------------------------------------------------------
// 4. TODO — transform, via rAF.
//    Identical motion, composite-only property. Note which trace entries disappear.
// ---------------------------------------------------------------------------
function transformJs() {
  throw new Error('TODO: transformJs() — translateX via rAF');
}

// ---------------------------------------------------------------------------
// 5. TODO — transform, via CSS.
//    No rAF at all: add a class, let the compositor run it. Define the @keyframes in
//    index.html. Verify in the Animations panel that it reports as composited.
// ---------------------------------------------------------------------------
function transformCss() {
  throw new Error('TODO: transformCss() — add .css-transform and define the keyframes');
}

// ---------------------------------------------------------------------------
// FLIP — TODO.
//    Reorder the runners (a real layout change: reverse them with flex order or DOM order),
//    but animate the movement with transforms only.
//    First → Last → Invert → Play. Exactly two forced layouts for the whole batch,
//    not two per element.
// ---------------------------------------------------------------------------
function flipDemo() {
  throw new Error('TODO: flipDemo() — measure First, mutate, measure Last, invert, play');
}

// ---------------------------------------------------------------------------

const strategies = { leftJs, leftCss, marginLeft, transformJs, transformCss };

function activate(name) {
  stop();
  stop = () => {};
  clearStyles();
  PerfHUD.reset();
  if (name === 'off') return report('stopped');
  try {
    stop = strategies[name]() || (() => {});
    report(`strategy: ${name}\ntravel: ${DISTANCE}px over ${PERIOD}ms, ${runners.length} runners`);
  } catch (err) {
    report(`strategy: ${name}\n  ${err.message}`);
    console.warn(err);
  }
}

document.getElementById('block').addEventListener('click', () => {
  report('blocking main thread for 2000ms — watch whether the animation survives');
  requestAnimationFrame(() => {
    const t = performance.now();
    while (performance.now() - t < 2000) { /* deliberately blocking */ }
    report('unblocked. Did the motion continue, or freeze and jump?');
  });
});

document.getElementById('flip').addEventListener('click', () => {
  try { flipDemo(); } catch (err) { report(err.message); console.warn(err); }
});

strategySelect.addEventListener('change', () => activate(strategySelect.value));
document.getElementById('rebuild').addEventListener('click', () => {
  build(+document.getElementById('count').value);
  activate(strategySelect.value);
});
document.getElementById('reset').addEventListener('click', () => { PerfHUD.reset(); report('reset'); });

build(+document.getElementById('count').value);
activate('leftJs');
