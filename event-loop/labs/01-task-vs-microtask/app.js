// Lab 01 — Task vs microtask.
//
// Nothing here is broken. The lab is a prediction exercise: the log tells you the truth,
// the README asks you to derive it first.

import { $, on, Log } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const SYNC = 'sync', MICRO = 'micro', MACRO = 'macro', RENDER = 'render', IDLE = 'idle';

// ---------------------------------------------------------------------------
// 1. Ordering baseline
//
// Registration order below is deliberately scrambled. Execution order is not.
// ---------------------------------------------------------------------------

function baseline() {
  log.head('— 1. ordering baseline (registration order is scrambled on purpose) —');

  setTimeout(() => log.line('setTimeout(0)', MACRO), 0);

  requestAnimationFrame(() => log.line('requestAnimationFrame', RENDER));

  Promise.resolve().then(() => log.line('Promise.then', MICRO));

  log.line('sync A — top of the function', SYNC);

  queueMicrotask(() => log.line('queueMicrotask', MICRO));

  const ch = new MessageChannel();
  ch.port1.onmessage = () => log.line('MessageChannel onmessage', MACRO);
  ch.port2.postMessage(null);

  requestIdleCallback?.(() => log.line('requestIdleCallback', IDLE));

  // An async IIFE: everything before the first await is synchronous.
  (async () => {
    log.line('sync B — inside async fn, before the first await', SYNC);
    await null;                       // ← this is where the function suspends
    log.line('after await null', MICRO);
  })();

  setTimeout(() => log.line('setTimeout(1)', MACRO), 1);

  log.line('sync C — bottom of the function', SYNC);

  out.textContent =
    'The three sync lines run first because the current task has to finish. Then the microtask\n' +
    'checkpoint drains (Promise.then, queueMicrotask, the await continuation — in registration\n' +
    'order). Only then can a new task be picked, and only then can the browser render.';
}

// ---------------------------------------------------------------------------
// 2. The microtask queue is DRAINED, not stepped
//
// A microtask that queues a microtask extends the same checkpoint. A task that queues a
// task does not — the new task goes to the back of the queue.
// ---------------------------------------------------------------------------

function drain() {
  log.head('— 2. microtask drain: chained microtasks all run before the next task —');

  setTimeout(() => log.line('task 1 (queued first, runs last)', MACRO), 0);

  let depth = 0;
  function chain() {
    log.line(`microtask depth ${++depth}`, MICRO);
    if (depth < 5) queueMicrotask(chain);   // queued DURING the checkpoint
  }
  queueMicrotask(chain);

  log.line('sync — scheduled 1 task and 1 microtask chain', SYNC);

  out.textContent =
    'All five microtasks run before the timer, even though the timer was queued first and the\n' +
    'microtasks 2–5 did not exist yet when the checkpoint started. The checkpoint runs until the\n' +
    'queue is EMPTY. Lab 02 is what happens when it never empties.';
}

// ---------------------------------------------------------------------------
// 3. Microtasks run BETWEEN rAF callbacks
//
// "Run the animation frame callbacks" is a list of callbacks, and a microtask checkpoint
// happens after each one (the JS stack empties between them). So a promise resolved inside
// rAF callback #1 runs before rAF callback #2 — all inside the same frame.
// ---------------------------------------------------------------------------

function rafInterleave() {
  log.head('— 3. microtask checkpoints between rAF callbacks (all in ONE frame) —');

  for (const n of [1, 2, 3]) {
    requestAnimationFrame(() => {
      log.line(`rAF callback ${n}`, RENDER);
      queueMicrotask(() => log.line(`  microtask queued by rAF ${n}`, MICRO));
    });
  }

  requestAnimationFrame(() => {
    // A second rAF registered from inside the frame runs in the NEXT frame, never this one.
    requestAnimationFrame(() => log.line('rAF registered inside a rAF → next frame', RENDER));
  });

  out.textContent =
    'Order: rAF1, its microtask, rAF2, its microtask, rAF3, its microtask — then style/layout/paint.\n' +
    'Consequence: awaiting inside a rAF callback does NOT push you to the next frame, it pushes you\n' +
    'to a point still inside this frame, before layout. That is a great place to be — and an easy\n' +
    'place to accidentally force a synchronous layout.';
}

// ---------------------------------------------------------------------------
// 4. Which observers are microtasks?
//
// MutationObserver  -> microtask. Runs at the checkpoint, before rendering.
// IntersectionObserver / ResizeObserver -> render steps, once per frame.
// ---------------------------------------------------------------------------

const target = $('target');

