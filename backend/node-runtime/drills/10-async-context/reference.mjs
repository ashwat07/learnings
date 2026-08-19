/** Drill 10 — reference. */

import { AsyncLocalStorage } from 'node:async_hooks';

export function createContext() {
  const als = new AsyncLocalStorage();

  return {
    // run() is the only way in. Everything called from fn — synchronously, after an await, in a
    // timer, in an event listener, in a stream callback — sees this store and no other.
    run(store, fn) {
      // A Map rather than the caller's object, so set() cannot mutate something the caller still
      // holds, and so a nested run() genuinely gets its own container.
      return als.run(new Map(Object.entries(store ?? {})), fn);
    },

    get(key) {
      // getStore() is undefined outside any run(). Returning undefined rather than throwing is
      // the right default: a library function must work whether or not it was called inside a
      // request — a cron job, a startup task, a test.
      return als.getStore()?.get(key);
    },

    set(key, value) {
      const store = als.getStore();
      if (store) store.set(key, value);
      // Silently ignored outside a run. The alternative — writing to a module-level fallback —
      // is the bug this drill is about, reintroduced as a convenience.
    },
  };
}

export function createLogger(ctx, sink) {
  const emit = (level) => (msg, fields = {}) => {
    const requestId = ctx.get('requestId');
    // Note the ordering: context first, caller's fields last, so an explicit field wins. And
    // requestId is only present when there is one — no `"requestId": null` on startup logs.
    sink({ level, msg, ...(requestId === undefined ? {} : { requestId }), ...fields });
  };
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}

/*
HOW IT ACTUALLY WORKS

AsyncLocalStorage sits on async_hooks, which is V8 and libuv telling Node "this callback was
scheduled by that operation". Node maintains a tree of asynchronous resources, and the store is
attached to a subtree. When a continuation runs, the runtime restores the store that was active
when the continuation was CREATED — not when it runs. That is the whole trick, and it is why no
amount of userland cleverness can reproduce it.

This is the same mechanism as Go's context.Context, arrived at from the opposite direction: Go
made you pass it explicitly and Node made it ambient. Both trade-offs are real. Go's is more
honest and noisier; Node's is invisible and occasionally surprising.

WHERE IT GOES IN A REAL SERVICE

	const ctx = createContext();

	app.use((req, res, next) => {
	  ctx.run({ requestId: req.headers['x-request-id'] ?? randomUUID(), userId: null }, next);
	});

One middleware, at the top, and now every log line, every SQL query comment, every outbound
header can carry the request id without a single function signature changing. This is what
OpenTelemetry's Node auto-instrumentation uses to propagate a span across an await, and what
Pino's `pino-http` uses for child loggers.

WHAT TO PUT IN IT
  requestId, trace/span id, authenticated user and tenant, locale, feature flags evaluated once,
  a per-request DataLoader cache.

WHAT NOT TO PUT IN IT
  · a database handle or config — those are dependencies, and hiding them makes the code
    untestable and the dependency graph invisible
  · anything a function NEEDS to be correct. If the function cannot work without it, it is a
    parameter. Context is for cross-cutting metadata, not for arguments you did not feel like
    passing. This is the exact same rule as Go's context.Value, and it is broken for the exact
    same reason: convenience.

THE COSTS, HONESTLY
  · async_hooks has a measurable overhead. It was significant enough to matter in Node 12-14;
    since ~16 AsyncLocalStorage uses a faster path and the cost is small, but "small" is not
    "zero" and it applies to every async operation in the process.
  · it does not cross a worker_thread or a child process boundary. Serialise the id and re-enter
    run() on the other side — exactly as you would across an HTTP hop.
  · a store captured by a long-lived object (a cache entry, a module-level array, an emitter
    listener you never remove) is retained forever, taking the whole request's data with it.
    That is what the last check measures.
  · `als.enterWith(store)` exists and looks simpler. Avoid it: it mutates the CURRENT execution
    context rather than scoping to a callback, so its effects escape upward in ways that are
    genuinely hard to reason about. `run()` unless you have no choice.
*/
