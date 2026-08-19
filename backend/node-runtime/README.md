# The Node runtime

**No Docker, no database, no Redis.** These are about V8, libuv and the standard library, so they
need nothing but the `node` on your PATH.

```bash
node node-runtime/labs/01-runtime-and-loop/lab.mjs     # read first
node node-runtime/labs/02-modules/lab.mjs
node --expose-gc node-runtime/labs/03-diagnostics/lab.mjs
node node-runtime/labs/04-cluster-and-reloads/lab.mjs

npm run drills:node                 # all thirteen, from backend/
npm run drills:node -- 04           # just one
npm run drills:node -- 04 --solution   # ...with the reference answer
```

Everything starts red. Edit `solution.mjs` in a drill directory until its checks go green.

## The labs — read these, they demonstrate

| | |
|---|---|
| **01 runtime & loop** | What Node is made of; the phases; `setTimeout(0)` vs `setImmediate` measured across 30 fresh processes; `nextTick` starvation; the libuv thread pool proved with `UV_THREADPOOL_SIZE`; timer drift |
| **02 modules** | CommonJS vs ESM: live bindings vs copied values, hoisted imports, interop in both directions, cycles, `exports` conditions and the dual package hazard |
| **03 diagnostics** | `monitorEventLoopDelay`, GC observation by generation, a CPU profile taken in-process, `diagnostics_channel`, a load test that shows why the mean lies, heap snapshots |
| **04 cluster & reloads** | Forks a cluster, SIGKILLs a worker under load (**6 requests dropped**), then rolls every worker with **zero** |

Plus [SHIPPING.md](SHIPPING.md) — TypeScript with Node, packages and pnpm, testing strategy,
security, Docker, native addons and frameworks. Reference rather than drill, because there is no
failing assertion that proves you can choose a package manager.

## The drills — solve these, they are graded

| | The situation | What the starting code does |
|---|---|---|
| **01** | Predict an ordering | you have to commit to an answer before running it |
| **02** | 400ms of CPU | blocks the loop for **335ms**; the target is under 25ms |
| **03** | Write `EventEmitter` | the blog-post version fails 6 of 17 behaviours |
| **04** | Frame a protocol over TCP | assumes one chunk is one message — crashes on the first split |
| **05** | Backpressure | the sink buffers **99,999** objects; the target is 64 |
| **06** | Cancellation | leaks **5,000 listeners** on a shared signal, and never cancels the I/O |
| **07** | Graceful shutdown | hangs on an idle keep-alive socket until SIGKILL |
| **08** | Bounded concurrency | "limited" turns out to mean concurrency 1 |
| **09** | Worker pool | spawns a thread per job: **832ms** for work that takes 15ms |
| **10** | Request context | a module-level variable — **597 cross-request leaks** in 200 requests |
| **11** | Streaming HTTP | buffers a 76MB export: **405MB** of heap, and reads a 200MB body before rejecting it |
| **12** | Connection pool | hands out more than `max`, and deadlocks permanently once the database blinks |
| **13** | Find the leak | **32,000 listeners, 32,000 timers, 80,100 cache entries** |

## What each drill is really about

**01 — Predict the order.** Eight labels, one exact answer. Everything else here assumes you know
where a callback runs; this is where you find out whether you do.

**02 — Do not block the loop.** `await` is not a fix — awaiting a resolved promise queues a
microtask, and microtasks run before the loop reaches the poll phase. The fix is a **time budget**
plus `setImmediate`, or a worker (drill 09).

**03 — EventEmitter.** Twenty lines gets `on`/`emit`/`off` working. The other eighty percent is
what happens when a listener removes another listener during an emit, what an `'error'` event with
no listener must do, and why `off` must remove exactly one registration.

**04 — Framing.** There is no such thing as "the socket gave me a message". The drill splits your
stream at 25 different random boundaries, hands you a 4GB length prefix, and times a 6MB message
delivered in 1KB chunks — because `Buffer.concat` on every push is O(n²) and costs 1.6 seconds.

**05 — Backpressure.** `write()` returns `false` when the buffer is over the high-water mark, and
that boolean is the entire protocol. Ignoring it is why Node "runs out of memory copying a file".
The second half is `.pipe()` vs `pipeline()`: on error, `.pipe()` leaves every other stream open.

**06 — Cancellation.** `Promise.race([work, timeout])` is a lie about cancellation — the loser
keeps running. Then the leak nobody looks for: a signal outlives the operation, so every
`addEventListener` you do not remove is a retained closure.

**07 — Graceful shutdown.** `server.close()` waits for keep-alive sockets that will not be reused
for 60 seconds. Kubernetes gives you 30, then SIGKILL — so the "graceful" shutdown drops requests
the ungraceful one would not have. `closeIdleConnections()` is the line that fixes it.

**08 — Bounded concurrency.** `Promise.all(urls.map(fetch))` opens every connection at once. The
subtleties: submission order, FIFO not LIFO, a rejection must not shrink the pool, and 100,000
queued tasks must not be O(n²).

**10 — Request context.** Every log line needs the request id and none of them are arguments. The
module-level variable works with one request at a time and interleaves catastrophically under
load — measured here as request 12 seeing request 199's id. `AsyncLocalStorage` is the only
correct answer, because only the runtime knows which logical operation a continuation belongs to.

**11 — Streaming HTTP.** Both directions of the same mistake. Building the response in memory is
405MB of heap for a 76MB export; buffering the upload is a denial-of-service primitive whose size
is chosen by the caller. Plus refusing early, and stopping work when the client hangs up.

**12 — Connection pool.** A pool is a semaphore with objects attached, and every interesting bug is
in the semaphore half: a double release hands the same connection to two callers, a missing
`acquire` timeout is an outage with no error in the logs, and a `create()` that throws while the
database is down permanently consumes a slot — so the pool never recovers even after the database
does.

**13 — Find the leak.** Four planted leaks, all real patterns, and the cache still has to *be* a
cache afterwards, so deleting it is not a fix. Run it under `--inspect` and diff two heap
snapshots; the leak is never the object, it is always the retainer.

**09 — Worker threads.** Real parallelism, and the costs nobody measures: `postMessage`
structured-clones on the calling thread, each worker is a fresh V8 isolate with its own copy of
your dependencies, and an idle worker keeps the process alive unless you `unref()` it.

## Related

- `../jobs-and-messaging/` — drill 03 there is this backpressure problem against a real Postgres cursor
- `../reliability/` — timeouts, retries, breakers built on the primitives in drill 06
- `../go-lang/` and `../go-concurrency/` — the same problems in a language with real threads
- `../../event-loop/` — the browser half of the same machine
