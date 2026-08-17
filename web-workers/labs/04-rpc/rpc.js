/**
 * rpc.js — make a worker look like a normal module.
 *
 *   // worker
 *   expose({ async search(q) { … } });
 *
 *   // page
 *   const api = wrap(new Worker('./worker.js', { type: 'module' }));
 *   const hits = await api.search('ada');
 *
 * The core (a Proxy + a correlation id) is implemented. The parts that make it usable in
 * production are TODOs — and they are the parts that make Comlink 900 lines instead of 40.
 */

// ---------------------------------------------------------------------------
// Page side
// ---------------------------------------------------------------------------

export function wrap(worker) {
  let seq = 0;
  const pending = new Map();

  worker.addEventListener('message', (e) => {
    const { id, ok, value, error } = e.data || {};
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);

    if (ok) entry.resolve(value);
    // TODO 1 — error propagation.
    // An Error does structured-clone (message, name and stack survive), but a CUSTOM error
    // class arrives as a plain Error: the prototype is lost, so `err instanceof NotFoundError`
    // is false and any extra fields you set are... check for yourself.
    // Reconstruct a useful error here: preserve name, message, the worker-side stack, and any
    // enumerable own properties, and mark it so callers can tell it crossed a thread boundary.
    else entry.reject(error);
  });

  // Any uncaught worker error must fail every in-flight call, or they hang forever.
  worker.addEventListener('error', (e) => {
    for (const { reject } of pending.values()) reject(new Error(`worker error: ${e.message}`));
    pending.clear();
  });

  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return undefined;          // so `await api` doesn't recurse forever
      if (prop === '__worker') return worker;

      return (...args) => new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });

        // TODO 2 — transferables.
        // Scan `args` for transferable objects (ArrayBuffer, ImageBitmap, OffscreenCanvas,
        // MessagePort, ReadableStream) and pass them in the transfer list, so a 50MB buffer
        // costs nothing instead of being copied. Decide: automatic detection, or an explicit
        // `api.method(transfer(buf))` marker like Comlink uses? Write down why you chose it —
        // automatic transfer is convenient and surprising (the caller's buffer is silently
        // detached), explicit is verbose and honest.
        worker.postMessage({ id, prop, args });
      });
    },
  });
}

/**
 * TODO 3 — callbacks.
 *
 * `api.search(q, onProgress)` cannot work as written: functions are not cloneable, so the call
 * throws DataCloneError. Implement it: create a MessageChannel per callback, send one port to
 * the worker (transferable), and invoke the local function when the port receives a message.
 * Remember to close the port when the call settles, or you have leaked a port and everything
 * the callback closes over — a leak that survives page navigation inside the worker.
 */
export function proxyCallback(fn) {
  throw new Error('TODO 3: implement proxyCallback in rpc.js');
}

// ---------------------------------------------------------------------------
// Worker side
// ---------------------------------------------------------------------------

export function expose(api, scope = self) {
  scope.addEventListener('message', async (e) => {
    const { id, prop, args } = e.data || {};
    if (id == null) return;

    try {
      const fn = api[prop];
      if (typeof fn !== 'function') throw new TypeError(`no exposed method "${prop}"`);
      const value = await fn.apply(api, args);

      // TODO 4 — transfer the RESULT.
      // The return leg has the same problem as the argument leg. Detect transferables in
      // `value` (or accept a marker) and pass them in the transfer list.
      scope.postMessage({ id, ok: true, value });
    } catch (err) {
      scope.postMessage({
        id,
        ok: false,
        error: { name: err.name, message: err.message, stack: err.stack },
      });
    }
  });
}

/**
 * TODO 5 — cancellation.
 *
 * Give every call an AbortSignal: `api.search(q, { signal })`. The signal cannot be cloned, so
 * you need a protocol: send a `cancel` message with the call id, have the worker check a
 * per-call flag between slices, and reject the caller's promise with an AbortError.
 *
 * Then handle the ugly case from Lab 03: a worker stuck in a synchronous loop never sees the
 * cancel. Decide what your RPC layer does about that — and whether "terminate and respawn" is
 * something a transparent RPC wrapper is even allowed to do on the caller's behalf.
 */
