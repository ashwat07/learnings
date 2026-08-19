/**
 * Drill 10 — request context.
 *
 * The starting point is the module-level variable, and it is worth understanding exactly why it
 * fails rather than just knowing that it does.
 *
 * It is not a race in the threading sense — there is one thread. It fails because `current` is
 * set when a request STARTS and read after an `await`, and between those two moments the event
 * loop ran every other pending request's continuation. By the time you read it, `current` holds
 * whichever request happened to start most recently. With one request at a time it is correct.
 * Under load it is a data-disclosure bug: request A's tenant id on request B's query.
 *
 *   createContext() -> { run(store, fn), get(key), set(key, value) }
 *   createLogger(ctx, sink) -> { info(msg, fields) }   // stamps requestId with no argument
 *
 * The tool is node:async_hooks' AsyncLocalStorage. It is the only correct answer here — you
 * cannot build this out of promises, because the thing you need to track is "which logical
 * operation is this continuation part of", and only the runtime knows that.
 */

let current = {};

export function createContext() {
  return {
    async run(store, fn) {
      current = { ...store };
      return fn();
    },
    get(key) {
      return current[key];
    },
    set(key, value) {
      current[key] = value;
    },
  };
}

export function createLogger(ctx, sink) {
  return {
    info(msg, fields = {}) {
      sink({ level: 'info', msg, requestId: ctx.get('requestId'), ...fields });
    },
  };
}
