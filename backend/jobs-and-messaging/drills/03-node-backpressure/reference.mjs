/**
 * Three separate problems, and the naive version has all of them:
 *
 * 1. MATERIALISING THE RESULT SET. `await sql\`SELECT ...\`` buffers every row in memory before you
 *    see the first one. A cursor streams: the driver holds a window, your callback processes it,
 *    and only then does it ask for more. Memory becomes O(batch), not O(rows).
 *
 * 2. A SYNCHRONOUS MAP OVER EVERYTHING. `rows.map(...)` over 200,000 rows is one uninterruptible
 *    task. Nothing else runs — not a health check, not a timer, not another request. The event
 *    loop lag the runner measures IS that pause.
 *
 * 3. UNBOUNDED CONCURRENCY. `Promise.all(everything.map(write))` starts 200,000 writes at once.
 *    Against a real sink that is 200,000 open sockets or file handles. The fix is a bounded pool —
 *    the same shape as javascript lab 06, and the same idea as realtime-ui lab 05.
 *
 * The general rule, and it is the one that matters most in Node: NEVER HOLD THE WHOLE DATASET, AND
 * NEVER RUN AN UNBOUNDED LOOP. A cursor plus a bounded pool gives you constant memory and a
 * responsive process regardless of how much data there is.
 *
 * (If the transform were CPU-heavy rather than I/O-heavy, the answer would be different: move it to
 * worker_threads, because no amount of yielding makes CPU work free — web-workers lab 01 makes the
 * same argument in the browser.)
 */
const CONCURRENCY = 32;

export async function exportRows(sql, sink) {
  await sql`SELECT id, user_id, status, total_cents, created_at FROM orders`
    .cursor(1000, async (rows) => {
      // A bounded pool per batch: at most CONCURRENCY writes in flight, and the cursor does not
      // fetch the next batch until this one is done.
      const queue = rows.map((r) => `${r.id},${r.user_id},${r.status},${r.total_cents}`);
      let i = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (i < queue.length) await sink.write(queue[i++]);
      });
      await Promise.all(workers);
    });
}
