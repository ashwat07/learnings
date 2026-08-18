import { getEventListeners } from 'node:events';
import { makePool, makeIo } from './world.mjs';

export const title = 'Cancellation that actually cancels — and cleans up';
export const service = null;
export const task = `Implement download({ signal, pool, io, ms, value }):

  · take a connection from the pool
  · start io(ms, value) and return its result
  · if the signal aborts, CANCEL the in-flight operation and reject with an AbortError whose
    .cause is signal.reason
  · return the connection to the pool on every path — success, failure, abort
  · and leave no trace on the signal when you are done

That last line is the one that bites. A signal usually outlives the operation: it belongs to the
request, or the process, and a thousand operations share it. Every addEventListener you do not
remove is a retained closure, a retained pool token, and a retained response body.`;
export const passIf = 'it cancels, it rejects correctly, the pool always balances, and 5,000 operations leave zero listeners on the signal';

const nextTick = () => new Promise((r) => setTimeout(r, 0));

export async function check(s) {
  if (typeof s.download !== 'function') return [{ check: 'exports async download({ signal, pool, io, ms, value })', actual: 'missing', pass: false }];
  const out = [];
  const guard = async (label, fn) => {
    try { const r = await fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 60), pass: false }); }
  };

  await guard('the happy path returns the value and balances the pool', async () => {
    const pool = makePool(); const io = makeIo();
    const got = await s.download({ signal: new AbortController().signal, pool, io, ms: 10, value: 'payload' });
    return (got === 'payload' && pool.stats.inUse === 0 && pool.stats.acquired === pool.stats.released) ||
      `got ${got}, pool ${JSON.stringify(pool.stats)}`;
  });

  await guard('an abort mid-flight rejects with an AbortError', async () => {
    const pool = makePool(); const io = makeIo(); const c = new AbortController();
    const p = s.download({ signal: c.signal, pool, io, ms: 5000, value: 'x' });
    await nextTick();
    c.abort(new Error('user navigated away'));
    try { await p; return 'it resolved instead of rejecting'; }
    catch (e) { return e.name === 'AbortError' || `rejected with ${e.name}: ${e.message}`; }
  });

  await guard('the rejection carries signal.reason as .cause', async () => {
    const pool = makePool(); const io = makeIo(); const c = new AbortController();
    const reason = new Error('deadline exceeded');
    const p = s.download({ signal: c.signal, pool, io, ms: 5000, value: 'x' });
    await nextTick();
    c.abort(reason);
    try { await p; return 'no rejection'; }
    catch (e) { return e.cause === reason || `cause was ${e.cause}`; }
  });

  await guard('the abort actually CANCELS the I/O (it does not just stop waiting)', async () => {
    const pool = makePool(); const io = makeIo(); const c = new AbortController();
    const p = s.download({ signal: c.signal, pool, io, ms: 5000, value: 'x' });
    await nextTick();
    c.abort(new Error('stop'));
    await p.catch(() => {});
    return io.cancelledCount() === 1 || `cancel() was called ${io.cancelledCount()} times — the request is still running on the server`;
  });

  await guard('an abort releases the connection', async () => {
    const pool = makePool(); const io = makeIo(); const c = new AbortController();
    const p = s.download({ signal: c.signal, pool, io, ms: 5000, value: 'x' });
    await nextTick();
    c.abort(new Error('stop'));
    await p.catch(() => {});
    return (pool.stats.inUse === 0 && pool.stats.released === 1) || `pool ${JSON.stringify(pool.stats)}`;
  });

  await guard('an ALREADY-aborted signal rejects without taking a connection', async () => {
    const pool = makePool(); const io = makeIo();
    const c = new AbortController();
    c.abort(new Error('already gone'));
    try {
      await s.download({ signal: c.signal, pool, io, ms: 10, value: 'x' });
      return 'it ran the operation anyway';
    } catch (e) {
      return (e.name === 'AbortError' && pool.stats.inUse === 0 && io.cancelledCount() <= 1) ||
        `${e.name}, pool ${JSON.stringify(pool.stats)}`;
    }
  });

  await guard('the pool does not deadlock under load (4 slots, 200 operations)', async () => {
    const pool = makePool(4); const io = makeIo();
    const signal = new AbortController().signal;
    const results = await Promise.race([
      Promise.all(Array.from({ length: 200 }, (_, i) => s.download({ signal, pool, io, ms: 1, value: i }))),
      new Promise((r) => setTimeout(() => r('TIMEOUT'), 4000)),
    ]);
    if (results === 'TIMEOUT') return 'deadlocked — a connection was not released';
    return (results.length === 200 && results[199] === 199 && pool.stats.inUse === 0) || `pool ${JSON.stringify(pool.stats)}`;
  });

  // The leak. One signal, five thousand completed operations.
  await guard('5,000 completed operations leave 0 listeners on the shared signal', async () => {
    const pool = makePool(50); const io = makeIo();
    const c = new AbortController();
    const before = getEventListeners(c.signal, 'abort').length;
    for (let i = 0; i < 100; i++) {
      await Promise.all(Array.from({ length: 50 }, () => s.download({ signal: c.signal, pool, io, ms: 0, value: 1 })));
    }
    const after = getEventListeners(c.signal, 'abort').length;
    return after === before ||
      `${after} listeners still attached (started at ${before}) — 5,000 closures the GC cannot free`;
  });

  await guard('aborting AFTER the download resolved does not throw or leak a rejection', async () => {
    const pool = makePool(); const io = makeIo(); const c = new AbortController();
    const got = await s.download({ signal: c.signal, pool, io, ms: 1, value: 'done' });
    c.abort(new Error('too late'));
    await nextTick();
    return got === 'done' || `got ${got}`;
  });

  return out;
}
