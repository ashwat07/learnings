/** The world drill 06 runs against. */

/** A connection pool with exactly 4 slots. Forget to release one and everything after it hangs. */
export function makePool(size = 4) {
  let inUse = 0, acquired = 0, released = 0;
  const waiters = [];
  return {
    async acquire() {
      acquired++;
      if (inUse >= size) await new Promise((r) => waiters.push(r));
      inUse++;
      return { id: acquired };
    },
    release() {
      released++; inUse--;
      const next = waiters.shift();
      if (next) next();
    },
    get stats() { return { inUse, acquired, released, waiting: waiters.length }; },
  };
}

/**
 * A cancellable I/O operation, in the shape every real client library has: it gives you a promise
 * and a way to stop it. Wiring an AbortSignal to that `cancel` is your job — nothing does it for
 * you, and a signal you never connect is decoration.
 */
export function makeIo() {
  let cancelled = 0;
  const io = (ms, value) => {
    let timer, reject_;
    const promise = new Promise((resolve, reject) => {
      reject_ = reject;
      timer = setTimeout(() => resolve(value), ms);
    });
    return {
      promise,
      cancel(reason) {
        cancelled++;
        clearTimeout(timer);
        reject_(reason ?? new Error('cancelled'));
      },
    };
  };
  io.cancelledCount = () => cancelled;
  return io;
}
