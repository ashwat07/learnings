// Lab 07 — Scheduling APIs.

import { $, on, Log, renderTable, fmt, busy } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');
const bar = $('#bar i');
const pokeBtn = $('poke');

const hasPostTask = typeof globalThis.scheduler?.postTask === 'function';
const hasYield = typeof globalThis.scheduler?.yield === 'function';
const hasIdle = typeof globalThis.requestIdleCallback === 'function';
const hasInputPending = typeof navigator.scheduling?.isInputPending === 'function';

$('support').textContent =
  `support here → scheduler.postTask: ${hasPostTask ? 'yes' : 'NO'} · ` +
  `scheduler.yield: ${hasYield ? 'yes' : 'NO'} · ` +
  `requestIdleCallback: ${hasIdle ? 'yes' : 'NO'} · ` +
  `isInputPending: ${hasInputPending ? 'yes' : 'NO'}` +
  (hasPostTask ? '' : '  (Chromium only — note which parts of this lab you cannot run, and why that matters for shipping)');

// ---------------------------------------------------------------------------
// Liveness probes
// ---------------------------------------------------------------------------

let frames = 0, clicks = 0, worstFrame = 0, lastFrame = performance.now();
(function beat(now) {
  const dt = now - lastFrame; lastFrame = now; frames++;
  if (dt > worstFrame) worstFrame = dt;
  requestAnimationFrame(beat);
})(performance.now());

on(pokeBtn, 'click', () => {
  clicks++;
  pokeBtn.textContent = `poke me (${clicks} handled)`;
});

// ---------------------------------------------------------------------------
// The work
// ---------------------------------------------------------------------------

let progress = 0;
function unit() {
  busy(Number($('cost').value));
  progress++;
  // Cheap progress update: one style write, no reads.
  bar.style.width = `${(progress / Number($('units').value)) * 100}%`;
}

const rows = [];

async function run(label, strategy) {
  const n = Number($('units').value);
  progress = 0;
  bar.style.width = '0';
  const f0 = frames, c0 = clicks;
  worstFrame = 0;
  log.head(`— ${label}: ${n} units × ${$('cost').value}ms —`);
  log.muted('mash the poke button');

  const t0 = performance.now();
  await strategy(n);
  const wall = performance.now() - t0;
  const painted = frames - f0;

  rows.push({
    strategy: label,
    'wall ms': Math.round(wall),
    'overhead %': Math.round(((wall - n * Number($('cost').value)) / (n * Number($('cost').value))) * 100),
    fps: Number((painted / (wall / 1000)).toFixed(1)),
    'clicks handled': clicks - c0,
    'worst frame': Math.round(worstFrame),
    _fpsClass: painted / (wall / 1000) > 45 ? 'ok' : 'no',
  });
  renderTable('#results', rows, {
    columns: ['strategy', 'wall ms', 'overhead %', 'fps', 'clicks handled', 'worst frame'],
  });
  log.line(`${label}: ${fmt.ms(wall)}, ${(painted / (wall / 1000)).toFixed(0)}fps, ` +
    `${clicks - c0} clicks handled, worst frame ${Math.round(worstFrame)}ms`,
    painted / (wall / 1000) > 45 ? 'good' : 'bad');
}

// ---------------------------------------------------------------------------
// A. Plain loop
// ---------------------------------------------------------------------------

const plain = async (n) => { for (let i = 0; i < n; i++) unit(); };

// ---------------------------------------------------------------------------
// B. setTimeout per unit — a task each, and the 4ms clamp taxes every one.
// ---------------------------------------------------------------------------

const perTimeout = (n) => new Promise((resolve) => {
  let i = 0;
  const step = () => { unit(); if (++i < n) setTimeout(step, 0); else resolve(); };
  setTimeout(step, 0);
});

