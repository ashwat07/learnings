/**
 * Drill 02 — do not block the loop.
 *
 * This is the version that ships by accident. It is correct, it is fast in isolation, and it is
 * the reason your service has a 400ms floor on every concurrent request.
 *
 * Two families of fix, and they are not interchangeable:
 *
 *   YIELD    break the work into slices and hand the loop back between them. Cheap, no extra
 *            process, but the work still runs on the main thread — so total throughput is
 *            unchanged and you are trading latency for a slightly longer total.
 *   OFFLOAD  move it to a worker_thread. Real parallelism, at the cost of a thread and the
 *            serialisation of whatever you send. Right when the work is big, or frequent.
 *
 * Either passes. Write the one you would actually deploy, then read the reference for when the
 * other one is right — and for the sharp edge that makes the naive yield version WRONG.
 *
 * Note: `await` is not a fix. Awaiting an already-resolved promise queues a microtask, and
 * microtasks run before the loop gets anywhere near the poll phase. If you "fix" this by
 * sprinkling `await Promise.resolve()` inside the loop, the lag check will still fail. Making
 * something async does not make it non-blocking.
 */

export async function hash(n) {
  let h = 1;
  for (let i = 0; i < n; i++) {
    h = Math.imul(h ^ i, 2654435761) >>> 0;
  }
  return h;
}
