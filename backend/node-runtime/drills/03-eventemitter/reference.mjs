/** Drill 03 — reference. */

const MAX_LISTENERS = 10;

export class Emitter {
  #events = new Map();
  #warned = new Set();

  on(name, fn) {
    if (typeof fn !== 'function') throw new TypeError('listener must be a function');
    const list = this.#events.get(name);
    if (list) list.push(fn); else this.#events.set(name, [fn]);

    // Warn ONCE per event name, not once per listener — otherwise a genuine leak buries the log
    // in the very warning that was supposed to help you find it.
    const n = this.#events.get(name).length;
    if (n > MAX_LISTENERS && !this.#warned.has(name)) {
      this.#warned.add(name);
      const w = new Error(
        `Possible EventEmitter memory leak detected. ${n} ${String(name)} listeners added. ` +
        `Use emitter.setMaxListeners() to increase limit`);
      w.name = 'MaxListenersExceededWarning';
      w.emitter = this; w.type = name; w.count = n;
      process.emitWarning(w);
    }
    return this;
  }

  once(name, fn) {
    // The wrapper keeps a reference to the original so off(name, originalFn) can find it. Without
    // this, `once` listeners are unremovable — a real leak in more than one npm package.
    const wrapper = (...args) => { this.off(name, wrapper); fn.apply(this, args); };
    wrapper.listener = fn;
    return this.on(name, wrapper);
  }

  off(name, fn) {
    const list = this.#events.get(name);
    if (!list) return this;
    // indexOf + splice, not filter: remove exactly ONE registration. `on(x, fn)` twice means the
    // listener genuinely fires twice, and one `off` must undo one `on`. filter() removes both.
    // Search from the END so that removing during an emit removes the most recent registration,
    // which is what Node does.
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] === fn || list[i].listener === fn) {
        list.splice(i, 1);
        break;
      }
    }
    if (list.length === 0) { this.#events.delete(name); this.#warned.delete(name); }
    return this;
  }

  emit(name, ...args) {
    const list = this.#events.get(name);

    if (!list || list.length === 0) {
      // An 'error' event with nobody listening is not "nothing happened" — it is an error that
      // has been thrown away. Rethrowing is what turns a silent data-loss bug into a stack trace.
      if (name === 'error') {
        const err = args[0];
        throw err instanceof Error ? err : Object.assign(new Error('Unhandled error.'), { context: err });
      }
      return false;
    }

    // COPY THE ARRAY. This one line is most of the drill.
    //   · a listener that removes a later listener: without the copy, splice shifts the array and
    //     the for-loop skips the element that moved into the vacated index.
    //   · a listener that adds a listener: without the copy, the new one is visited in this same
    //     emit, which makes `emitter.on('x', () => emitter.on('x', ...))` an infinite loop.
    // Copying gives you SNAPSHOT semantics: emit calls exactly the listeners registered when it
    // started. Removals still take effect — see below.
    const snapshot = list.slice();
    for (const fn of snapshot) {
      // ...but honour removals: if a listener removed this one before we reached it, skip it.
      // Node does this by walking the live array with an index; the copy plus this check is the
      // same semantics, written so both halves are visible.
      if (!list.includes(fn)) continue;
      fn.apply(this, args);
    }
    return true;
  }

  listenerCount(name) { return (this.#events.get(name) ?? []).length; }
  listeners(name) { return (this.#events.get(name) ?? []).map((f) => f.listener ?? f); }
  eventNames() { return [...this.#events.keys()]; }
  removeAllListeners(name) {
    if (name === undefined) this.#events.clear(); else this.#events.delete(name);
    return this;
  }
}

/*
THE FOUR DECISIONS, AND WHY THEY ARE THE WAY THEY ARE

1. emit is SYNCHRONOUS. Listeners run before emit() returns, on the same stack. This is why an
   exception in a listener propagates out of the emit() call — which surprises people who assume
   an event bus decouples the caller from the callee. It does not. If you need decoupling, you
   need a queue (jobs-and-messaging), not an emitter.

2. Snapshot the listener array. Removing during iteration is the array-splice bug; adding during
   iteration is the infinite-loop bug. Both are invisible until a listener does something
   conditional, at which point you get a heisenbug in production.

3. off removes ONE. Symmetry with on: n calls to on need n calls to off. `filter` is the natural
   thing to write and it is wrong.

4. Unhandled 'error' throws. Every stream, socket and child process in Node relies on this. The
   corollary you have to live with: ALWAYS attach an 'error' listener to anything that can emit
   one, including a stream you are about to destroy, or an unrelated failure will take the
   process down.

THE LEAK WARNING IS A REAL DIAGNOSTIC
Ten is arbitrary, and the warning is almost never wrong about there being a problem. The usual
cause is registering a listener per request on a long-lived emitter — a database pool, a config
object, process itself — and never removing it. If you legitimately need more, call
setMaxListeners(n) on that one emitter, never on the global default: raising the global limit
silences the diagnostic everywhere and leaves the leak in place.

The modern alternative for the request-scoped case is an AbortSignal:
  emitter.on('tick', fn, { signal })  — Node removes it for you when the signal aborts.
Drill 06 is about the version of that problem you cannot delegate.
*/