// ---------------------------------------------------------------------------
// C. requestIdleCallback — run only when the browser has nothing better to do.
//
// deadline.timeRemaining() starts at up to 50ms and counts down. deadline.didTimeout tells
// you the browser gave up waiting for idle time and ran you anyway (because of `timeout`).
//
// Idle work is genuinely deprioritised: under load it may never run. That's a feature for
// analytics and a disaster for anything a user is waiting on.
// ---------------------------------------------------------------------------

const idle = (n) => new Promise((resolve) => {
  let i = 0;
  const step = (deadline) => {
    let did = 0;
    while (i < n && (deadline.timeRemaining() > Number($('cost').value) || deadline.didTimeout)) {
      unit(); i++; did++;
    }
    if (did) log.line(`idle slice: ${did} units, ${fmt.ms(deadline.timeRemaining())} left` +
      (deadline.didTimeout ? ' (TIMED OUT — ran despite no idle time)' : ''), 'idle');
    if (i < n) requestIdleCallback(step, { timeout: 1000 });
    else resolve();
  };
  requestIdleCallback(step, { timeout: 1000 });
});

// ---------------------------------------------------------------------------
// D. scheduler.postTask at background priority — one task per unit.
// ---------------------------------------------------------------------------

const postTaskEach = async (n) => {
  if (!hasPostTask) throw new Error('scheduler.postTask not supported in this browser');
  const jobs = [];
  for (let i = 0; i < n; i++) jobs.push(scheduler.postTask(unit, { priority: 'background' }));
  await Promise.all(jobs);
};

// ---------------------------------------------------------------------------
// E. Chunk to a time budget, then yield.
//
// The important property of scheduler.yield(): your continuation is queued AHEAD of tasks
// that were posted while you were working, at your own priority. With postTask you go to the
// back of the queue, so a busy page can starve your loop.
// ---------------------------------------------------------------------------

const yieldToBrowser = hasYield
  ? () => scheduler.yield()
  : () => new Promise((r) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { ch.port1.close(); r(); };
    ch.port2.postMessage(null);
  });

const chunkYield = async (n) => {
  const BUDGET = 5;
  let start = performance.now();
  for (let i = 0; i < n; i++) {
    unit();
    if (performance.now() - start > BUDGET) {
      await yieldToBrowser();
      start = performance.now();
    }
  }
};

// ---------------------------------------------------------------------------
// F. TODO — the production version.
//
// Requirements:
//   1. Chunk to a time budget like E.
//   2. If navigator.scheduling.isInputPending() reports pending input, yield IMMEDIATELY,
//      even mid-budget. That is what keeps INP low under a real user's thumb.
//   3. Adapt the budget: if you observe frames longer than 20ms, shrink it; if the page is
//      idle, grow it (up to ~10ms). Log each adjustment.
//   4. Accept an AbortSignal and stop between units.
//   5. Beat E on "clicks handled" without being more than 15% slower on wall time.
//
// Then answer in a comment: why is isInputPending() not simply always better than a small
// fixed budget? (Hint: it only reports input the browser has already received, and it costs
// a call per check.)
// ---------------------------------------------------------------------------

const yours = async (n) => {
  throw new Error('TODO: implement `yours` in app.js — see the README');
};

// ---------------------------------------------------------------------------
// Priority ordering
// ---------------------------------------------------------------------------

async function priorities() {
  if (!hasPostTask) return log.bad('scheduler.postTask not supported here');
  log.head('— priority ordering: posted background → user-visible → user-blocking —');

  const order = [];
  const p = [];
  p.push(scheduler.postTask(() => { order.push('background'); log.line('background', 'idle'); }, { priority: 'background' }));
  p.push(scheduler.postTask(() => { order.push('user-visible'); log.line('user-visible', 'macro'); }, { priority: 'user-visible' }));
  p.push(scheduler.postTask(() => { order.push('user-blocking'); log.line('user-blocking', 'good'); }, { priority: 'user-blocking' }));
  setTimeout(() => log.line('setTimeout(0) — same queue as user-visible', 'macro'), 0);

  await Promise.all(p);
  log.ok(`ran in order: ${order.join(' → ')}`);
  out.textContent =
    'Posted last, ran first. Three priorities:\n' +
    '  user-blocking — the user is waiting and the UI is stuck until it is done\n' +
    '  user-visible  — the user will notice, but it can wait a frame (this is the default,\n' +
    '                  and it is the same priority as setTimeout)\n' +
    '  background    — nobody is waiting; may be delayed indefinitely under load';
}

