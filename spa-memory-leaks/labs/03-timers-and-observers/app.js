// Lab 03 — Timers & observers.

import { $, on, Log, renderTable, fmt, sleep } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const rows = [];

const counters = { intervalTicks: 0, observerCalls: 0, rafFrames: 0, pendingPromises: 0, fetches: 0 };
const handles = { intervals: [], observers: [], rafs: [], controllers: [] };

const n = () => Number($('n').value);

function makeTarget(i) {
  const el = document.createElement('div');
  el.textContent = `target ${i}`;
  $('#targets').append(el);
  return el;
}

/**
 * Every variant builds the same component: some state, a timer, three observers, a rAF loop
 * and a pending promise. Only the cleanup differs.
 */
function mountComponent(i, { signal } = {}) {
  const state = { rows: Array.from({ length: 1000 }, (_, k) => `row ${k} of component ${i}`) };
  const el = makeTarget(i);

  // --- interval ------------------------------------------------------------
  const timer = setInterval(() => {
    counters.intervalTicks++;
    state.rows.length;                    // touch the state so the closure retains it
  }, 250);
  handles.intervals.push(timer);
  signal?.addEventListener('abort', () => clearInterval(timer), { once: true });

  // --- observers -----------------------------------------------------------
  const io = new IntersectionObserver(() => { counters.observerCalls++; state.rows.length; });
  io.observe(el);
  const ro = new ResizeObserver(() => { counters.observerCalls++; state.rows.length; });
  ro.observe(el);
  const mo = new MutationObserver(() => { counters.observerCalls++; state.rows.length; });
  mo.observe(el, { attributes: true });
  handles.observers.push(io, ro, mo);
  signal?.addEventListener('abort', () => { io.disconnect(); ro.disconnect(); mo.disconnect(); }, { once: true });

  // --- rAF loop ------------------------------------------------------------
  let alive = true;
  const step = () => {
    if (!alive) return;
    counters.rafFrames++;
    state.rows.length;
    handles.rafs.push(requestAnimationFrame(step));
  };
  requestAnimationFrame(step);
  signal?.addEventListener('abort', () => { alive = false; }, { once: true });

  // --- a promise that never settles ---------------------------------------
  // The classic: an await on something that will never resolve. The continuation — and
  // everything in its scope — is retained until the promise settles, which is never.
  counters.pendingPromises++;
  new Promise((resolve) => {
    signal?.addEventListener('abort', () => { counters.pendingPromises--; resolve(); }, { once: true });
  }).then(() => state.rows.length);

  return { el, state };
}

// ---------------------------------------------------------------------------

async function run(mode, cleanup) {
  log.head(`— ${mode} × ${n()} —`);
  const before = { ...counters };
  for (let i = 0; i < n(); i++) {
    const controller = new AbortController();
    const c = mountComponent(i, cleanup ? { signal: controller.signal } : {});
    await sleep(0);
    c.el.remove();                        // "unmount"
    if (cleanup) { controller.abort(); handles.controllers.push(controller); }
  }
  await sleep(1200);                      // let the timers tick for a second

  const delta = {
    'interval ticks': counters.intervalTicks - before.intervalTicks,
    'observer calls': counters.observerCalls - before.observerCalls,
    'rAF frames': counters.rafFrames - before.rafFrames,
    'pending promises': counters.pendingPromises,
  };
  rows.push({
    run: mode,
    ...delta,
    'JS heap': performance.memory ? fmt.bytes(performance.memory.usedJSHeapSize) : 'n/a',
  });
  renderTable('#results', rows, {
    columns: ['run', 'interval ticks', 'observer calls', 'rAF frames', 'pending promises', 'JS heap'],
  });
  log.line(`${mode}: ${delta['interval ticks']} ticks, ${delta['rAF frames']} frames, ` +
    `${delta['pending promises']} pending promises in 1.2s after unmount`,
    delta['interval ticks'] > n() ? 'bad' : 'good');
}

on('interval', () => run('A. setInterval, never cleared', false).then(() => {
  out.textContent =
    `${n()} components are gone from the DOM and their intervals are still firing, four times a\n` +
    'second, each one touching 1,000 rows of state that can never be freed.\n\n' +
    'The version of this that reaches production: a poll.\n\n' +
    '    setInterval(() => fetch(`/api/notifications`).then(render), 5000);\n\n' +
    'Navigate ten times and you have ten pollers. Your API sees ten times the traffic from one\n' +
    'user, the last nine render into detached DOM, and the first symptom is usually a backend\n' +
    'graph, not a frontend one.\n\n' +
    'Also worth knowing: a pending setTimeout keeps its callback (and closure) alive until it\n' +
    'fires. A setTimeout of an hour retains its scope for an hour.';
}));

