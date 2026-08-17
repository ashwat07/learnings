// Lab 02 — the echo/compute worker.
//
// Its job is to be measured: it reports how long the message took to ARRIVE (which is where
// the deserialisation cost shows up) and can echo payloads back so you can measure both legs.

self.onmessage = (e) => {
  const arrivedAt = performance.now();
  const { id, kind, sentAt, payload, echo } = e.data;

  // performance.now() is comparable across threads for the same origin (both are relative to
  // the same time origin), so sentAt → arrivedAt is a real one-way latency measurement.
  const oneWay = arrivedAt - sentAt;

  let sum = 0;
  if (kind === 'shared') {
    // A SharedArrayBuffer is not copied at all — the worker reads the same memory the main
    // thread wrote. There is no message cost proportional to size.
    const view = new Float64Array(payload);
    for (let i = 0; i < view.length; i++) sum += view[i];
  } else if (payload instanceof ArrayBuffer) {
    const view = new Float64Array(payload);
    for (let i = 0; i < view.length; i++) sum += view[i];
  } else if (Array.isArray(payload)) {
    for (const row of payload) sum += row.score ?? 0;
  }

  const reply = { id, oneWay, computedAt: performance.now(), sum, kind };

  if (echo) {
    // Echo the payload back so the caller can measure the return leg too.
    if (payload instanceof ArrayBuffer && kind === 'transfer') {
      self.postMessage({ ...reply, payload }, [payload]);
      return;
    }
    self.postMessage({ ...reply, payload });
    return;
  }
  self.postMessage(reply);
};
