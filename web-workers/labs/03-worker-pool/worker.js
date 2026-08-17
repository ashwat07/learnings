// Lab 03 — a worker that does CPU work in slices so it can be cancelled.
//
// The critical detail: a worker running a synchronous loop CANNOT receive messages. Its
// message queue is only drained when the current task returns to the event loop. So a
// "cancel" postMessage sent to a busy worker sits there until the work is already finished —
// which is exactly why naive cancellation appears to do nothing.
//
// Two ways out, both here:
//   1. slice the work and yield, so the message queue gets drained between slices
//   2. terminate() the worker from outside — instant, but you lose the thread and its state

const cancelled = new Set();

self.onmessage = async (e) => {
  const { id, type, work } = e.data;

  if (type === 'cancel') {
    cancelled.add(work);            // `work` is the id to cancel
    return;
  }

  if (type !== 'run') return;

  // For the recycling test: a worker that throws an uncaught error. Note what happens to the
  // pool afterwards if nothing handles it — the slot stays "busy" forever and every job routed
  // to it hangs. Silent, permanent, and very hard to diagnose from the outside.
  if (work?.crash) throw new Error('worker crashed on purpose');

  const t0 = performance.now();
  const target = t0 + work.ms;
  let iterations = 0;
  let x = 0;

  while (performance.now() < target) {
    // A slice of real CPU work.
    const sliceEnd = Math.min(performance.now() + 8, target);
    while (performance.now() < sliceEnd) { x += Math.sqrt(x + 1); iterations++; }

    // Yield to the worker's own event loop so queued messages (like a cancel) are delivered.
    await new Promise((r) => setTimeout(r, 0));

    if (cancelled.has(id)) {
      cancelled.delete(id);
      self.postMessage({ id, type: 'cancelled', ms: performance.now() - t0 });
      return;
    }
  }

  self.postMessage({
    id,
    type: 'done',
    ms: performance.now() - t0,
    iterations,
    checksum: Math.round(x),
  });
};