on('observers', () => run('B. observers, never disconnected', false).then(() => {
  out.textContent =
    'IntersectionObserver, ResizeObserver and MutationObserver each hold strong references to\n' +
    'their callback and to the elements they observe.\n\n' +
    'The subtlety: the OBSERVER holds the target, and the callback holds your component. So an\n' +
    'observer you never disconnect keeps a detached element alive AND is called on every\n' +
    'relevant frame — ResizeObserver in particular fires during the rendering steps, so a\n' +
    'hundred stale observers is a hundred callbacks inside every frame that resizes anything.\n\n' +
    'disconnect() in the same place you would remove a listener. Or take a signal, like demo E.';
}));

on('raf', () => run('C. rAF loop with no stop condition', false).then(() => {
  out.textContent =
    'A requestAnimationFrame loop that re-registers itself runs until the page closes. Each of\n' +
    'these components has its own, so N unmounted components mean N callbacks per frame — and\n' +
    'the frame budget is 16.7ms for all of them.\n\n' +
    'Every rAF loop needs a stop condition that is checked INSIDE the callback, and something\n' +
    'that sets it on unmount. A cancelAnimationFrame(handle) alone is not enough if the callback\n' +
    'has already scheduled the next one — hence the `alive` flag.\n\n' +
    'Bonus: rAF does not run in a background tab, so this leak hides while you are not looking.';
}));

on('promise', () => run('D. a promise that never settles', false).then(() => {
  out.textContent =
    'A promise that never settles retains its continuation — and everything the continuation\n' +
    'closes over — forever.\n\n' +
    'The realistic shapes:\n' +
    '  • await on a fetch that was never aborted after the component unmounted\n' +
    '  • an event-based promise (`new Promise(r => emitter.once("done", r))`) where the event\n' +
    '    never arrives\n' +
    '  • a queue whose consumer stopped, so every producer promise is pending\n\n' +
    'These do not show up in a listener audit or a timer audit. In a heap snapshot look for\n' +
    'objects retained by a "Promise" or by "async function context". The fix is the same signal:\n' +
    'either abort the underlying operation, or reject on abort so the continuation can be freed.';
}));

on('clean', () => run('E. everything, one AbortSignal', true).then(() => {
  out.textContent =
    'Same component, same four hazards, one AbortController. After abort(): zero ticks, zero\n' +
    'observer calls, zero extra frames, zero pending promises.\n\n' +
    'The pattern to standardise on:\n\n' +
    '    function mount(el) {\n' +
    '      const ac = new AbortController();\n' +
    '      const { signal } = ac;\n' +
    '      addEventListener("resize", onResize, { signal });\n' +
    '      const id = setInterval(tick, 1000);\n' +
    '      signal.addEventListener("abort", () => clearInterval(id), { once: true });\n' +
    '      const io = new IntersectionObserver(cb);\n' +
    '      signal.addEventListener("abort", () => io.disconnect(), { once: true });\n' +
    '      fetch(url, { signal });\n' +
    '      return () => ac.abort();          // one cleanup function, always correct\n' +
    '    }\n\n' +
    'Better still, wrap it once: an `onCleanup(fn)` helper per component so nobody has to\n' +
    'remember the abort-listener dance. Lab 05 builds that into a component lifecycle.';
}));

on('measure', () => {
  log.line(`ticks=${counters.intervalTicks} observers=${counters.observerCalls} ` +
    `rAF=${counters.rafFrames} pending=${counters.pendingPromises}`, 'macro');
});

on('stopAll', () => {
  for (const t of handles.intervals) clearInterval(t);
  for (const o of handles.observers) o.disconnect();
  for (const r of handles.rafs) cancelAnimationFrame(r);
  for (const c of handles.controllers) c.abort();
  handles.intervals.length = handles.observers.length = handles.rafs.length = 0;
  log.ok('stopped everything (the rAF loops keep going until their `alive` flag flips — which is ' +
    'the point of demo C)');
});

on('clear', () => { log.clear(); rows.length = 0; renderTable('#results', rows); });
