/**
 * The worker side — given to you, so the drill is about the POOL, which is the hard part.
 *
 * Protocol: the parent posts { id, n, fail }, the worker replies { id, result } or { id, error }.
 * Note that it replies rather than throwing: an uncaught throw in a worker fires 'error' on the
 * Worker object and KILLS THE THREAD, taking every other job assigned to it with it. Catching at
 * the top of the worker and replying with an error keeps the thread alive and the failure scoped
 * to one job — which is what you want, and what a naive pool gets wrong.
 */
import { parentPort, threadId } from 'node:worker_threads';

const hash = (n) => { let h = 1; for (let i = 0; i < n; i++) h = Math.imul(h ^ i, 2654435761) >>> 0; return h; };

parentPort.on('message', ({ id, n, fail }) => {
  try {
    if (fail) throw new Error('worker job failed');
    parentPort.postMessage({ id, result: hash(n), threadId });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message, threadId });
  }
});
