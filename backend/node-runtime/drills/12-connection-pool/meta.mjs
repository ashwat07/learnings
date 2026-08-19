export const title = 'A connection pool that survives the database restarting';
export const task = `Postgres allows 100 connections. Your service has 8 pods. Do the arithmetic
before you set max, because the failure is not "slow" — it is "FATAL: sorry, too many clients".

Implement createPool({ create, validate, destroy, max, acquireTimeoutMs, maxLifetimeMs }):

  acquire()          -> Promise<conn>   wait if the pool is full; TIME OUT rather than hang
  release(conn)                          return it for reuse
  destroy(conn)                          it is broken; throw it away and let the pool refill
  close()            -> Promise          destroy everything, reject anyone still waiting

The checks are all failure modes, because a pool that works on the happy path is twenty lines and
every one of the interesting bugs happens the day your database restarts.`;
export const passIf = 'connections are reused and bounded, waiters are FIFO and time out, broken and stale connections are retired, and a failing create() does not deadlock the pool';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A pool that hangs instead of failing is the exact bug this drill is about, so no check is
// allowed to hang waiting for one.
const HANG = 'HUNG — acquire() never settled';
const deadline = (p, ms = 1200) => Promise.race([
  Promise.resolve(p),
  sleep(ms).then(() => { throw new Error(HANG); }),
]);

function world({ failCreate = 0, createDelay = 0 } = {}) {
  let nextId = 1;
  const w = { created: 0, destroyed: 0, live: new Set(), validateCalls: 0 };
  let toFail = failCreate;
  return {
    w,
    async create() {
      if (createDelay) await sleep(createDelay);
      if (toFail > 0) { toFail--; throw new Error('ECONNREFUSED'); }
      w.created++;
      const conn = { id: nextId++, ok: true, bornAt: Date.now() };
      w.live.add(conn);
      return conn;
    },
    async validate(conn) { w.validateCalls++; return conn.ok === true; },
    async destroy(conn) { w.destroyed++; w.live.delete(conn); },
  };
}

