/**
 * detector.js — an in-page leak detector.
 *
 * The premise: you cannot take a heap snapshot in production, and you cannot ask a user to.
 * But you CAN observe the three signals that correlate with leaks — DOM node count, listener
 * count, and heap growth per cycle — and you can register components and check whether they
 * are ever collected.
 *
 * Some of it is written. The interesting parts are TODOs.
 */

// ---------------------------------------------------------------------------
// 1. Cycle measurement — the core technique
// ---------------------------------------------------------------------------

/**
 * Run `action` N times, measuring after each cycle, and fit a line through the results.
 * The SLOPE is the leak: a stable app has a slope near zero, a leaking one has a slope of
 * "N nodes per cycle".
 *
 * Comparing two absolute measurements is much noisier and produces both false positives (lazy
 * initialisation on the first cycle) and false negatives (a GC that happened to run at the
 * right moment).
 */
export async function measureCycles(action, { cycles = 20, warmup = 3, settleMs = 60 } = {}) {
  for (let i = 0; i < warmup; i++) await action();     // let lazy init, JIT and caches settle

  const samples = [];
  for (let i = 0; i < cycles; i++) {
    await action();
    await settle(settleMs);
    samples.push({
      cycle: i,
      nodes: document.getElementsByTagName('*').length,
      heap: performance.memory?.usedJSHeapSize ?? 0,
      listeners: listenerCount(),
    });
  }

  return {
    samples,
    slope: {
      nodes: slopeOf(samples.map((s) => s.nodes)),
      heap: slopeOf(samples.map((s) => s.heap)),
      listeners: slopeOf(samples.map((s) => s.listeners)),
    },
  };
}

/** Ordinary least squares slope of y against its index. */
export function slopeOf(ys) {
  const n = ys.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - meanX) * (ys[i] - meanY); den += (i - meanX) ** 2; }
  return num / den;
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 2. Listener counting — patch addEventListener in dev
// ---------------------------------------------------------------------------

let listeners = 0;
const listenerStacks = new Map();       // key -> { count, stack }

export function installListenerCounter() {
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;

  EventTarget.prototype.addEventListener = function (type, fn, options) {
    listeners++;
    // Only track the long-lived targets — listeners on a node that will be discarded with it
    // are not a leak (lab 02).
    if (this === window || this === document || this === document.body) {
      const stack = new Error().stack?.split('\n').slice(2, 5).join('\n') ?? '';
      const key = `${type}\n${stack}`;
      const entry = listenerStacks.get(key) ?? { count: 0, type, stack, signalled: false };
      entry.count++;
      entry.signalled = Boolean(options?.signal);
      listenerStacks.set(key, entry);
    }
    return add.call(this, type, fn, options);
  };

  EventTarget.prototype.removeEventListener = function (...args) {
    listeners--;
    return remove.call(this, ...args);
  };
}

export const listenerCount = () => listeners;

/**
 * TODO 1 — make the listener report useful.
 *
 * Return the registration sites on window/document sorted by count, flagging any that were
 * registered WITHOUT an AbortSignal. That flag alone finds most listener leaks before they
 * ever grow.
 *
 * Careful: this counter is wrong when a listener is removed by an AbortSignal, because that
 * path does not call removeEventListener. Decide how to handle it — hook the signal's abort
 * event, or count only signalled registrations separately and document the imprecision.
 * Do not ship a number you cannot explain.
 */
export function listenerReport() {
  throw new Error('TODO 1: implement listenerReport() in detector.js');
}

// ---------------------------------------------------------------------------
// 3. Component liveness — is anything ever actually collected?
// ---------------------------------------------------------------------------

const live = new Map();                 // id -> { name, mountedAt, unmountedAt }
const registry = typeof FinalizationRegistry !== 'undefined'
  ? new FinalizationRegistry((id) => {
    const entry = live.get(id);
    if (entry) { entry.collectedAt = Date.now(); }
  })
  : null;

export function trackMount(name, instance) {
  const id = `${name}#${Math.random().toString(36).slice(2, 8)}`;
  live.set(id, { name, mountedAt: Date.now() });
  registry?.register(instance, id);
  return id;
}

export function trackUnmount(id) {
  const entry = live.get(id);
  if (entry) entry.unmountedAt = Date.now();
}

/**
 * TODO 2 — the suspicion report.
 *
 * Return components that were unmounted more than `olderThanMs` ago and have NOT been
 * collected, grouped by name with counts.
 *
 * Then write down, in a comment, why this is evidence and not proof:
 *   - FinalizationRegistry callbacks are best-effort and may simply not have run yet
 *   - the GC may not have run at all if there is no memory pressure
 *   - a false positive here costs a developer an hour, so the report must say how confident
 *     it is and what would confirm it (a heap snapshot filtered to that constructor)
 */
export function suspicionReport({ olderThanMs = 10_000 } = {}) {
  throw new Error('TODO 2: implement suspicionReport() in detector.js');
}

/**
 * TODO 3 — field measurement.
 *
 * performance.measureUserAgentSpecificMemory() gives a real, cross-realm memory breakdown
 * (including workers and iframes) — but it requires cross-origin isolation and it may take
 * seconds to resolve, because it waits for a GC.
 *
 * Implement `sampleMemory()` that:
 *   - uses measureUserAgentSpecificMemory() when available (check crossOriginIsolated)
 *   - falls back to performance.memory (Chrome, coarse, main-thread only)
 *   - returns a normalised { bytes, breakdown, source, confidence }
 *   - never runs more than once per N minutes, and never during an interaction
 *
 * Then decide what you would actually SEND to your telemetry: memory against session length,
 * bucketed by route, is the field signature of a leak. Raw bytes per user is noise.
 */
export async function sampleMemory() {
  throw new Error('TODO 3: implement sampleMemory() in detector.js');
}

export const state = { live, listenerStacks };