function observers() {
  log.head('— 4. observer callbacks: which queue does each land in? —');

  const mo = new MutationObserver(() => {
    log.line('MutationObserver callback  ← MICROTASK', MICRO);
    mo.disconnect();
  });
  mo.observe(target, { attributes: true });

  const ro = new ResizeObserver(() => {
    log.line('ResizeObserver callback  ← render step, after rAF', RENDER);
    ro.disconnect();
  });
  ro.observe(target);

  const io = new IntersectionObserver(() => {
    log.line('IntersectionObserver callback  ← render step, before rAF', RENDER);
    io.disconnect();
  });
  io.observe(target);

  setTimeout(() => log.line('setTimeout(0)', MACRO), 0);
  Promise.resolve().then(() => log.line('Promise.then', MICRO));
  requestAnimationFrame(() => log.line('requestAnimationFrame', RENDER));

  // Trigger the mutation + a resize, synchronously.
  target.setAttribute('data-tick', String(Date.now()));
  target.style.paddingBottom = target.style.paddingBottom === '20px' ? '4px' : '20px';

  log.line('sync — mutated the target', SYNC);

  out.textContent =
    'MutationObserver batches its records and delivers them as a microtask, so it runs before the\n' +
    'browser can render — which means a MutationObserver callback that does layout work delays the\n' +
    'very frame it was reacting to. Intersection/Resize observers are part of "update the rendering"\n' +
    'and are capped at once per frame; they cannot starve the loop the same way.';
}

// ---------------------------------------------------------------------------
// 5. Nesting: what "later" means for each queue
// ---------------------------------------------------------------------------

function nesting() {
  log.head('— 5. nesting —');

  setTimeout(() => {
    log.line('task A', MACRO);
    setTimeout(() => log.line('  task A → task (waits for the NEXT loop turn)', MACRO), 0);
    queueMicrotask(() => log.line('  task A → microtask (runs before task B)', MICRO));
  }, 0);

  setTimeout(() => log.line('task B', MACRO), 0);

  Promise.resolve().then(() => {
    log.line('microtask X', MICRO);
    Promise.resolve().then(() => log.line('  microtask X → microtask (same checkpoint)', MICRO));
    setTimeout(() => log.line('  microtask X → task (after every microtask)', MACRO), 0);
  });

  out.textContent =
    'The rule: microtasks queued from anywhere run at the end of the CURRENT task. Tasks queued\n' +
    'from anywhere run after every task already in the queue. "Later" means two very different\n' +
    'amounts of later.';
}

// ---------------------------------------------------------------------------
// 6. Task sources race
//
// Different task sources are different queues, and the browser picks between them. Do not
// build ordering guarantees on this — but do know the shape.
// ---------------------------------------------------------------------------

function sources() {
  log.head('— 6. task sources: setTimeout vs MessageChannel vs fetch vs event —');

  setTimeout(() => log.line('setTimeout(0)   [timer queue]', MACRO), 0);

  const ch = new MessageChannel();
  ch.port1.onmessage = () => log.line('MessageChannel   [postMessage queue, no clamp]', MACRO);
  ch.port2.postMessage(null);

  window.addEventListener('lab:ping', () => log.line('dispatchEvent listener   [SYNCHRONOUS!]', SYNC), { once: true });

  fetch('/api/asset?name=race&type=json&cache=0')
    .then((r) => r.json())
    .then(() => log.line('fetch().then   [network task, then a microtask]', MACRO));

  window.postMessage('lab', '*');
  window.addEventListener('message', function handler(e) {
    if (e.data !== 'lab') return;
    window.removeEventListener('message', handler);
    log.line('window.postMessage   [postMessage queue]', MACRO);
  });

  window.dispatchEvent(new Event('lab:ping'));

  log.line('sync — everything above is scheduled', SYNC);

  out.textContent =
    'Two things to take away. (1) dispatchEvent is synchronous — a custom "event bus" gives you no\n' +
    'yielding at all, it is just a function call with extra steps. (2) MessageChannel is the classic\n' +
    'zero-delay task primitive precisely because it dodges the timer clamp (Lab 05); React used it\n' +
    'for exactly this reason.';
}

// ---------------------------------------------------------------------------

on('baseline', () => { log.clear(); baseline(); });
on('drain', () => { log.clear(); drain(); });
on('raf', () => { log.clear(); rafInterleave(); });
on('observers', () => { log.clear(); observers(); });
on('nesting', () => { log.clear(); nesting(); });
on('sources', () => { log.clear(); sources(); });
on('clear', () => { log.clear(); out.textContent = 'Pick a demo.'; });
