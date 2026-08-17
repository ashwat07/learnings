// Lab 05 — When not to use a worker (page side).

import { $, on, Log, renderTable, renderBars, fmt, busy } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const BENCH_URL = new URL('./bench-worker.js', import.meta.url);

let spawnCost = null;
let roundTrip = null;

// ---------------------------------------------------------------------------
// 1. Fixed costs
// ---------------------------------------------------------------------------

on('spawn', async () => {
  log.head('— spawn cost: new Worker() → first message received —');
  const times = [];
  for (let i = 0; i < 8; i++) {
    const t0 = performance.now();
    const w = new Worker(BENCH_URL);
    await new Promise((resolve) => w.addEventListener('message', resolve, { once: true }));
    times.push(performance.now() - t0);
    w.terminate();
  }
  spawnCost = times.reduce((a, b) => a + b, 0) / times.length;
  log.line(`spawn cost: ${times.map((t) => t.toFixed(1)).join(', ')} ms`, 'macro');
  log.ok(`average ${fmt.ms(spawnCost)} per worker`);
  out.textContent =
    `A worker costs about ${fmt.ms(spawnCost)} before it runs a single line of your code — and\n` +
    'that is on this machine, unthrottled, with a nearly empty script. On a mid-range phone with\n' +
    'a real bundle it is routinely 5–10× more.\n\n' +
    'Consequences:\n' +
    '  • never spawn one per task (Lab 03)\n' +
    '  • spawning one at page load costs you main-thread time during the busiest moment of the\n' +
    '    page lifecycle — consider spawning lazily, or during an idle callback\n' +
    '  • a worker that is only used once for 20ms of work is a net loss';
});

on('roundtrip', async () => {
  log.head('— round-trip latency: 200 empty-ish calls —');
  const w = new Worker(BENCH_URL);
  await new Promise((r) => w.addEventListener('message', r, { once: true }));

  const t0 = performance.now();
  for (let i = 0; i < 200; i++) {
    await new Promise((resolve) => {
      const on_ = (e) => { if (e.data.id === i) { w.removeEventListener('message', on_); resolve(); } };
      w.addEventListener('message', on_);
      w.postMessage({ id: i, ms: 0 });
    });
  }
  roundTrip = (performance.now() - t0) / 200;
  w.terminate();
  log.ok(`round trip: ${roundTrip.toFixed(3)}ms per call`);
  out.textContent =
    `Each call costs ~${roundTrip.toFixed(2)}ms of pure scheduling, before any payload.\n\n` +
    `Which means: a worker call is only worth it if the work is meaningfully larger than\n` +
    `${roundTrip.toFixed(2)}ms — and 'meaningfully' means at least 10×, because at 2× you have\n` +
    'doubled your complexity to save nothing.\n\n' +
    'Rule of thumb from these two numbers: batch anything under ~5ms, and prefer one call with a\n' +
    'thousand items to a thousand calls with one item.';
});

// ---------------------------------------------------------------------------
// 2. The crossover sweep
// ---------------------------------------------------------------------------

