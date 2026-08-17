# Lab 03 — Worker pools & cancellation ⭐⭐⭐⭐

**Goal:** run N jobs on a bounded number of threads, and be able to actually stop them.

**Primary metric:** wall time for 24 × 300ms jobs, workers spawned, and whether cancellation
cancels anything.

> Open <http://localhost:8080/web-workers/labs/03-worker-pool/>

---

## The concept

```
one worker            ██████████████████████  serial: n × job
worker per job        ████ ████ ████ ████     n threads, n spawns, n × heap
pool of k workers     ████ ████               ceil(n/k) × job, k spawns, flat memory
                      ████ ████
```

A worker is a real OS thread with its own JS heap — a few MB before your code runs, plus 10–50ms
to spawn. Spawning one per job means paying that repeatedly while the OS context-switches between
more threads than you have cores.

Measure it:

| Strategy | Wall ms | Workers spawned | Notes |
|---|---|---|---|
| A. single worker | | 1 | |
| B. worker per job | | 24 | |
| C. pool of 4 | | 4 | |

B is often *slower* than C despite "more parallelism" — CPU-bound work on 8 cores doesn't go
faster with 24 threads, it goes slower. Take a heap snapshot during B.

### Sizing the pool

`navigator.hardwareConcurrency` is the usual default, with caveats:

- It's a **hint**, capped for fingerprinting reasons (Safari reports a low number deliberately).
- It counts hyperthreads, not physical cores.
- It says nothing about what else is running, or about efficiency vs performance cores.

For CPU-bound work: `hardwareConcurrency` (or minus one, to leave the main thread a core). For
I/O-bound work inside workers: more threads than cores is fine.

## The four TODOs

`pool.js` runs; the interesting parts are yours.

### TODO 1 — cancellation

Two halves, and the second is the lesson:

- **Queued jobs**: trivial. Drop from the queue, reject, no worker involved.
- **Running jobs**: **a worker executing a synchronous loop cannot receive your message.** Its
  message queue is only drained when it returns to its event loop. Your `cancel` postMessage
  arrives *after* the work finishes.

Three ways out:

| Approach | Cost |
|---|---|
| Slice the work in the worker and check for cancellation between slices | Requires cooperation from the worker code; adds a yield per slice |
| `worker.terminate()` | Instant and brutal: you lose the thread, its warm JIT, and any state it held. Respawn costs 10–50ms |
| A `SharedArrayBuffer` flag the worker polls inside its loop | Works even in a tight loop; needs cross-origin isolation |

A production pool does the first with a timeout to the second: **ask nicely, then kill.**

### TODO 2 — priorities

Dequeue high before normal before low, FIFO within a priority. Then answer in a comment: what
stops low-priority jobs starving, and do you actually need to do anything about it? (Depends
entirely on whether your producers are bounded. Say so.)

### TODO 3 — backpressure

An unbounded queue is a memory leak with extra steps — every queued job retains its payload, its
promise, and everything they close over. A pool fed by a scroll handler or a websocket can queue
faster than it drains, forever.

Two defensible designs:

- **Reject when full** — the caller learns immediately and can shed load.
- **Await room** — the caller is naturally throttled. This is real backpressure.

Pick one, document it. The failure you must not ship is "the queue grows silently until the tab
dies".

### TODO 4 — worker recycling

An uncaught error in a worker doesn't replace it. The slot stays marked busy, the in-flight job's
promise never settles, and every job routed there hangs — silently and permanently. Handle
`error` and `messageerror`: reject the in-flight job with something useful, terminate, respawn,
and don't lose the queue.

Also handle the case where a worker fails to *start* at all (a syntax error in the worker script)
— you'll get an `error` event before any job runs, and a pool that spins forever spawning broken
workers is worse than one that fails loudly.

## Think about

- Why can't a busy worker receive a `postMessage`?
- When is `terminate()` the right answer, and what exactly do you lose?
- Your pool has 8 workers and jobs that each allocate 100MB. What's your real constraint?

<details>
<summary>Answers</summary>

**Busy workers.** JavaScript is single-threaded *per agent*. A worker running a synchronous loop
is inside one task; incoming messages queue up and are only delivered when that task returns and
the worker's event loop runs again. This is the same reason a blocked main thread doesn't handle
clicks.

**terminate().** Right when the job is genuinely abandoned (the user navigated away, the query is
obsolete) and you can't rely on the worker cooperating. You lose the thread (10–50ms to respawn),
the JIT warm-up, any cached state in the worker, and any in-flight results. Never use it as your
*only* cancellation mechanism if the worker holds expensive state.

**8 × 100MB.** Memory, not CPU. Each worker has its own heap; 8 concurrent 100MB jobs is 800MB
and a tab crash on a phone. Pool size should be `min(hardwareConcurrency, memoryBudget / jobSize)`
— and for large-payload work the right answer is often a *smaller* pool than the core count.
</details>

---

## 🏗️ Build challenge: a pool worth reusing

Finish the four TODOs, then make it production-grade:

1. **Warm-up**: spawn workers lazily (the first job spawns one) up to `size`, so a page that never
   uses the pool pays nothing. Measure the first-job latency with and without pre-warming and
   decide the default.
2. **Idle timeout**: terminate workers idle for > N seconds, keeping a minimum of 1. Prove memory
   goes back down with a heap snapshot.
3. **Transferable-aware `run()`**: accept a transfer list and pass it through, so large payloads
   cost O(1) (Lab 02).
4. **Timeouts per job**, with the ask-nicely-then-kill escalation.
5. **Observability**: `pool.stats()` returning queue depth, running count, p50/p95 job duration,
   cancellations, crashes, respawns. Add a live visualisation of slot occupancy over time — a
   pool you can't see is a pool you can't tune.
6. **A test suite** covering: cancel-while-queued, cancel-while-running, worker crash mid-job,
   `terminate()` with jobs in flight, and 10,000 queued jobs with backpressure. Every one of these
   is a real production failure.

**Done when:** the crash test leaves a working pool, cancel-while-running actually stops CPU work
within 100ms, and 10,000 queued jobs don't grow the heap unboundedly.

---

## Interview questions

1. Why is spawning a worker per task a bad idea? Give two costs.
2. How do you cancel work that's already running in a worker? Give three approaches and their
   costs.
3. Why can't a busy worker receive a message?
4. How would you size a worker pool, and when is `hardwareConcurrency` the wrong answer?
5. A worker throws an uncaught error. What happens to the pool, and to the job's promise?
6. What's backpressure, and what happens without it?
