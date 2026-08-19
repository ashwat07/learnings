/** Drill 12 — reference. */

export function createPool({
  create,
  validate = async () => true,
  destroy = async () => {},
  max = 10,
  acquireTimeoutMs = 30_000,
  maxLifetimeMs = Infinity,
}) {
  const idle = [];            // { conn, bornAt }
  const waiters = [];         // { resolve, reject, timer }
  const checkedOut = new Set();
  // Every connection this pool has ever opened and not yet destroyed. `idle` and `checkedOut`
  // both have gaps — a connection popped off idle and awaiting validate() is in NEITHER — so
  // close() needs its own list or it leaks whatever happened to be in flight.
  const alive = new Set();
  let open = 0;               // created + being created. THE counter that must never drift.
  let closed = false;

  const scrap = async (conn) => {
    open--;
    alive.delete(conn);
    try { await destroy(conn); } catch { /* a destroy that throws must not wedge the pool */ }
    // A slot just freed up: either serve a waiter with a fresh connection, or leave the pool
    // smaller than max, which is fine — it refills on demand.
    pump();
  };

  // The single place a connection is handed to somebody. Everything else routes through here.
  async function serve(waiter) {
    while (idle.length) {
      const entry = idle.pop();
      const tooOld = Date.now() - entry.bornAt > maxLifetimeMs;
      // validate() on CHECKOUT, not on release. A connection can die while it sits idle — that
      // is precisely what a database restart, an idle timeout or a load balancer does to it —
      // and the only moment the answer is still true is the moment before you use it.
      if (tooOld || !(await validate(entry.conn).catch(() => false))) {
        await scrap(entry.conn);
        continue;                       // try the next idle one
      }
      // Same again: we awaited, so the world may have changed underneath us.
      if (closed) { await scrap(entry.conn); waiter.reject(new Error('pool is closing')); return true; }
      checkedOut.add(entry.conn);
      waiter.resolve(entry.conn);
      return true;
    }

    if (open < max) {
      open++;                           // reserve the slot BEFORE the await
      try {
        const conn = await create();
        alive.add(conn);
        // close() may have happened while create() was in flight.
        if (closed) { open--; await Promise.resolve(destroy(conn)).catch(() => {}); alive.delete(conn); waiter.reject(new Error('pool is closing')); return true; }
        checkedOut.add(conn);
        waiter.resolve(conn);
        return true;
      } catch (err) {
        // THE DEADLOCK BUG, and the one line that prevents it. If create() throws and you do not
        // give the slot back, every failure while the database is down permanently shrinks the
        // pool. Ten failures and a pool of ten is a pool of zero — which never recovers, even
        // after the database comes back, and looks exactly like a hang.
        open--;
        waiter.reject(err);
        return true;
      }
    }
    return false;                       // full: the waiter stays queued
  }

  // Drain the waiter queue as far as resources allow. FIFO: shift, never pop — a stack starves
  // its oldest waiter forever under sustained load, and that waiter is someone's request.
  let pumping = false;
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (waiters.length && (idle.length || open < max)) {
        const waiter = waiters[0];
        if (waiter.settled) { waiters.shift(); continue; }
        if (!(await serve(waiter))) break;
        waiter.settle();
        waiters.shift();
      }
    } finally { pumping = false; }
  }

  return {
    acquire() {
      if (closed) return Promise.reject(new Error('pool is closed'));
      return new Promise((resolve, reject) => {
        const waiter = { settled: false };
        // A timeout on acquire is not optional. Without it, a leaked connection turns into a
        // process that accepts requests and answers none — no error, no metric, no log line.
        const timer = setTimeout(() => {
          waiter.settled = true;
          reject(Object.assign(new Error(`pool acquire timeout after ${acquireTimeoutMs}ms`), { code: 'EPOOLTIMEOUT' }));
        }, acquireTimeoutMs);
        if (timer.unref) timer.unref();

        waiter.settle = () => { waiter.settled = true; clearTimeout(timer); };
        waiter.resolve = (conn) => { clearTimeout(timer); resolve(conn); };
        waiter.reject = (err) => { clearTimeout(timer); reject(err); };
        waiters.push(waiter);
        pump();
      });
    },

    release(conn) {
      // Guard against the DOUBLE RELEASE — a `finally { release(c) }` plus an explicit release
      // on the happy path. Without this check the same connection is pushed onto idle twice and
      // handed to two callers at once, which is a data-corruption bug wearing a pool's clothes.
      if (!checkedOut.delete(conn)) return;
      if (closed) { scrap(conn); return; }
      idle.push({ conn, bornAt: conn.bornAt ?? Date.now() });
      pump();
    },

    destroy(conn) {
      if (!checkedOut.delete(conn)) return;
      scrap(conn);
    },

    async close() {
      closed = true;
      for (const w of waiters.splice(0)) {
        if (!w.settled) { w.settled = true; w.reject(new Error('pool is closing')); }
      }
      // Let any in-flight pump() finish so it cannot resurrect a connection behind us. It will
      // see `closed` and scrap whatever it was holding.
      while (pumping) await new Promise((r) => setImmediate(r));
      idle.length = 0;
      checkedOut.clear();
      open = 0;
      const all = [...alive];
      alive.clear();
      await Promise.all(all.map((c) => Promise.resolve(destroy(c)).catch(() => {})));
    },

    get stats() { return { open, idle: idle.length, inUse: checkedOut.size, waiting: waiters.length }; },
  };
}

