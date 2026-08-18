export const title = 'Bounded concurrency';
export const task = `Promise.all(urls.map(fetch)) opens every connection at once. With 10 URLs it
is fine. With 10,000 it is a self-inflicted denial of service: your file-descriptor limit, your
connection pool, and the API you are calling all discover the problem at the same moment.

Implement createLimiter(n) -> limit(fn) -> Promise, running at most n at a time.

The interesting requirements are the ones a five-line version gets wrong: results must come back
in submission order, a rejected task must not shrink the pool, and 100,000 queued tasks must not
blow the stack.`;
export const passIf = 'never more than n running, always exactly n when there is work, FIFO, rejection-safe, and it survives 100k queued tasks';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function check(s) {
  if (typeof s.createLimiter !== 'function') return [{ check: 'exports createLimiter(n)', actual: 'missing', pass: false }];
  const out = [];
  const guard = async (label, fn) => {
    try { const r = await fn(); out.push({ check: label, actual: r === true ? 'ok' : String(r), pass: r === true }); }
    catch (e) { out.push({ check: label, actual: `threw: ${e.message}`.slice(0, 60), pass: false }); }
  };

  await guard('results come back in SUBMISSION order, not completion order', async () => {
    const limit = s.createLimiter(4);
    const jobs = [50, 5, 40, 1, 30, 2, 20, 3];
    const got = await Promise.all(jobs.map((ms, i) => limit(async () => { await sleep(ms); return i; })));
    return got.join(',') === '0,1,2,3,4,5,6,7' || `got ${got.join(',')}`;
  });

  await guard('never more than 3 run at once', async () => {
    const limit = s.createLimiter(3);
    let running = 0, peak = 0;
    await Promise.all(Array.from({ length: 50 }, () => limit(async () => {
      running++; peak = Math.max(peak, running);
      await sleep(5);
      running--;
    })));
    return peak <= 3 || `peak concurrency was ${peak}`;
  });

  await guard('but it DOES reach 3 — it is not accidentally serial', async () => {
    const limit = s.createLimiter(3);
    let running = 0, peak = 0;
    await Promise.all(Array.from({ length: 30 }, () => limit(async () => {
      running++; peak = Math.max(peak, running);
      await sleep(10);
      running--;
    })));
    return peak === 3 || `peak concurrency was only ${peak}`;
  });

  await guard('30 tasks of 10ms at concurrency 3 take ~100ms, not ~300ms', async () => {
    const limit = s.createLimiter(3);
    const t0 = performance.now();
    await Promise.all(Array.from({ length: 30 }, () => limit(() => sleep(10))));
    const ms = performance.now() - t0;
    return (ms > 60 && ms < 220) || `${ms.toFixed(0)}ms`;
  });

  await guard('tasks START in submission order (FIFO, not LIFO)', async () => {
    const limit = s.createLimiter(1);
    const order = [];
    await Promise.all([1, 2, 3, 4, 5].map((i) => limit(async () => { order.push(i); await sleep(1); })));
    return order.join('') === '12345' || `started in order ${order.join('')} — a stack, not a queue`;
  });

  await guard('a rejected task does not shrink or stall the pool', async () => {
    const limit = s.createLimiter(2);
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
      limit(async () => { await sleep(2); if (i % 3 === 0) throw new Error(`boom ${i}`); return i; })));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    // ...and the pool is still usable afterwards
    const after = await limit(async () => 'still works');
    return (ok === 13 && failed === 7 && after === 'still works') || `${ok} ok / ${failed} failed, then ${after}`;
  });

  await guard('a task that throws SYNCHRONOUSLY rejects rather than escaping', async () => {
    const limit = s.createLimiter(2);
    try { await limit(() => { throw new Error('sync boom'); }); return 'it did not reject'; }
    catch (e) { return e.message === 'sync boom' || `rejected with ${e.message}`; }
  });

  await guard('100,000 queued tasks do not blow the stack', async () => {
    const limit = s.createLimiter(8);
    const t0 = performance.now();
    const got = await Promise.all(Array.from({ length: 100_000 }, (_, i) => limit(async () => i)));
    const ms = performance.now() - t0;
    return (got.length === 100_000 && got[99_999] === 99_999 && ms < 5000) || `${got.length} results in ${ms.toFixed(0)}ms`;
  });

  await guard('an empty pool starts the next task immediately, not on a timer', async () => {
    const limit = s.createLimiter(1);
    const t0 = performance.now();
    await Promise.all(Array.from({ length: 200 }, () => limit(async () => {})));
    const ms = performance.now() - t0;
    return ms < 60 || `${ms.toFixed(0)}ms for 200 instant tasks — something is waiting on a timer`;
  });

  return out;
}
