/**
 * Drill 03 — EventEmitter.
 *
 * The starting point below is the version that appears in a thousand blog posts. It passes the
 * three obvious tests and fails half the checks, which is the point: EventEmitter is not a Map of
 * arrays, it is a Map of arrays plus a set of decisions about what happens when the array changes
 * while you are walking it.
 *
 * API to implement:
 *   on(name, fn)      -> this          register
 *   once(name, fn)    -> this          register, auto-remove after the first call
 *   off(name, fn)     -> this          remove ONE registration of fn (including a once)
 *   emit(name, ...a)  -> boolean       call them, synchronously, in order; true if any ran
 *   listenerCount(n)  -> number
 *
 * Plus two behaviours that are not in the signatures:
 *   · emit('error', err) with no 'error' listener must THROW err. This is why an unhandled
 *     'error' event crashes a Node process, and it is deliberate: a silently dropped error event
 *     on a socket or a stream is how you lose data.
 *   · the 11th listener on one event of one emitter should emit a MaxListenersExceededWarning
 *     via process.emitWarning — see the reference for the exact shape.
 */

export class Emitter {
  constructor() {
    this.events = new Map();
  }

  on(name, fn) {
    if (!this.events.has(name)) this.events.set(name, []);
    this.events.get(name).push(fn);
    return this;
  }

  once(name, fn) {
    const wrapper = (...args) => {
      this.off(name, wrapper);
      fn(...args);
    };
    return this.on(name, wrapper);
  }

  off(name, fn) {
    const list = this.events.get(name);
    if (list) this.events.set(name, list.filter((l) => l !== fn));
    return this;
  }

  emit(name, ...args) {
    const list = this.events.get(name);
    if (!list || list.length === 0) return false;
    for (const fn of list) fn(...args);
    return true;
  }

  listenerCount(name) {
    return (this.events.get(name) ?? []).length;
  }
}
