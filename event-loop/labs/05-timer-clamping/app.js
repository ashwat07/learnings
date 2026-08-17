// Lab 05 — Timer clamping & throttling.

import { $, on, Log, renderTable, renderBars, fmt, busy } from '/shared/lab-ui.js';

const log = new Log('#log');
const out = $('out');

// ---------------------------------------------------------------------------
// 1. The nesting clamp
//
// HTML spec: if the timeout nesting level is greater than 5 and the requested timeout is
// less than 4ms, the timeout is set to 4ms. "Nesting level" increments when you schedule a
// timer from inside a timer callback.
//
// This is why a setTimeout(0) chain caps out around 250 iterations per second.
// ---------------------------------------------------------------------------

function measureNesting() {
  log.head('— 1. nesting clamp: 20 nested setTimeout(fn, 0) calls —');
  const gaps = [];
  let last = performance.now();
  let depth = 0;

  function step() {
    const now = performance.now();
    gaps.push({ depth: ++depth, gap: now - last });
    last = now;
    if (depth < 20) setTimeout(step, 0);
    else finish();
  }
  setTimeout(step, 0);

  function finish() {
    renderBars('#results', gaps.map((g) => ({
      label: `nest ${g.depth}`,
      value: g.gap,
      cls: g.gap > 3.5 ? 'bad' : 'good',
      text: fmt.ms(g.gap),
    })), { max: 8 });

    const early = gaps.slice(0, 4).reduce((a, b) => a + b.gap, 0) / 4;
    const late = gaps.slice(-8).reduce((a, b) => a + b.gap, 0) / 8;
    out.textContent =
      `first 4 nesting levels: ~${fmt.ms(early)} each\n` +
      `after level 5:          ~${fmt.ms(late)} each   ← the 4ms clamp\n\n` +
      `A chain of setTimeout(0) therefore runs at ~${(1000 / late).toFixed(0)} iterations/second, ` +
      `no matter how\nfast your callback is. Budget accordingly, or stop using timers as a yield primitive.`;
    log.ok(`clamp measured: ${fmt.ms(early)} → ${fmt.ms(late)}`);
  }
}

// ---------------------------------------------------------------------------
// 2. Throughput per scheduling primitive
//
// How many times can you round-trip through the event loop in one second?
// ---------------------------------------------------------------------------

function throughput() {
  log.head('— 2. throughput: round trips per second, empty callback —');
  out.textContent = 'measuring… ~1s per primitive';

  const primitives = [
    ['queueMicrotask', (fn) => queueMicrotask(fn)],
    ['setTimeout(0)', (fn) => setTimeout(fn, 0)],
    ['setTimeout(1)', (fn) => setTimeout(fn, 1)],
    ['MessageChannel', (() => {
      const ch = new MessageChannel();
      let cb = null;
      ch.port1.onmessage = () => cb?.();
      return (fn) => { cb = fn; ch.port2.postMessage(null); };
    })()],
    ['requestAnimationFrame', (fn) => requestAnimationFrame(fn)],
    ...(globalThis.scheduler?.postTask
      ? [['scheduler.postTask (user-visible)', (fn) => scheduler.postTask(fn, { priority: 'user-visible' })]]
      : []),
    ...(globalThis.scheduler?.yield
      ? [['scheduler.yield()', (fn) => scheduler.yield().then(fn)]]
      : []),
  ];

  const rows = [];

  function runOne(i) {
    if (i >= primitives.length) {
      renderTable('#results', rows, { columns: ['primitive', 'round trips/s', 'min interval'] });
      out.textContent =
        'queueMicrotask is fastest and useless for yielding — the browser cannot render between\n' +
        'microtasks. MessageChannel is the fastest primitive that DOES let a frame through, which\n' +
        'is why every serious scheduler (React, Angular zones, comlink) reached for it before\n' +
        'scheduler.postTask existed.';
      return;
    }
    const [name, schedule] = primitives[i];
    let n = 0;
    const end = performance.now() + 1000;
    const step = () => {
      n++;
      if (performance.now() < end) schedule(step);
      else {
        rows.push({
          primitive: name,
          'round trips/s': n,
          'min interval': fmt.ms(1000 / n),
        });
        log.line(`${name.padEnd(34)} ${String(n).padStart(7)} round trips/s`, n > 1000 ? 'good' : 'macro');
        renderTable('#results', rows, { columns: ['primitive', 'round trips/s', 'min interval'] });
        runOne(i + 1);
      }
    };
    schedule(step);
  }

  runOne(0);
}

// ---------------------------------------------------------------------------
// 3. setInterval pile-up
//
// setInterval schedules by wall clock, not by "when the last one finished". If the callback
// takes longer than the interval, the browser does not run them concurrently (it can't) —
// it runs them back to back, forever, with zero idle time. Your page never breathes again.
//
// A recursive setTimeout schedules the NEXT run only after this one finished, so it degrades
// gracefully instead.
// ---------------------------------------------------------------------------