export async function check(s) {
  if (typeof s.createPool !== 'function') return [{ check: 'exports createPool(options)', actual: 'missing', pass: false }];
  const out = [];
  const guard = async (label, fn) => {
    try { const r = await fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 60), pass: false }); }
  };

  await guard('200 acquires over a pool of 4 create at most 4 connections', async () => {
    const { w, ...hooks } = world();
    const pool = s.createPool({ ...hooks, max: 4, acquireTimeoutMs: 2000 });
    let peak = 0, live = 0;
    await Promise.all(Array.from({ length: 200 }, async () => {
      const c = await pool.acquire();
      live++; peak = Math.max(peak, live);
      await sleep(2);
      live--;
      pool.release(c);
    }));
    await pool.close?.();
    return (w.created <= 4 && peak <= 4) || `created ${w.created}, peak in-use ${peak}`;
  });

  await guard('...and it really does use all 4, not 1', async () => {
    const { w, ...hooks } = world();
    const pool = s.createPool({ ...hooks, max: 4, acquireTimeoutMs: 2000 });
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 20 }, async () => {
      const c = await pool.acquire();
      await sleep(20);
      pool.release(c);
    }));
    const ms = Date.now() - t0;
    await pool.close?.();
    return (ms < 200 && w.created === 4) || `${ms}ms for 20x20ms at concurrency 4 (created ${w.created})`;
  });

  await guard('waiters are served FIFO', async () => {
    const { w, ...hooks } = world();
    const pool = s.createPool({ ...hooks, max: 1, acquireTimeoutMs: 3000 });
    const held = await deadline(pool.acquire());
    const order = [];
    const waiters = [1, 2, 3, 4].map((n) => pool.acquire().then((c) => { order.push(n); setTimeout(() => pool.release(c), 5); }));
    await sleep(20);
    pool.release(held);
    await Promise.all(waiters);
    await pool.close?.();
    return order.join('') === '1234' || `served in order ${order.join('')}`;
  });

  await guard('acquire() times out instead of hanging forever', async () => {
    const { w, ...hooks } = world();
    const pool = s.createPool({ ...hooks, max: 1, acquireTimeoutMs: 120 });
    const held = await deadline(pool.acquire());
    const t0 = Date.now();
    let err = null;
    try { await deadline(pool.acquire(), 1000); } catch (e) { err = e; }
    const ms = Date.now() - t0;
    pool.release(held);
    await pool.close?.();
    if (!err) return 'it eventually resolved — a hung acquire is an outage with no error in the logs';
    if (err.message === HANG) return 'it never settled — a hung acquire is an outage with no error in the logs';
    return (ms >= 100 && ms < 400 && /timeout|timed out/i.test(err.message)) || `${ms}ms, error ${err.message}`;
  });

  await guard('a timed-out waiter does not steal the next connection', async () => {
    const { w, ...hooks } = world();
    const pool = s.createPool({ ...hooks, max: 1, acquireTimeoutMs: 80 });
    const held = await deadline(pool.acquire());
    const doomed = pool.acquire().then(() => 'resolved', () => 'rejected');
    await sleep(140);
    pool.release(held);
    const survivor = await Promise.race([pool.acquire().then(() => 'got one'), sleep(400).then(() => 'STARVED')]);
    await Promise.race([doomed, sleep(300)]);
    await pool.close?.();
    return survivor === 'got one' || 'the released connection went to a waiter that had already given up';
  });

  await guard('destroy() retires a broken connection and the pool refills', async () => {
    const { w, ...hooks } = world();
    const pool = s.createPool({ ...hooks, max: 2, acquireTimeoutMs: 1000 });
    const a = await deadline(pool.acquire());
    const b = await deadline(pool.acquire());
    pool.destroy(a);                       // "this socket is dead"
    pool.release(b);
    const c = await deadline(pool.acquire());
    const d = await deadline(pool.acquire());
    pool.release(c); pool.release(d);
    await pool.close?.();
    return (w.destroyed >= 1 && w.created === 3) ||
      `destroyed ${w.destroyed}, created ${w.created} (want a replacement to be made)`;
  });

  await guard('validate() runs on checkout and an invalid connection is replaced', async () => {
    const { w, ...hooks } = world();
    const pool = s.createPool({ ...hooks, max: 1, acquireTimeoutMs: 1000 });
    const a = await deadline(pool.acquire());
    a.ok = false;                          // the database restarted while it sat idle
    pool.release(a);
    const b = await deadline(pool.acquire());
    await pool.close?.();
    if (w.validateCalls === 0) return 'validate() was never called — every pooled connection is a guess';
    return (b !== a && b.ok === true && w.destroyed >= 1) || `handed back the dead connection (${b === a})`;
  });

  await guard('a connection past maxLifetime is retired', async () => {
    const { w, ...hooks } = world();
    const pool = s.createPool({ ...hooks, max: 1, acquireTimeoutMs: 1000, maxLifetimeMs: 60 });
    const a = await deadline(pool.acquire());
    pool.release(a);
    await sleep(90);
    const b = await deadline(pool.acquire());
    await pool.close?.();
    return (b !== a && w.created === 2) || 'the same connection came back after its lifetime expired';
  });

  await guard('a failing create() rejects the caller and does NOT leak the slot', async () => {
    const { w, ...hooks } = world({ failCreate: 2 });
    const pool = s.createPool({ ...hooks, max: 2, acquireTimeoutMs: 400 });
    const errs = [];
    for (let i = 0; i < 2; i++) { try { await pool.acquire(); } catch (e) { errs.push(e.message); } }
    // The database comes back. The pool must still be able to open connections.
    const recovered = await Promise.race([
      pool.acquire().then(() => 'recovered', (e) => `still broken: ${e.message}`),
      sleep(900).then(() => 'DEADLOCKED — the failed creates permanently consumed the pool'),
    ]);
    await pool.close?.();
    return (errs.length === 2 && recovered === 'recovered') || `errors=${errs.length}, then ${recovered}`;
  });

  await guard('releasing the same connection twice does not corrupt the pool', async () => {
    const { w, ...hooks } = world();
    const pool = s.createPool({ ...hooks, max: 2, acquireTimeoutMs: 500 });
    const a = await deadline(pool.acquire());
    pool.release(a);
    pool.release(a);                       // the bug: a `finally` plus an explicit release
    const x = await deadline(pool.acquire());
    const y = await deadline(pool.acquire());
    const third = await Promise.race([pool.acquire().then(() => 'HANDED OUT A THIRD'), sleep(200).then(() => 'correctly blocked')]);
    await pool.close?.();
    return (x !== y && third === 'correctly blocked') ||
      `x===y: ${x === y}, third acquire: ${third} — max is no longer a maximum`;
  });

  await guard('close() destroys every connection and rejects the waiters', async () => {
    const { w, ...hooks } = world();
    if (typeof s.createPool({ ...hooks, max: 1 }).close !== 'function') return 'exports close()';
    const pool = s.createPool({ ...hooks, max: 2, acquireTimeoutMs: 5000 });
    const a = await deadline(pool.acquire());
    const b = await deadline(pool.acquire());
    const waiter = pool.acquire().then(() => 'resolved', () => 'rejected');
    pool.release(a); pool.release(b);
    await pool.close();
    const w2 = await Promise.race([waiter, sleep(500).then(() => 'STILL WAITING')]);
    return (w.destroyed === w.created && w.live.size === 0 && w2 !== 'STILL WAITING') ||
      `destroyed ${w.destroyed}/${w.created}, still live ${w.live.size}, waiter ${w2}`;
  });

  return out;
}
