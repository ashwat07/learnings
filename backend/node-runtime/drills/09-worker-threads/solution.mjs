/**
 * Drill 09 — worker_threads.
 *
 *   createPool(size, workerPath) -> { run({ n, fail }) -> Promise, close() -> Promise }
 *
 * The starting point spawns a worker per job. It is correct, it is parallel, and it is slower
 * than doing the work inline for anything under ~50ms — because a Worker is a whole new V8
 * isolate: its own heap, its own module graph to load, roughly 10-20ms and a couple of megabytes
 * before it has run a line of your code.
 *
 * Turn it into a pool: `size` workers, spawned once, jobs routed to whichever is free.
 *
 * The routing is the part worth thinking about. Every reply arrives on the same 'message' event,
 * so you need to know which promise it belongs to — hence the `id` in the protocol. Look at
 * worker.mjs before you start.
 *
 * Two facts that shape the design:
 *   · postMessage STRUCTURED-CLONES its argument, on the calling thread. Sending a 50MB object
 *     costs 50MB of copying on the main thread, which is the blocking you were trying to escape.
 *     ArrayBuffers can be TRANSFERRED instead (zero copy, sender loses access).
 *   · an unhandled throw inside a worker kills the thread. worker.mjs catches and replies with
 *     an error instead — but your pool still has to handle a worker dying for other reasons.
 */

import { Worker } from 'node:worker_threads';

export function createPool(size, workerPath) {
  return {
    run(job) {
      return new Promise((resolve, reject) => {
        const worker = new Worker(workerPath);
        worker.on('message', (msg) => {
          worker.terminate();
          if (msg.error) reject(new Error(msg.error)); else resolve(msg);
        });
        worker.on('error', reject);
        worker.postMessage({ id: 1, ...job });
      });
    },
    async close() {},
  };
}
