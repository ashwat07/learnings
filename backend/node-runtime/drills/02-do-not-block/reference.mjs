/** Drill 02 — reference: yield to the loop on a TIME budget, not an iteration count. */

const SLICE_MS = 4;   // shorter than one frame, comfortably under the 25ms budget

export async function hash(n) {
  let h = 1;
  let i = 0;
  while (i < n) {
    const until = performance.now() + SLICE_MS;
    // The inner loop checks the clock every 4096 iterations rather than every iteration:
    // performance.now() is a syscall-ish operation and calling it 300 million times costs more
    // than the work itself. Batch the check.
    do {
      const end = Math.min(n, i + 4096);
      for (; i < end; i++) h = Math.imul(h ^ i, 2654435761) >>> 0;
    } while (i < n && performance.now() < until);

    await new Promise((r) => setImmediate(r));
  }
  return h;
}

/*
WHY setImmediate AND NOT await Promise.resolve()

This is the mistake that makes a "fix" do nothing. `await Promise.resolve()` queues a MICROTASK,
and the microtask queue is drained to empty before the loop advances a single phase. You yield to
yourself. The lag check fails and the code looks like it should work, which is the worst kind of
bug.

setImmediate queues into the CHECK phase, which means the loop must first finish the poll phase —
i.e. actually read your sockets and run your HTTP handlers. That is what "yielding" has to mean.
setTimeout(r, 0) also works but is clamped to 1ms, so a 4ms slice becomes 4ms of work plus 1ms of
sleep: a 25% throughput loss for nothing.

WHY A TIME BUDGET AND NOT A CHUNK COUNT

"Process 10,000 items then yield" is the version everyone writes, and its slice length is whatever
10,000 items happens to cost — which varies by machine, by input, and by whether V8 has optimised
the function yet. A time budget is self-calibrating: 4ms is 4ms on a MacBook and on a throttled
container.

WHEN TO OFFLOAD INSTEAD

Yielding does not add throughput. The work still runs on the main thread, and you have made it
slightly SLOWER overall (this reference takes ~15% longer than the blocking version) in exchange
for latency. That trade is right for occasional work, wrong for a hot path.

    import { Worker } from 'node:worker_threads';
    // one worker per CPU, reused via a pool; postMessage the input, await the reply

Reach for a worker when: the work is CPU-bound AND either frequent or large, the input/output is
small or transferable (ArrayBuffer moves with zero copy via transferList; a big object graph gets
structured-cloned, which is itself CPU on the main thread and can eat the win), and you can afford
~1-2MB of heap plus ~10ms of startup per worker — so pool them, never spawn per request.

And the third option people forget: DO NOT DO THE WORK. Cache it, precompute it, push it to a
queue (jobs-and-messaging), or do it in Postgres. The fastest 400ms is the one that already ran.
*/
