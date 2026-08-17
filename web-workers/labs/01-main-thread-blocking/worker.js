// Lab 01 — the worker.
//
// A module worker: it can use `import`, which is what you want for anything non-trivial.
// (Registered with `new Worker(url, { type: 'module' })`.)

self.onmessage = async (e) => {
  const { url, id, rows } = e.data;
  const t0 = performance.now();

  // Strategy D: the main thread already fetched and parsed, then structured-cloned the whole
  // array over here. All this worker saves is the transform — and the clone cost usually
  // exceeds it. Handled so you can measure it rather than read about it.
  if (rows) {
    const summary = summarise(rows);
    self.postMessage({
      id,
      summary,
      timings: { fetch: 0, parse: 0, transform: performance.now() - t0, total: performance.now() - t0 },
    });
    return;
  }

  // Fetch INSIDE the worker. This matters: if you fetch on the main thread and post the JSON
  // over, you pay a structured clone of the whole payload and the main thread does the parse.
  // Fetching here means the bytes never touch the main thread at all.
  const res = await fetch(url);
  const tFetched = performance.now();

  const data = await res.json();          // the expensive parse, off the main thread
  const tParsed = performance.now();

  const summary = summarise(data.rows);
  const tDone = performance.now();

  self.postMessage({
    id,
    summary,
    timings: {
      fetch: tFetched - t0,
      parse: tParsed - tFetched,
      transform: tDone - tParsed,
      total: tDone - t0,
    },
  });
};

/** The same transform the main-thread version runs, so the comparison is fair. */
function summarise(rows) {
  const byTeam = new Map();
  for (const row of rows) {
    let bucket = byTeam.get(row.team);
    if (!bucket) byTeam.set(row.team, bucket = { team: row.team, n: 0, score: 0, active: 0, tags: new Set() });
    bucket.n++;
    bucket.score += row.score;
    if (row.active) bucket.active++;
    for (const t of row.tags) bucket.tags.add(t);
  }
  return [...byTeam.values()]
    .map((b) => ({ team: b.team, n: b.n, avg: +(b.score / b.n).toFixed(2), active: b.active, tags: b.tags.size }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 12);
}
