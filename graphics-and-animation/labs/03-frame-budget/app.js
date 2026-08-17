// Lab 03 — Frame budget.

import { $, on, Log, renderTable } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const bar = $('#bar');

let raf = null, mode = null;
let deltas = [];
let dropped = 0;
let budget = 16.7;

// Estimate the display refresh rate from the first second of frames.
(function detectHz() {
  const marks = [];
  const probe = (t) => {
    marks.push(t);
    if (marks.length < 60) return requestAnimationFrame(probe);
    const avg = (marks.at(-1) - marks[0]) / (marks.length - 1);
    const hz = Math.round(1000 / avg);
    budget = 1000 / hz;
    $('hz').textContent = `${hz}Hz (${budget.toFixed(1)}ms/frame)`;
    log.muted(`display appears to run at ~${hz}Hz — your budget is ${budget.toFixed(1)}ms`);
  };
  requestAnimationFrame(probe);
})();

const burn = (ms) => { const end = performance.now() + ms; let x = 0; while (performance.now() < end) x += Math.sqrt(x + 1); return x; };

function paintBars() {
  bar.textContent = '';
  for (const d of deltas.slice(-120)) {
    const el = document.createElement('div');
    el.style.height = `${Math.min(60, (d / budget) * 20)}px`;
    el.className = d > budget * 2 ? 'bad' : d > budget * 1.2 ? 'slow' : '';
    bar.append(el);
  }
  const sorted = [...deltas].sort((a, b) => a - b);
  $('p50').textContent = sorted.length ? `${sorted[Math.floor(sorted.length * 0.5)].toFixed(1)}ms` : '—';
  $('p95').textContent = sorted.length ? `${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)}ms` : '—';
  $('dropped').textContent = dropped;
}

let frames = 0, lastSecond = performance.now();
function loop(prev) {
  const now = performance.now();
  const delta = now - prev;
  deltas.push(delta);
  if (deltas.length > 300) deltas.shift();
  if (delta > budget * 1.5) dropped++;
  frames++;
  if (now - lastSecond >= 1000) { $('fps').textContent = frames; frames = 0; lastSecond = now; paintBars(); }

  // The per-frame work under test.
  if (mode === 'heavy') burn(12);
  if (mode === 'thrash') {
    // Read → write → read → write. Each read after a write forces a synchronous layout.
    for (const el of bar.children) { const h = el.offsetHeight; el.style.height = `${h}px`; }
  }
  raf = requestAnimationFrame(() => loop(now));
}
requestAnimationFrame((t) => loop(t));

const reset = () => { deltas = []; dropped = 0; };

on('clean', () => { mode = null; reset(); log.head('clean animation'); out.textContent =
  'This is your baseline. p50 should sit at about one frame interval and p95 close to it.\n\n' +
  'The number to watch is P95, not the average. An animation that averages 12ms and spikes to 90ms\n' +
  'four times a second feels broken, and the average says it is fine. Users perceive the WORST\n' +
  'frames, not the mean.'; });

on('heavy', () => { mode = 'heavy'; reset(); log.bad('12ms of JS per frame'); out.textContent =
  'Twelve milliseconds of JavaScript per frame leaves under five for style, layout, paint,\n' +
  'composite and everything else the browser must do — and on a 120Hz display it has already\n' +
  'overrun the whole budget.\n\n' +
  'This is the crucial framing: YOUR CODE IS NOT THE BUDGET, IT IS A SHARE OF IT. A rough split for\n' +
  '60Hz:\n\n' +
  '    ~10ms   your JavaScript (and be suspicious well before that)\n' +
  '    ~4ms    style + layout\n' +
  '    ~2ms    paint + composite\n' +
  '    ────\n' +
  '    16.7ms\n\n' +
  'And on a 120Hz phone every one of those numbers halves.'; });

on('thrash', () => { mode = 'thrash'; reset(); log.bad('layout thrashing'); out.textContent =
  'Reading offsetHeight after writing style.height forces the browser to compute layout\n' +
  'SYNCHRONOUSLY, immediately, before your next line runs — and doing it in a loop means one forced\n' +
  'layout per element.\n\n' +
  'In the Performance panel these appear as tall purple bars with a warning triangle: "Forced\n' +
  'reflow is a likely performance bottleneck".\n\n' +
  'The fix is always the same shape: BATCH READS, THEN WRITES.\n' +
  '  const heights = [...els].map(el => el.offsetHeight);   // all reads\n' +
  '  els.forEach((el, i) => el.style.height = heights[i] + "px");   // all writes\n\n' +
  'The properties that force layout are worth memorising: offsetTop/Left/Width/Height,\n' +
  'clientWidth/Height, scrollTop/Height, getBoundingClientRect, getComputedStyle, focus(), and\n' +
  'scrollIntoView. See critical-rendering-path lab 03, which is entirely about this.'; });

on('longtask', () => {
  reset();
  log.bad('one 300ms task');
  setTimeout(() => burn(300), 100);
  out.textContent =
    'One long task. Look at the bar chart: a single enormous frame, then recovery.\n\n' +
    'The animation did not slow down — IT STOPPED, for 300ms, and then jumped. That discontinuity is\n' +
    'far more noticeable than a consistently lower frame rate, which is why "average FPS" is such a\n' +
    'poor metric.\n\n' +
    'Long tasks are also exactly what INP measures as input delay (web-vitals lab 04): if the user\n' +
    'had tapped during those 300ms, the tap would have waited.\n\n' +
    'Detect them in production with almost no code:\n\n' +
    "  new PerformanceObserver(l => { for (const e of l.getEntries()) report(e); })\n" +
    "    .observe({ type: 'longtask', buffered: true });\n\n" +
    'And the newer long-animation-frame entry type gives you the SCRIPT that caused it, with a URL\n' +
    'and a character position — which turns "something is slow" into a line number:\n\n' +
    "    .observe({ type: 'long-animation-frame', buffered: true })";
});

