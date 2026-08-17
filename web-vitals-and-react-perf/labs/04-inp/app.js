// Lab 04 — INP: three phases, three different fixes.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';
import { vitals, onVitals, vitalsHud, rate } from '/shared/vitals.js';

const log = new Log('#log');
const out = $('out');
vitalsHud();

const grid = $('#grid');
const build = (n) => {
  grid.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.textContent = `cell ${i}`;
    grid.append(d);
  }
};
build(200);
on('reset', () => build(200));

const burn = (ms) => { const end = performance.now() + ms; let x = 0; while (performance.now() < end) x += Math.sqrt(x + 1); return x; };

// ---------------------------------------------------------------------------
// 1. INPUT DELAY — the main thread is already busy when the click lands.
// ---------------------------------------------------------------------------
on('t-delay', () => {
  log.head('scheduling a 400ms task, then click the button again DURING it');
  out.textContent =
    'A 400ms task starts in 300ms. Click any button while it runs.\n\n' +
    'Your handler will be fast, and INP will still be terrible — because the browser could not\n' +
    'START it. That gap is INPUT DELAY, and no amount of optimising your click handler removes it.';
  setTimeout(() => { log.muted('long task running…'); burn(400); log.muted('long task done'); }, 300);
});

// ---------------------------------------------------------------------------
// 2. PROCESSING — the handler itself is slow.
// ---------------------------------------------------------------------------
on('t-processing', () => { burn(250); log.bad('handler burned 250ms of main thread'); });

// ---------------------------------------------------------------------------
// 3. PRESENTATION — the handler is quick, the resulting render is not.
// ---------------------------------------------------------------------------
on('t-presentation', () => {
  // Cheap in JS, expensive in style/layout/paint: 5,000 nodes with a class change each.
  build(5000);
  for (const el of grid.children) el.classList.add('on');
  log.bad('handler was fast; the browser now has 5,000 nodes to style, lay out and paint');
});

// ---------------------------------------------------------------------------
// The fixes.
// ---------------------------------------------------------------------------

on('f-yield', async () => {
  // Paint the visible response FIRST, then do the rest. INP stops counting at the next paint,
  // so the work after the yield is off the metric — and, more importantly, off the user's wait.
  $('#grid').firstChild.textContent = 'responded';
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  burn(250);
  log.ok('painted first, then did the 250ms of work');
});

on('f-defer', () => {
  // The visible update is immediate; the expensive bookkeeping happens when the browser is idle.
  $('#grid').firstChild.textContent = 'responded';
  (window.requestIdleCallback ?? setTimeout)(() => { burn(250); log.muted('deferred work done'); }, { timeout: 1000 });
  log.ok('handler returned in <1ms; the work runs at idle');
});

on('f-less', () => {
  // Same visual outcome, 200 nodes instead of 5,000, and one class on a parent instead of 5,000
  // individual mutations.
  build(200);
  grid.classList.add('on');
  log.ok('same effect, 25× fewer nodes, one style invalidation instead of 5,000');
});

onVitals((v) => {
  renderTable('#results', v.interactions.slice(0, 6).map((i) => ({
    target: i.target,
    total: `${Math.round(i.duration)}ms`,
    inputDelay: `${Math.round(i.inputDelay)}ms`,
    processing: `${Math.round(i.processing)}ms`,
    presentation: `${Math.round(i.presentation)}ms`,
    _totalClass: i.duration > 500 ? 'no' : i.duration > 200 ? 'meh' : 'ok',
  })), { columns: ['target', 'total', 'inputDelay', 'processing', 'presentation'] });
});

on('phases', () => {
  renderTable('#results', [
    { phase: 'input delay', means: 'the thread was busy when the user touched the screen', fix: 'break up long tasks, defer third-party scripts, hydrate less, use scheduler.yield()' },
    { phase: 'processing', means: 'your handlers ran long', fix: 'do less; move computation to a worker; debounce; do not re-run framework work per keystroke' },
    { phase: 'presentation', means: 'style, layout, paint and composite after your handler', fix: 'smaller DOM, content-visibility, avoid forced reflow, do not touch 5,000 nodes' },
  ], { columns: ['phase', 'means', 'fix'] });

  out.textContent =
    'THE RULE THAT MATTERS MOST: PAINT SOMETHING FIRST, THEN DO THE WORK.\n\n' +
    'INP stops counting at the next paint after the interaction. So:\n\n' +
    '  el.textContent = "Saving…";              // the user sees a response\n' +
    '  await new Promise(r => requestAnimationFrame(() => setTimeout(r)));   // let it paint\n' +
    '  await doTheExpensiveThing();             // now this is not in the INP window\n\n' +
    'This is not gaming the metric. The metric was designed around the perceptual fact that a\n' +
    'visible acknowledgement within ~200ms is what makes an interface feel responsive; what happens\n' +
    'after it is a separate problem with a separate budget.\n\n' +
    'The modern primitive is scheduler.yield() — it yields to the browser but keeps your\n' +
    'continuation at the FRONT of the queue, unlike setTimeout(0), which puts you behind every task\n' +
    'that arrived in the meantime. See event-loop lab 05.\n\n' +
    'Framework-specific notes:\n' +
    '  React     startTransition marks an update as interruptible so typing stays responsive; the\n' +
    '            urgent part (the input value) paints immediately. useDeferredValue is the same\n' +
    '            idea expressed as a value. Lab 05.\n' +
    '  Any       a controlled input that triggers a re-render of a 500-row list on every keystroke\n' +
    '            is the single most common INP bug in the ecosystem.\n\n' +
    'And the diagnosis order, because it saves hours: check INPUT DELAY first. If it is large, your\n' +
    'handler is irrelevant — something else owns the thread, and it is usually hydration or a\n' +
    'third-party tag.';
});
