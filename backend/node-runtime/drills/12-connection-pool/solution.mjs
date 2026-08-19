/**
 * Drill 12 — the connection pool.
 *
 * The starting point handles the happy path and nothing else, which is exactly how much of a pool
 * you can write from memory. Every check below is a real failure mode:
 *
 *   · the pool hands out more than max, because release() was called twice
 *   · acquire() hangs forever instead of failing, so the outage has no error in the logs
 *   · a connection killed by a database restart is handed out to the next caller
 *   · create() throws while the database is down and the pool never works again, even after it
 *     comes back — the slot was consumed and nobody gives it back
 *
 * A pool is not a cache of objects. It is a SEMAPHORE with objects attached, and almost every bug
 * is in the semaphore half.
 */

export function createPool({ create, validate, destroy, max = 10, acquireTimeoutMs = 30_000, maxLifetimeMs }) {
  const idle = [];
  let open = 0;

  return {
    async acquire() {
      if (idle.length) return idle.pop();
      if (open < max) {
        open++;
        return create();
      }
      // wait for one
      return new Promise((resolve) => {
        const check = () => {
          if (idle.length) resolve(idle.pop());
          else setTimeout(check, 5);
        };
        check();
      });
    },

    release(conn) {
      idle.push(conn);
    },

    destroy(conn) {
      destroy(conn);
    },

    async close() {
      for (const c of idle) await destroy(c);
      idle.length = 0;
    },
  };
}