async function pileup() {
  log.head('— 3. setInterval(10) with a 30ms callback vs recursive setTimeout(10) —');

  const measure = (label, start) => new Promise((resolve) => {
    let calls = 0, idle = 0, lastEnd = performance.now();
    const stop = start(() => {
      idle += performance.now() - lastEnd;
      calls++;
      busy(30);
      lastEnd = performance.now();
    });
    setTimeout(() => {
      stop();
      resolve({ strategy: label, calls, 'idle ms in 2s': Math.round(idle), 'idle %': Math.round((idle / 2000) * 100) });
    }, 2000);
  });

  const a = await measure('setInterval(10)', (cb) => {
    const t = setInterval(cb, 10);
    return () => clearInterval(t);
  });

  const b = await measure('recursive setTimeout(10)', (cb) => {
    let t, alive = true;
    const step = () => { if (!alive) return; cb(); t = setTimeout(step, 10); };
    t = setTimeout(step, 10);
    return () => { alive = false; clearTimeout(t); };
  });

  renderTable('#results', [a, b], { columns: ['strategy', 'calls', 'idle ms in 2s', 'idle %'] });
  log.line(`setInterval: ${a.calls} calls, ${a['idle %']}% idle`, a['idle %'] < 10 ? 'bad' : 'good');
  log.line(`setTimeout:  ${b.calls} calls, ${b['idle %']}% idle`, 'good');
  out.textContent =
    'Same intended rate, same work per call. setInterval leaves the main thread with almost no\n' +
    'idle time, because it keeps firing regardless of whether the previous call finished. The\n' +
    'recursive setTimeout self-regulates.\n\n' +
    'Rule: if the callback duration is not comfortably below the interval, never use setInterval.';
}

// ---------------------------------------------------------------------------
// 4. setInterval drift
//
// setInterval does not guarantee the interval — it guarantees "at least". Errors accumulate
// against wall clock, which is why clocks built on setInterval(1000) lose seconds.
// ---------------------------------------------------------------------------

function drift() {
  log.head('— 4. setInterval(100) drift over 10 seconds, with load —');
  const t0 = performance.now();
  let ticks = 0;
  const loadTimer = setInterval(() => busy(40), 130);   // competing work

  const timer = setInterval(() => {
    ticks++;
    const expected = ticks * 100;
    const actual = performance.now() - t0;
    if (ticks % 10 === 0) {
      log.line(`tick ${String(ticks).padStart(3)}  expected ${expected}ms  actual ${actual.toFixed(0)}ms  ` +
        `drift ${(actual - expected).toFixed(0)}ms`, actual - expected > 200 ? 'bad' : 'macro');
    }
    if (ticks === 100) {
      clearInterval(timer);
      clearInterval(loadTimer);
      const total = performance.now() - t0 - 10000;
      out.textContent =
        `100 ticks of setInterval(100) took ${(performance.now() - t0).toFixed(0)}ms instead of 10000ms.\n` +
        `Total drift: ${total.toFixed(0)}ms (${(total / 100).toFixed(1)}ms per tick).\n\n` +
        `A countdown built this way loses ${((total / 10000) * 3600).toFixed(0)} seconds per hour.\n` +
        `Correct approach: store a target timestamp, and on each tick compute the remaining time\n` +
        `from Date.now() — never from a tick counter.`;
      log.ok(`total drift ${total.toFixed(0)}ms`);
    }
  }, 100);
}

// ---------------------------------------------------------------------------
// 5. Background tab throttling
//
// Hidden tabs get:
//   - timers clamped to >= 1000ms
//   - after ~5 minutes hidden, "intensive throttling": timers run once per MINUTE, in
//     aligned wake-ups, so the browser can let the CPU sleep
//   - requestAnimationFrame: stopped entirely
//
// Exceptions exist (audio playing, WebRTC, a Web Lock held, recent user interaction).
// ---------------------------------------------------------------------------

function backgroundTest() {
  log.head('— 5. background throttling — switch to another tab for 30 seconds, then come back —');
  out.textContent = 'Switch tabs NOW. Come back after 30+ seconds and read the log.';

  let lastTimer = performance.now();
  let lastRaf = performance.now();
  let rafCount = 0, timerCount = 0;
  const started = performance.now();

  const timer = setInterval(() => {
    const now = performance.now();
    const gap = now - lastTimer;
    lastTimer = now;
    timerCount++;
    if (gap > 250) {
      log.line(`setInterval(200) fired after ${fmt.ms(gap)}  [visibility: ${document.visibilityState}]`,
        gap > 900 ? 'bad' : 'macro');
    }
  }, 200);

  const rafStep = () => {
    const now = performance.now();
    const gap = now - lastRaf;
    lastRaf = now;
    rafCount++;
    if (gap > 100) log.line(`rAF gap ${fmt.ms(gap)}  [visibility: ${document.visibilityState}]`, 'render');
    if (performance.now() - started < 60000) requestAnimationFrame(rafStep);
  };
  requestAnimationFrame(rafStep);

  document.addEventListener('visibilitychange', () => {
    log.line(`visibility → ${document.visibilityState}`, document.hidden ? 'bad' : 'good');
  });

  setTimeout(() => {
    clearInterval(timer);
    const secs = (performance.now() - started) / 1000;
    out.textContent =
      `over ${secs.toFixed(0)}s:\n` +
      `  setInterval(200) fired ${timerCount} times (would be ${Math.round(secs * 5)} if never throttled)\n` +
      `  rAF fired ${rafCount} times (would be ~${Math.round(secs * 60)} if always visible)\n\n` +
      `If you were away for 30s you should see the timer gaps jump to ~1000ms and rAF stop dead.\n` +
      `Stay hidden 5+ minutes and Chrome escalates to one wake-up per minute.`;
    log.ok(`done: ${timerCount} timer fires, ${rafCount} rAF fires in ${secs.toFixed(0)}s`);
  }, 60000);
}

// ---------------------------------------------------------------------------

on('nesting', () => { log.clear(); measureNesting(); });
on('throughput', () => { log.clear(); throughput(); });
on('pileup', () => { log.clear(); pileup(); });
on('drift', () => { log.clear(); drift(); });
on('background', () => { log.clear(); backgroundTest(); });
on('clear', () => { log.clear(); $('results').textContent = ''; out.textContent = 'Start with 1.'; });