/*
SIZING THE POOL — THE ARITHMETIC NOBODY DOES

    pods x pool_max  <=  postgres max_connections - (superuser_reserved + your admin tools)

Eight pods with a default `max: 10` is 80 connections against a default `max_connections` of 100,
and it works until you scale to twelve pods and everything falls over at once with
"FATAL: sorry, too many clients already". Autoscaling makes this worse: the pool size is per
pod, so your connection count scales with traffic exactly when the database can least afford it.

Bigger is also not faster. Postgres runs a PROCESS per connection; past roughly (2 x cores +
effective_spindles) concurrent queries you are adding context switching, not throughput. A pool
of 10 that queues is usually faster end to end than a pool of 100 that thrashes — and the queue
is visible in your metrics, which the thrashing is not.

If you genuinely need many clients, put PgBouncer in front in TRANSACTION mode and let it
multiplex. The catch: transaction mode breaks session state — prepared statements, LISTEN/NOTIFY,
advisory locks, `SET` — so your client library has to be configured for it.

THE FIVE NUMBERS TO EXPORT AS METRICS
  in use, idle, waiting, acquire wait time (p99), acquire timeouts per minute
"waiting > 0 for a sustained period" means the pool is your bottleneck. "acquire timeouts" means
it already broke. Almost nobody instruments these, and they are the first thing you want when a
service is slow but the database says it is idle.

THE LEAK
A connection acquired and never released is gone forever. In application code the only reliable
shape is:

    const conn = await pool.acquire();
    try { ... } finally { pool.release(conn); }

or, better, a `withConnection(fn)` helper so callers cannot forget — which is why every good
client exposes `pool.query()` and makes you ask for a raw connection.

IN-PROCESS CACHE VS REDIS — THE OTHER HALF OF "POOLING AND CACHING"
An in-process Map is nanoseconds and needs no network, and it is PER POD: eight pods means eight
copies, eight independent TTLs, and no way to invalidate. Use it for things that are small,
hot and tolerant of being briefly stale — compiled templates, feature flags, a config blob.
Use Redis when the value is large, must be consistent across pods, or must be invalidated on
demand. Most services want both: an in-process L1 with a short TTL in front of a Redis L2, which
also absorbs the stampede (caching-and-queues lab 02). Bound the L1 by SIZE, not just time — an
unbounded Map keyed by user id is a memory leak with a hit rate.
*/
