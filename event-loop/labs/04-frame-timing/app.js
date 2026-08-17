// Lab 04 — Frame timing.
//
// Same animation, six schedulers. The differences are not stylistic.

import { $, on, Log, renderTable, fmt, busy } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

const RANGE = 640;          // px of travel
const DURATION = 3000;      // ms for one crossing
const SPEED = RANGE / DURATION;

// ---------------------------------------------------------------------------
// Track construction
// ---------------------------------------------------------------------------

function makeTrack(name, kind = '') {
  const track = document.createElement('div');
  track.className = 'track';
  if (kind) track.setAttribute(`data-${kind}`, '');
  track.innerHTML = `<div class="dot"></div><div class="name"></div>`;
  track.querySelector('.name').textContent = name;
  $('tracks').appendChild(track);
  return track.querySelector('.dot');
}

const pos = (t) => ((t % DURATION) / DURATION) * RANGE;

// ---------------------------------------------------------------------------
// The six animators
// ---------------------------------------------------------------------------

const animators = [];
let startedAt = 0;
let running = false;

function animator(name, kind, spec) {
  const dot = makeTrack(name, kind);
  const a = { name, dot, maxError: 0, errorSum: 0, samples: 0, frames: 0, ...spec };
  animators.push(a);
  return a;
}

/** 1. setInterval(16) — the pre-2011 way. Never aligned to a frame. */
animator('setInterval(16), +px per tick', 'bad', {
  start() {
    this.x = 0;
    this.timer = setInterval(() => {
      this.x = (this.x + SPEED * 16) % RANGE;      // assumes the tick was exactly 16ms
      this.dot.style.transform = `translateX(${this.x}px)`;
      this.frames++;
    }, 16);
  },
  stop() { clearInterval(this.timer); },
  read() { return this.x; },
});

/** 2. setTimeout chain, +px per tick — same assumption, plus drift from the clamp. */
animator('setTimeout(16) chain, +px per tick', 'bad', {
  start() {
    this.x = 0;
    const step = () => {
      if (!running) return;
      this.x = (this.x + SPEED * 16) % RANGE;
      this.dot.style.transform = `translateX(${this.x}px)`;
      this.frames++;
      this.timer = setTimeout(step, 16);
    };
    this.timer = setTimeout(step, 16);
  },
  stop() { clearTimeout(this.timer); },
  read() { return this.x; },
});

