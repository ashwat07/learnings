/**
 * fast-dom.js — a cross-module read/write scheduler.
 *
 * Modules hand their geometry reads to measure() and their DOM writes to mutate(). The
 * scheduler runs every queued read before every queued write, inside ONE rAF, so the browser
 * sees R R R W W W and lays out once per frame — no matter how many unrelated modules queued
 * work, and without any of them knowing about each other.
 *
 *   const w = await fastdom.measure(() => el.offsetWidth);
 *   fastdom.mutate(() => { el.style.width = w * 2 + 'px'; });
 *   fastdom.clear(handle);
 */

const GEOMETRY_PROPS = [
  ['Element', 'clientWidth'], ['Element', 'clientHeight'],
  ['Element', 'clientTop'], ['Element', 'clientLeft'],
  ['Element', 'scrollWidth'], ['Element', 'scrollHeight'],
  ['Element', 'scrollTop'], ['Element', 'scrollLeft'],
  ['HTMLElement', 'offsetWidth'], ['HTMLElement', 'offsetHeight'],
  ['HTMLElement', 'offsetTop'], ['HTMLElement', 'offsetLeft'],
  ['HTMLElement', 'offsetParent'],
];
const GEOMETRY_METHODS = [
  ['Element', 'getBoundingClientRect'], ['Element', 'getClientRects'],
];

/** Which phase the scheduler is draining. Module-level so the dev guard can see it. */
let phase = null;
let guardInstalled = false;

export class CancelledError extends Error {
  constructor(id) {
    super(`FastDom task ${id} was cancelled`);
    this.name = 'CancelledError';
  }
}

/**
 * Dev guard: patch the geometry getters once and complain if anything reads during the mutate
 * phase. A read there forces a layout and undoes the batching, which is the exact bug this
 * scheduler exists to prevent — and it's invisible without instrumentation.
 */
function installGuard() {
  if (guardInstalled || typeof window === 'undefined') return;
  guardInstalled = true;

  const complain = (what) => {
    if (phase !== 'mutate') return;
    console.warn(
      `[FastDom] geometry read (${what}) inside the mutate phase — this forces a synchronous ` +
      `layout and undoes the batching. Move the read into fastdom.measure().`,
      new Error().stack
    );
  };

  for (const [ctor, prop] of GEOMETRY_PROPS) {
    const C = window[ctor];
    const desc = C && Object.getOwnPropertyDescriptor(C.prototype, prop);
    if (!desc || !desc.get) continue;
    Object.defineProperty(C.prototype, prop, {
      ...desc,
      get() { complain(prop); return desc.get.call(this); },
    });
  }

  for (const [ctor, method] of GEOMETRY_METHODS) {
    const C = window[ctor];
    if (!C || typeof C.prototype[method] !== 'function') continue;
    const orig = C.prototype[method];
    C.prototype[method] = function (...args) { complain(method); return orig.apply(this, args); };
  }

  const origComputed = window.getComputedStyle;
  window.getComputedStyle = function (...args) {
    complain('getComputedStyle');
    return origComputed.apply(this, args);
  };
}

export class FastDom {
  constructor({ dev = true } = {}) {
    this._reads = [];
    this._writes = [];
    this._scheduled = false;
    this._nextId = 1;
    this._dev = dev;
    if (dev) installGuard();
  }

  /** Queue a read. Resolves with the callback's return value. */
  measure(cb) {
    if (this._dev && phase === 'mutate') {
      console.warn(
        '[FastDom] measure() queued from inside the mutate phase — it runs NEXT frame, not this ' +
        'one. Running it now would read a tree the write phase just dirtied.',
        new Error().stack
      );
    }
    return this._enqueue(this._reads, cb);
  }

  /** Queue a write. Resolves with the callback's return value. */
  mutate(cb) {
    return this._enqueue(this._writes, cb);
  }

  /**
   * Cancel a queued task. Takes the handle returned by measure/mutate, or its raw id.
   * Returns false if the task already ran (or never existed).
   */
  clear(handle) {
    const id = handle && typeof handle === 'object' ? handle.id : handle;
    for (const queue of [this._reads, this._writes]) {
      const task = queue.find(t => t.id === id);
      if (!task || task.cancelled) continue;
      // Tombstone rather than splice — the drain may be iterating this array right now.
      task.cancelled = true;
      // Always settle. A cancelled task whose promise stays pending hangs every awaiter.
      task.reject(new CancelledError(id));
      return true;
    }
    return false;
  }

  get phase() { return phase; }

  _enqueue(queue, cb) {
    const task = { id: this._nextId++, cb, cancelled: false };
    const promise = new Promise((resolve, reject) => {
      task.resolve = resolve;
      task.reject = reject;
    });
    // Fire-and-forget is the common case for mutate(), so a throw or a clear() would otherwise
    // surface as an unhandledrejection. This no-op marks the rejection handled; a caller's own
    // .catch() still fires, because it attaches to `promise` independently.
    promise.catch(() => {});
    queue.push(task);
    this._schedule();
    return Object.assign(promise, { id: task.id });
  }

  _schedule() {
    if (this._scheduled) return;
    this._scheduled = true;
    requestAnimationFrame(() => this._flush());
  }

  /** One frame: every queued read, then every queued write. */
  _flush() {
    try {
      // Snapshot and swap. Work queued *during* a drain lands in the next frame instead of
      // being spliced into the pass we're iterating — the same reason a rAF registered inside
      // a rAF callback runs on the following frame.
      const reads = this._reads;
      this._reads = [];
      phase = 'measure';
      this._run(reads, 'measure');

      // Snapshot the writes only now, AFTER the reads ran, so a mutate() queued from inside a
      // measure() callback — the canonical pattern — still lands in this frame. Reads are all
      // done by this point, so it cannot reintroduce the interleave.
      const writes = this._writes;
      this._writes = [];
      phase = 'mutate';
      this._run(writes, 'mutate');
    } finally {
      phase = null;
      this._scheduled = false;
      // Anything queued mid-drain hit the early return in _schedule(). Pick it up now.
      if (this._reads.length || this._writes.length) this._schedule();
    }
  }

  _run(tasks, label) {
    for (const task of tasks) {
      if (task.cancelled) continue;
      try {
        task.resolve(task.cb());
      } catch (err) {
        // One bad widget must not blank the page: reject its promise and keep draining.
        task.reject(err);
        console.error(`[FastDom] ${label} callback threw — remaining tasks still ran`, err);
      }
    }
  }
}

// Shared singleton — cross-module batching only works if everyone queues into the same instance.
export default new FastDom();