// ---------------------------------------------------------------------------
// TaskController: change priority mid-flight, or cancel.
// ---------------------------------------------------------------------------

async function controllerDemo() {
  if (!hasPostTask || typeof TaskController === 'undefined') {
    return log.bad('TaskController not supported here');
  }
  log.head('— TaskController: promote a background task, then abort another —');

  const c1 = new TaskController({ priority: 'background' });
  const c2 = new TaskController({ priority: 'background' });

  const t1 = scheduler.postTask(() => log.ok('promoted task ran'), { signal: c1.signal });
  const t2 = scheduler.postTask(() => log.bad('aborted task ran — this should NOT print'), { signal: c2.signal });

  // Fill the queue with background work so nothing background-priority runs immediately.
  for (let i = 0; i < 40; i++) scheduler.postTask(() => busy(5), { priority: 'background' });

  c1.setPriority('user-blocking');       // jump the queue
  c2.abort();                            // never mind

  await t1;
  await t2.catch((e) => log.muted(`aborted task rejected with ${e.name} — handle this, or it is an unhandled rejection`));

  out.textContent =
    'A TaskController gives you an AbortSignal that also carries priority. You can promote work\n' +
    'when the user suddenly needs it (they scrolled to it, they clicked the tab) and cancel work\n' +
    'that stopped mattering. This is the API React/Angular-style schedulers had to hand-roll.';
}

// ---------------------------------------------------------------------------
// Starving idle callbacks
// ---------------------------------------------------------------------------

function starve() {
  log.head('— starving requestIdleCallback: 40ms of work every 50ms for 3 seconds —');
  let idleRuns = 0;
  const started = performance.now();

  requestIdleCallback(function step(d) {
    idleRuns++;
    log.line(`idle callback #${idleRuns} at ${fmt.ms(performance.now() - started)}, ` +
      `${fmt.ms(d.timeRemaining())} available, didTimeout=${d.didTimeout}`, 'idle');
    if (performance.now() - started < 3000) requestIdleCallback(step, { timeout: 2000 });
  }, { timeout: 2000 });

  const load = setInterval(() => busy(40), 50);
  setTimeout(() => {
    clearInterval(load);
    log.line(`idle callbacks in 3s under load: ${idleRuns}`, idleRuns < 5 ? 'bad' : 'good');
    out.textContent =
      `requestIdleCallback ran ${idleRuns} times in 3 seconds of moderate load.\n` +
      'Without the `timeout` option it can be zero — indefinitely. Never put anything a user is\n' +
      'waiting for in an idle callback. Do put: analytics beacons, prefetch, cache warming,\n' +
      'log flushing, non-visible precomputation.';
  }, 3000);
}

// ---------------------------------------------------------------------------

on('sync', () => run('A. plain loop', plain));
on('timeout', () => run('B. setTimeout each', perTimeout));
on('idle', () => hasIdle ? run('C. requestIdleCallback', idle) : log.bad('no requestIdleCallback here'));
on('postTask', () => run('D. postTask background', postTaskEach).catch((e) => log.bad(e.message)));
on('yield', () => run('E. chunk + yield', chunkYield));
on('best', () => run('F. yours', yours).catch((e) => log.bad(e.message)));
on('priorities', () => { log.clear(); priorities(); });
on('controller', () => { log.clear(); controllerDemo(); });
on('starve', () => { log.clear(); starve(); });
on('reset', () => {
  rows.length = 0;
  renderTable('#results', rows);
  log.clear();
  clicks = 0;
  pokeBtn.textContent = 'poke me (0 handled)';
});