/** 3. rAF, but position derived from a frame COUNTER. Correct at 60Hz, 2× fast at 120Hz. */
animator('rAF + frame counter (breaks at 120Hz)', 'bad', {
  start() {
    this.n = 0;
    const step = () => {
      if (!running) return;
      this.n++;
      this.x = (this.n * SPEED * 16.667) % RANGE;
      this.dot.style.transform = `translateX(${this.x}px)`;
      this.frames++;
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  },
  stop() { cancelAnimationFrame(this.raf); },
  read() { return this.x; },
});

/** 4. rAF + measured delta between frames. Accumulates float error, survives frame drops. */
animator('rAF + delta since last frame', '', {
  start() {
    this.x = 0;
    this.last = 0;
    const step = (ts) => {
      if (!running) return;
      if (this.last) this.x = (this.x + (ts - this.last) * SPEED) % RANGE;
      this.last = ts;
      this.dot.style.transform = `translateX(${this.x}px)`;
      this.frames++;
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  },
  stop() { cancelAnimationFrame(this.raf); },
  read() { return this.x; },
});

/** 5. rAF + absolute time from the frame timestamp. The correct JS way. */
animator('rAF + absolute time (correct)', '', {
  start() {
    this.t0 = 0;
    const step = (ts) => {
      if (!running) return;
      if (!this.t0) this.t0 = ts;
      this.x = pos(ts - this.t0);
      this.dot.style.transform = `translateX(${this.x}px)`;
      this.frames++;
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  },
  stop() { cancelAnimationFrame(this.raf); },
  read() { return this.x; },
});

/** 6. Web Animations API — ground truth. Runs on the compositor, ignores your main thread. */
animator('WAAPI (compositor — ground truth)', 'ref', {
  start() {
    this.anim = this.dot.animate(
      [{ transform: 'translateX(0px)' }, { transform: `translateX(${RANGE}px)` }],
      { duration: DURATION, iterations: Infinity, easing: 'linear' },
    );
  },
  stop() { this.anim?.cancel(); },
  read() {
    // currentTime is authoritative even when the main thread was blocked.
    const t = this.anim?.currentTime ?? 0;
    return pos(t);
  },
});

// ---------------------------------------------------------------------------
// Monitor: sample every frame, compare each animator to wall-clock truth.
// ---------------------------------------------------------------------------

let monitorRaf = 0;
let lastFrameTs = 0;
let droppedFrames = 0;
let totalFrames = 0;

function monitor(ts) {
  if (!running) return;
  if (lastFrameTs) {
    const dt = ts - lastFrameTs;
    totalFrames++;
    if (dt > 25) {
      droppedFrames += Math.round(dt / 16.667) - 1;
      if (dt > 100) log.bad(`frame gap ${fmt.ms(dt)} — ${Math.round(dt / 16.667) - 1} frames dropped`);
    }
  }
  lastFrameTs = ts;

  const truth = pos(ts - startedAt);
  for (const a of animators) {
    const x = a.read();
    // Positions wrap, so compare on the circle.
    let err = Math.abs(x - truth);
    err = Math.min(err, RANGE - err);
    a.maxError = Math.max(a.maxError, err);
    a.errorSum += err;
    a.samples++;
  }

  monitorRaf = requestAnimationFrame(monitor);
}

function report() {
  const elapsed = Math.max((performance.now() - startedAt) / 1000, 0.001);
  const rows = animators.map((a) => ({
    animator: a.name,
    'callbacks/s': a.frames ? Number((a.frames / elapsed).toFixed(1)) : 'compositor',
    'avg error px': a.samples ? Number((a.errorSum / a.samples).toFixed(1)) : 0,
    'max error px': Number(a.maxError.toFixed(1)),
    _maxClass: a.maxError > 40 ? 'no' : a.maxError > 10 ? 'meh' : 'ok',
  }));
  renderTable('#results', rows, { columns: ['animator', 'callbacks/s', 'avg error px', 'max error px'] });
  out.textContent =
    `frames observed: ${totalFrames}   frames dropped: ${droppedFrames}\n` +
    `display refresh looks like ~${(1000 / ((performance.now() - startedAt) / Math.max(totalFrames, 1))).toFixed(0)}Hz`;
}

// ---------------------------------------------------------------------------

function start() {
  stop();
  log.clear();
  running = true;
  startedAt = performance.now();
  lastFrameTs = 0;
  droppedFrames = totalFrames = 0;
  for (const a of animators) {
    a.maxError = a.errorSum = a.samples = a.frames = 0;
    a.start();
  }
  monitorRaf = requestAnimationFrame(monitor);
  reportTimer = setInterval(report, 1000);
  log.ok('started — let it run at least 15 seconds');
}

function stop() {
  running = false;
  cancelAnimationFrame(monitorRaf);
  clearInterval(reportTimer);
  for (const a of animators) a.stop?.();
}

let reportTimer = 0;
let blockTimer = 0;

on('start', start);
on('stop', () => { stop(); report(); log.muted('stopped'); });

on('block', () => {
  log.bad('blocking the main thread for 800ms — watch the green dot');
  busy(800);
});

on($('blockEvery'), 'change', (e) => {
  clearInterval(blockTimer);
  const ms = Number(e.target.value);
  if (ms > 0) {
    blockTimer = setInterval(() => busy(400), ms);
    log.bad(`blocking 400ms every ${ms}ms`);
  }
});

// Simulate a slower display by dropping every other frame's work.
let half = false;
on('halfRate', () => {
  half = !half;
  $('halfRate').setAttribute('aria-pressed', String(half));
  log.muted(half
    ? 'half rate ON — every other frame does 20ms of work, so the browser can only serve ~30fps'
    : 'half rate off');
  const tick = () => {
    if (!half) return;
    busy(20);
    requestAnimationFrame(tick);
  };
  if (half) requestAnimationFrame(tick);
});