on('stop', () => { mode = null; log.muted('stopped extra work'); });

on('budget', () => {
  renderTable('#results', [
    { work: 'a transform/opacity animation on a promoted layer', cost: '~0ms main thread', fits: 'yes — may not touch the main thread at all' },
    { work: 'setting transform on 1,000 DOM nodes', cost: '4–15ms', fits: 'marginal' },
    { work: '10,000 fillRects on a canvas', cost: '2–6ms', fits: 'yes' },
    { work: 'a React re-render of ~500 components', cost: '10–40ms', fits: 'NO' },
    { work: 'JSON.parse of 1MB', cost: '10–30ms', fits: 'NO — worker or stream it' },
    { work: 'getBoundingClientRect in a 100-item loop after writes', cost: '10–50ms', fits: 'NO' },
    { work: 'a blurred box-shadow over a large area', cost: '5–20ms', fits: 'marginal' },
    { work: 'querySelectorAll over a large DOM', cost: '1–5ms', fits: 'yes, but not per frame' },
  ], { columns: ['work', 'cost', 'fits'] });
  out.textContent =
    'These are order-of-magnitude figures on a mid-range device — measure your own, because the\n' +
    'spread across devices is enormous (a 4× CPU throttle is a reasonable proxy for a mid-range\n' +
    'Android).\n\n' +
    'The two structural moves when something does not fit:\n' +
    '  1. DO IT SOMEWHERE ELSE — a worker (web-workers course), the compositor (lab 01), or the GPU\n' +
    '     (lab 05).\n' +
    '  2. DO LESS OF IT — virtualize, cull, batch, memoise, or lower the fidelity.\n\n' +
    'And the move that is not available: doing it faster. A 40ms React render does not become a 10ms\n' +
    'one by micro-optimising; it becomes 10ms by rendering a quarter as many components.';
});

on('measure', () => {
  renderTable('#results', [
    { tool: 'Performance panel', gives: 'the full frame breakdown with causality', when: 'always start here' },
    { tool: 'Rendering → Frame Rendering Stats', gives: 'a live FPS overlay with dropped frames', when: 'a quick check while tuning' },
    { tool: 'Rendering → Paint flashing', gives: 'what repaints, and how much of it', when: 'finding accidental repaints' },
    { tool: 'Rendering → Layer borders', gives: 'which elements are promoted', when: 'debugging compositing and memory' },
    { tool: 'PerformanceObserver longtask', gives: 'tasks over 50ms, in production', when: 'field monitoring' },
    { tool: 'long-animation-frame (LoAF)', gives: 'the SCRIPT and character position that caused a slow frame', when: 'the best field tool available' },
    { tool: 'requestAnimationFrame deltas', gives: 'a cheap in-page FPS/p95, like this lab', when: 'a permanent debug overlay' },
  ], { columns: ['tool', 'gives', 'when'] });
  out.textContent =
    'THE METRIC TO TRACK IS p95 FRAME TIME AND DROPPED-FRAME COUNT, not average FPS.\n\n' +
    '"58 FPS average" hides four 100ms stalls a second. A dropped-frame count and a p95 do not.\n\n' +
    'And measure with the SAME CPU throttle before and after, or the comparison is fiction. 4× is\n' +
    'the usual proxy for a mid-range Android; 6× for a low-end one. Your unthrottled laptop is a\n' +
    'device roughly nobody in your user base owns.';
});

on('rates', () => {
  out.textContent =
    'REFRESH RATES ARE NOT 60Hz ANY MORE. Phones and laptops ship at 90, 120 and 144Hz, and many\n' +
    'switch dynamically to save battery. Consequences:\n\n' +
    '  · YOUR BUDGET MAY BE 8.3ms, NOT 16.7. Code that "just fits" on a 60Hz monitor drops every\n' +
    '    other frame on a 120Hz phone.\n' +
    '  · NEVER ASSUME A FIXED FRAME INTERVAL. Always animate from the TIMESTAMP requestAnimationFrame\n' +
    '    gives you, or a measured delta:\n\n' +
    '      const step = (t) => { const dt = (t - prev) / 1000; prev = t;\n' +
    '                            x += velocity * dt; ... };\n\n' +
    '    Code written as x += 5 per frame runs at double speed on a 120Hz display — a real and\n' +
    '    common bug in hand-rolled animations.\n' +
    '  · setInterval is not a frame timer. It drifts, it fires in background tabs (throttled to\n' +
    '    once a minute or paused entirely), and it is not aligned to the display. Use\n' +
    '    requestAnimationFrame, which is aligned to paint and stops in hidden tabs.\n\n' +
    'Also worth knowing: rAF callbacks run BEFORE style and layout for that frame, which is why the\n' +
    'read-then-write batching pattern belongs inside one rAF callback — and why a write inside rAF\n' +
    'followed by a read is still a forced layout.';
});
