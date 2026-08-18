import { sql } from '../../../lib/db.mjs';

export const title = 'Never block the event loop, never buffer the world';
export const task = `Export every row of the orders table (~200,000) through a transform to a slow
sink.

The obvious implementation loads them all into an array, maps it, and writes. It uses hundreds of
megabytes and freezes the event loop while it does. The runner measures BOTH: peak heap growth, and
the longest the event loop was blocked.`;
export const passIf = 'all rows exported, peak heap growth under 25MB, and the loop never blocked for more than 60ms';

export async function check(s) {
  if (typeof s.exportRows !== 'function') return [{ check: 'exports exportRows(sql, sink)', actual: 'missing', pass: false }];

  // Count rather than assume: other labs and the API test suite insert rows too.
  const [{ total }] = await sql`SELECT count(*)::int AS total FROM orders`;

  // A sink that is slower than the producer — which is the entire point of backpressure.
  let written = 0;
  let inFlight = 0, maxInFlight = 0;
  const sink = {
    async write(line) {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setImmediate(r));
      written += 1;
      inFlight--;
      void line;
    },
  };

  // Watch the event loop. Any gap much larger than the tick interval is a block.
  let maxLagMs = 0;
  let last = performance.now();
  const watcher = setInterval(() => {
    const now = performance.now();
    maxLagMs = Math.max(maxLagMs, now - last - 10);
    last = now;
  }, 10);

  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  let peak = before;
  const memWatcher = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 15);

  const t0 = performance.now();
  let error = null;
  try { await s.exportRows(sql, sink); } catch (e) { error = e.message.slice(0, 50); }
  const ms = performance.now() - t0;

  clearInterval(watcher); clearInterval(memWatcher);
  const growthMB = (peak - before) / 1048576;

  return [
    { check: 'no error', actual: error ?? 'none', pass: !error },
    { check: `all ${total.toLocaleString()} rows written`, actual: written.toLocaleString(), pass: written === total },
    { check: 'peak heap growth under 25MB', actual: `${growthMB.toFixed(0)}MB`, pass: growthMB < 25 },
    { check: 'event loop never blocked > 60ms', actual: `${maxLagMs.toFixed(0)}ms`, pass: maxLagMs < 60 },
    { check: 'the sink was not overwhelmed (<= 64 concurrent writes)', actual: maxInFlight, pass: maxInFlight <= 64 },
    { check: 'finished within 20s', actual: `${(ms / 1000).toFixed(1)}s`, pass: ms < 20000 },
  ];
}
