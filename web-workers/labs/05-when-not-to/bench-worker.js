// Lab 05 — a minimal worker for measuring overhead. It does exactly the work it is asked to
// do and nothing else, so the difference against the main thread IS the overhead.

self.onmessage = (e) => {
  const { id, ms } = e.data;
  const end = performance.now() + ms;
  let x = 0;
  while (performance.now() < end) x += Math.sqrt(x + 1);
  self.postMessage({ id, x: Math.round(x) });
};

// Report readiness so the page can measure spawn-to-first-message latency, which is the
// number that matters when you are deciding whether to spawn a worker for one job.
self.postMessage({ ready: true, at: performance.now() });
