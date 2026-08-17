// Lab 02 — Microtask starvation.
//
// Six ways to spend 2 seconds. The liveness probes (painted frames, handled clicks) are the
// only honest measure of which ones let the browser do its job.

import { $, on, Log, renderTable, busy } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const heart = $('#heart i');
const pokeBtn = $('poke');

// ---------------------------------------------------------------------------
// Liveness probes. These run for the whole life of the page.
// ---------------------------------------------------------------------------

let frames = 0;
let clicks = 0;
let worstFrame = 0;
let lastFrameAt = performance.now();

function beat(now) {
  const dt = now - lastFrameAt;
  lastFrameAt = now;
  frames++;
  if (dt > worstFrame) worstFrame = dt;
  heart.style.transform = `translateX(${(Math.sin(now / 300) * 0.5 + 0.5) * 220}%)`;
  requestAnimationFrame(beat);
}
requestAnimationFrame(beat);

on(pokeBtn, 'click', () => {
  clicks++;
  pokeBtn.textContent = `poke me (${clicks} clicks handled)`;
});

// ---------------------------------------------------------------------------
// Measurement harness
// ---------------------------------------------------------------------------

const rows = [];

/**
 * Run one strategy and report what the browser managed to do while it ran.
 * `fn(deadline)` must call `done()` when it has finished burning time.
 */
function measure(label, fn) {
  const ms = Number($('ms').value);
  const f0 = frames, c0 = clicks;
  worstFrame = 0;

  log.head(`— ${label} for ${ms}ms —`);
  log.muted('mash the poke button now');

  const t0 = performance.now();
  const deadline = t0 + ms;

  return new Promise((resolve) => {
    fn(deadline, () => {
      const wall = performance.now() - t0;
      const painted = frames - f0;
      const handled = clicks - c0;
      const fps = painted / (wall / 1000);

      rows.push({
        strategy: label,
        'wall ms': Math.round(wall),
        'frames painted': painted,
        fps: Number(fps.toFixed(1)),
        'clicks handled': handled,
        'worst frame ms': Math.round(worstFrame),
        _fpsClass: fps > 45 ? 'ok' : fps > 5 ? 'meh' : 'no',
        _worstClass: worstFrame > 200 ? 'no' : worstFrame > 50 ? 'meh' : 'ok',
      });

      renderTable('#results', rows, {
        columns: ['strategy', 'wall ms', 'frames painted', 'fps', 'clicks handled', 'worst frame ms'],
      });
      log.line(`done: ${painted} frames, ${handled} clicks handled, worst frame ${Math.round(worstFrame)}ms`,
        fps > 45 ? 'good' : 'bad');
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// A. Plain busy loop — the honest version of blocking.
// ---------------------------------------------------------------------------

function plainBusy(deadline, done) {
  while (performance.now() < deadline) busy(1);
  done();
}

// ---------------------------------------------------------------------------
// B. queueMicrotask chain
//
// Looks like it yields. Yields to the microtask queue — which the browser drains to EMPTY
// before it is allowed to render. So it never renders.
// ---------------------------------------------------------------------------

function microChain(deadline, done) {
  function step() {
    busy(1);
    if (performance.now() < deadline) queueMicrotask(step);
    else done();
  }
  queueMicrotask(step);
}

// ---------------------------------------------------------------------------
// C. await in a while loop
//
// Identical to B. `await` on a resolved value is a microtask, nothing more.
// This is the shape that ships to production, because it *reads* like yielding.
// ---------------------------------------------------------------------------

async function awaitLoop(deadline, done) {
  while (performance.now() < deadline) {
    busy(1);
    await null;              // ← microtask. Not a yield to the browser.
  }
  done();
}

// ---------------------------------------------------------------------------
// D. setTimeout chain — a real yield, to the task queue.
// ---------------------------------------------------------------------------

function taskChain(deadline, done) {
  function step() {
    busy(1);
    if (performance.now() < deadline) setTimeout(step, 0);
    else done();
  }
  setTimeout(step, 0);
}

// ---------------------------------------------------------------------------
// E. rAF chain — yields, and syncs to the frame.
// ---------------------------------------------------------------------------

function rafChain(deadline, done) {
  function step() {
    busy(1);
    if (performance.now() < deadline) requestAnimationFrame(step);
    else done();
  }
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// F. TODO — your version.
//
// Requirements:
//   1. Do the same total amount of work (busy(1) per step) as A–E.
//   2. Keep FPS above 45 and handle every click.
//   3. Do NOT yield after every single unit of work — that wastes most of the frame budget
//      on scheduling overhead. Work until the frame budget is nearly gone, then yield once.
//   4. Yield to something the browser can render between. Choose one and justify it:
//        setTimeout(0) | MessageChannel | scheduler.yield() | requestAnimationFrame
//
// Aim for: same wall time as D or better, FPS within 10% of E, every click handled.
// ---------------------------------------------------------------------------

function yourYieldingVersion(deadline, done) {
  throw new Error('TODO: implement yourYieldingVersion() in app.js — see the README');
}

// ---------------------------------------------------------------------------
// The one that really hangs.
// ---------------------------------------------------------------------------

function forever() {
  const ok = confirm(
    'This starts a microtask that queues another microtask, forever.\n\n' +
    'The tab will stop painting, stop responding to input, and will NOT recover. ' +
    'You will have to close it (and Chrome\'s "page unresponsive" dialog may not even appear).\n\n' +
    'Continue?'
  );
  if (!ok) return;
  log.bad('starting infinite microtask chain — goodbye');
  // Give the log one frame to paint before we take the thread away for good.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    function loop() { queueMicrotask(loop); }
    loop();
  }));
}

// ---------------------------------------------------------------------------

const strategies = {
  busy: ['A. plain busy loop', plainBusy],
  micro: ['B. queueMicrotask chain', microChain],
  await: ['C. await in while loop', awaitLoop],
  task: ['D. setTimeout chain', taskChain],
  raf: ['E. rAF chain', rafChain],
  fixed: ['F. your yielding version', yourYieldingVersion],
};

for (const [id, [label, fn]] of Object.entries(strategies)) {
  on(id, async () => {
    try {
      await measure(label, fn);
    } catch (err) {
      log.bad(`${label}: ${err.message}`);
    }
  });
}

on('reset', () => {
  rows.length = 0;
  renderTable('#results', rows);
  log.clear();
  clicks = 0;
  pokeBtn.textContent = 'poke me (0 clicks handled)';
});

on('forever', forever);

out.textContent =
  'Run A, B, C, D, E in order, mashing the poke button each time.\n' +
  'B and C are the interesting ones: they yield constantly and still paint nothing.';
