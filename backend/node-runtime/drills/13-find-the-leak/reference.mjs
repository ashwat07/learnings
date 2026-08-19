/** Drill 13 — reference. */

const MAX_ENTRIES = 1000;
const MAX_AUDIT = 500;

export function createService(bus) {
  const cache = new Map();
  const auditLog = [];
  let hits = 0, misses = 0;

  // LEAK 1 FIXED — the cache is BOUNDED.
  //
  // A Map keyed by request id, user id, session id or URL is not a cache; it is a log with a
  // lookup index, and it grows exactly as fast as your traffic. The only question that matters
  // for any cache is "what evicts?", and if you cannot answer it in one sentence you have a leak.
  //
  // This is LRU in about six lines, using a property of Map most people never use: Map preserves
  // INSERTION ORDER, so `map.keys().next().value` is the oldest key. Delete-then-set moves an
  // entry to the end, which is exactly a "touch". For real workloads reach for lru-cache, which
  // also gives you TTLs, size-based limits (bytes, not entries) and stale-while-revalidate.
  const touch = (key, value) => {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
  };

  // LEAK 2 FIXED — ONE listener, registered once, for the life of the service.
  //
  // `bus.on(...)` inside a request handler adds a listener per request to an emitter that lives
  // for the life of the process. Each one retains its closure, and each closure retains `req`,
  // and `req` retains the body. Node's MaxListenersExceededWarning exists specifically to catch
  // this, and it fires at 11 — so if you have ever silenced that warning with
  // setMaxListeners(0), this is what you silenced.
  const onShutdown = () => cache.clear();
  bus.on('shutdown', onShutdown);

  const compute = (req) => {
    const buffer = Buffer.alloc(req.size, 1);
    const n = Number(req.id.split('-')[1]) || 0;
    return { id: req.id, checksum: (n % 50) * req.size, buffer };
  };

  return {
    async handle(req) {
      // LEAK 3 FIXED — no per-request timer.
      //
      // A setTimeout is a live handle held by the event loop, and it retains its callback and
      // everything the callback closes over until it FIRES. A 60-second timer per request at 500
      // requests a second is 30,000 live handles and whatever they capture. Worse, an
      // uncancelled timer also keeps the process alive at shutdown (drill 07).
      //
      // If you genuinely need one: keep the handle, clearTimeout on the way out, and .unref()
      // it so it cannot hold the process open.

      const cached = cache.get(req.id);
      if (cached) {
        hits++;
        touch(req.id, cached);                    // an LRU read is also a write
        return { id: cached.id, checksum: cached.checksum };
      }
      misses++;

      const result = compute(req);
      touch(req.id, result);

      // LEAK 4 FIXED — the audit log is bounded AND stores no reference to the payload.
      //
      // This is the subtle one, and the one heap snapshots are actually for. The record is 40
      // bytes; the `result` it pointed at held a 4KB Buffer. A small object retaining a large one
      // is invisible by inspection — every count looks reasonable — and obvious in a snapshot's
      // retainer panel, where the 4KB buffers are all held by `auditLog[]`.
      //
      // The same shape, in the wild: an error object retaining the whole request; a closure
      // capturing `res` so it can log later; a Promise chain holding a decoded image; one line
      // of a 10MB string kept via slice (see go-lang drill 01 for the identical trap in Go).
      auditLog.push({ at: Date.now(), id: req.id, checksum: result.checksum });
      if (auditLog.length > MAX_AUDIT) auditLog.shift();

      return { id: result.id, checksum: result.checksum };
    },

    stats() {
      return { hits, misses, cacheSize: cache.size };
    },

    async close() {
      // Symmetry: whatever you registered, deregister. This is what makes the service reusable
      // in a test suite, and what stops a hot-reloading dev server leaking a copy per reload.
      bus.off('shutdown', onShutdown);
      cache.clear();
      auditLog.length = 0;
    },
  };
}

/*
THE FOUR SHAPES, AND HOW TO SPOT THEM WITHOUT A PROFILER

  1. AN UNBOUNDED COLLECTION.  Search your codebase for `new Map()` and `= []` at module or
     service scope and ask "what removes from this?" No answer means a leak. The fix is a bound:
     LRU by count, by bytes, or a TTL. `WeakMap`/`WeakRef` help when the key is an object whose
     lifetime someone else controls — they do not help when the key is a string.

  2. A SUBSCRIPTION WITHOUT AN UNSUBSCRIBE.  emitter.on, addEventListener, a Redis subscription,
     a database LISTEN, an AbortSignal listener (drill 06), a React effect with no cleanup. The
     giveaway is a subscription inside a per-request or per-render function.

  3. A TIMER OR HANDLE THAT OUTLIVES ITS REASON.  setInterval is worse than setTimeout because it
     never stops on its own. `process.getActiveResourcesInfo()` (Node 17.3+) lists what is
     currently keeping the loop alive — a genuinely useful two-second diagnostic that almost
     nobody knows about, and what this drill's timer check uses.

  4. A SMALL THING RETAINING A LARGE THING.  Only a heap snapshot finds these, because the counts
     all look fine. Look at RETAINED size, not shallow size.

THE WORKFLOW, IN ORDER

  a. Confirm it is real:  process.memoryUsage().heapUsed over time, or `--max-old-space-size` set
     low so it fails fast in a test. A rising sawtooth that never returns to its old floor after
     GC is a leak; a rising sawtooth that does is just GC doing its job.
  b. Get a baseline: run the load, force a GC, snapshot.
  c. Run more load, force a GC, snapshot again.
  d. Compare the two snapshots in DevTools (chrome://inspect after `node --inspect`) and sort by
     Delta. Or `require('v8').writeHeapSnapshot()` from inside the process, which works in
     production and gives you a .heapsnapshot file to open later.
  e. Click the biggest offender and read the RETAINERS. The leak is the retainer, never the leaf.

WHAT IS NOT A LEAK
  · a heap that grows to a plateau — that is a cache filling up, working as intended
  · RSS staying high after heapUsed drops — the allocator returns memory to the OS lazily
  · a slow rise under a rising request rate — that is load, not a leak
  · Buffers not showing in heapUsed — they are `external`/`arrayBuffers`. `heapUsed` is one of
    FIVE numbers in process.memoryUsage(), and a Buffer leak is invisible in the wrong one
    (see drill 11).
*/