on('sweep', async () => {
  log.head('— crossover sweep —');
  const sizes = [0.1, 0.5, 1, 2, 5, 10, 25, 50];
  const total = Number($('tasks').value);
  const rows = [];

  const w = new Worker(BENCH_URL);
  await new Promise((r) => w.addEventListener('message', r, { once: true }));

  for (const ms of sizes) {
    const n = Math.max(1, Math.round(total * (1 / Math.max(ms, 0.1)) / 10));

    // Main thread: just do it.
    const t0 = performance.now();
    for (let i = 0; i < n; i++) busy(ms);
    const mainMs = performance.now() - t0;

    // Worker: one call per task (the naive shape people write).
    const t1 = performance.now();
    for (let i = 0; i < n; i++) {
      await new Promise((resolve) => {
        const on_ = (e) => { if (e.data.id === i) { w.removeEventListener('message', on_); resolve(); } };
        w.addEventListener('message', on_);
        w.postMessage({ id: i, ms });
      });
    }
    const workerMs = performance.now() - t1;

    const overhead = ((workerMs - mainMs) / mainMs) * 100;
    rows.push({
      'task size ms': ms,
      tasks: n,
      'main thread ms': Math.round(mainMs),
      'worker ms': Math.round(workerMs),
      'overhead %': Math.round(overhead),
      verdict: overhead > 50 ? 'worker much worse' : overhead > 10 ? 'worker worse' : 'about even',
      _overheadClass: overhead > 50 ? 'no' : overhead > 10 ? 'meh' : 'ok',
    });
    renderTable('#results', rows, {
      columns: ['task size ms', 'tasks', 'main thread ms', 'worker ms', 'overhead %', 'verdict'],
    });
    log.line(`${String(ms).padStart(5)}ms × ${String(n).padStart(4)}  main ${Math.round(mainMs)}ms  ` +
      `worker ${Math.round(workerMs)}ms  (+${Math.round(overhead)}%)`,
      overhead > 25 ? 'bad' : 'good');
  }
  w.terminate();

  out.textContent =
    'Read the overhead column. Small tasks are dominated by the round trip; large tasks amortise\n' +
    'it away. The crossover for per-call messaging is usually somewhere around 5–20ms per task.\n\n' +
    'But notice what this table does NOT measure: responsiveness. Even where the worker is 30%\n' +
    'slower in total, the main thread stayed free the whole time. That is the actual reason to\n' +
    'use one — and it is why "the worker is slower" is not, by itself, an argument against it.\n\n' +
    'The right shape is nearly always: ONE call with all the work, not N calls with a slice each.\n' +
    'That moves you to the bottom row of this table regardless of task size.';
});

// ---------------------------------------------------------------------------
// 3. OffscreenCanvas
// ---------------------------------------------------------------------------

let mainRaf = 0;

on('startCanvas', () => {
  // Main-thread animation.
  const mainCanvas = $('#mainCanvas');
  const ctx = mainCanvas.getContext('2d');
  cancelAnimationFrame(mainRaf);
  (function drawMain(t) {
    ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    for (let i = 0; i < 60; i++) {
      const p = (t / 900 + i / 60) % 1;
      ctx.fillStyle = `hsl(${(i * 6 + t / 20) % 360} 80% 65%)`;
      ctx.fillRect(p * mainCanvas.width, mainCanvas.height / 2 + Math.sin(t / 400 + i / 4) * 50, 6, 6);
    }
    ctx.fillStyle = '#9a9ab0';
    ctx.font = '12px ui-monospace, Menlo, monospace';
    ctx.fillText('main-thread rendered', 10, 16);
    mainRaf = requestAnimationFrame(drawMain);
  })(performance.now());

  // Worker-rendered animation. transferControlToOffscreen() can only be called ONCE per
  // canvas, so guard against a second click.
  const workerCanvas = $('#workerCanvas');
  if (!workerCanvas.dataset.transferred) {
    const off = workerCanvas.transferControlToOffscreen();
    const w = new Worker(new URL('./canvas-worker.js', import.meta.url));
    w.postMessage({ canvas: off, width: workerCanvas.width, height: workerCanvas.height }, [off]);
    workerCanvas.dataset.transferred = '1';
    log.ok('canvas transferred to the worker — the main thread now does nothing per frame');
  }
  log.muted('both animations running; now block the main thread');
});

on('block', () => {
  log.bad('blocking the main thread for 2000ms');
  busy(2000);
  log.ok('unblocked');
  out.textContent =
    'The left canvas froze; the right one never missed a frame. The main thread was not involved\n' +
    'in its rendering at all — the canvas was transferred, and the worker has its own\n' +
    'requestAnimationFrame.\n\n' +
    'This is the clearest case for a worker: rendering that must stay smooth while the main\n' +
    'thread does unpredictable application work. Charts on a busy dashboard, a map, a game view,\n' +
    'a live waveform.\n\n' +
    'Constraints worth knowing before you commit:\n' +
    '  • transferControlToOffscreen() is one-way and once-only per canvas\n' +
    '  • the worker has no DOM: no getBoundingClientRect, no CSS, no hit testing. You forward\n' +
    '    input events yourself, with coordinates you computed on the main thread\n' +
    '  • text metrics and fonts work, but font loading is the page\'s job\n' +
    '  • debugging is worse: DevTools shows the worker in a separate context';
});
