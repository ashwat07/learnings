# Lab 01 — Main-thread blocking ⭐⭐⭐⭐⭐

**Goal:** know exactly what a worker buys (responsiveness) and what it doesn't (speed), and where
to put the data boundary.

**Primary metric:** worst frame and clicks handled during the job — *and* total wall time.

> Open <http://localhost:8080/web-workers/labs/01-main-thread-blocking/> at **4× CPU throttle**.

---

## The concept

The main thread runs layout, paint, and every input handler. Any JavaScript that occupies it for
400ms means 400ms with no frames and no input handling. A worker is a second thread with no DOM
— so work moved there cannot block rendering, by construction.

What it does **not** do is make the work faster. Usually it's slightly slower end to end: you've
added a thread spawn, a message round trip, and possibly a large copy. The win is that the user
can keep using the page.

**Report both numbers.** "We moved parsing to a worker; total time went from 420ms to 460ms, and
the page went from 0fps to 60fps with an INP of 40ms instead of 420ms" is a true and persuasive
sentence. "It's faster now" is neither.

## Break it / measure it

| Strategy | Wall ms | Frames | fps | Clicks handled | Worst frame |
|---|---|---|---|---|---|
| A. main thread | | | | | |
| B. chunked, main thread | | | | | |
| C. worker (fetch inside) | | | | | |
| D. worker, main-thread fetch | | | | | |

Watch the two spinners. The CSS one keeps spinning even while everything is frozen — it runs on
the compositor. That makes it a **terrible** loading indicator: your users see motion and conclude
the page is alive while it's completely unresponsive. The rAF-driven one freezes exactly when
input does, which makes it honest.

## The four results, and what each teaches

**A — main thread.** One long task. `response.json()` is a single synchronous parse inside the
engine: you cannot yield inside it, cannot chunk it, cannot stream it into pieces (without a
different parser). This is the canonical case for a worker precisely because it's the one thing
you can't break up.

**B — chunked.** The transform chunks nicely and now costs nothing perceptible. The parse doesn't
change at all — look at the worst frame, it's still roughly `JSON.parse` duration. This is the
honest comparison people skip: **chunking is cheaper than a worker and often enough.** Reach for a
worker when one unbreakable operation dominates.

**C — worker with the fetch inside.** Same wall time, 60fps, every click handled. The JSON bytes
never touch the main thread.

**D — worker, main-thread fetch.** The half-fix, and it's everywhere in real codebases:

```js
const data = await res.json();        // ← the expensive part, still on the main thread
worker.postMessage(data.rows);        // ← and now a 200k-element structured clone, also here
```

You kept both expensive operations and added a copy. Rule: **move the data boundary, not just the
loop.** The ideal message is a URL and a couple of numbers.

## Where the boundary should go

| Job | Send to the worker | Get back |
|---|---|---|
| Parse + aggregate an API response | the URL | the aggregate (small) |
| Resize an image | an `ImageBitmap` or the `Blob` (transferable) | an `ImageBitmap` / `Blob` |
| Diff two large documents | both docs, once | a patch (small) |
| Search a big index | the query; the index lives in the worker | the top 20 hits |
| Render a chart | an `OffscreenCanvas` (transferred once) | nothing |

The pattern: **long-lived state stays in the worker**, and messages carry queries and results,
not data. A worker you send your whole dataset to on every call is a worker that's mostly
performing structured clones.

## Think about

- Why can't `JSON.parse` be chunked, and what would you use if you truly needed a streaming parse?
- The CSS spinner keeps animating during a 400ms block. Is that good or bad?
- Your worker version has a *worse* wall time. How do you present that to a product manager?

<details>
<summary>Answers</summary>

**Streaming parse.** `JSON.parse` is a single synchronous engine call over a whole string — no
yield points exist. If you genuinely need incremental parsing: use a streaming JSON parser over
`response.body` (a `ReadableStream`), switch to NDJSON (one object per line, parse per chunk), or
use a binary format. In practice, moving it to a worker is far less work than any of those, which
is why it's the usual answer.

**The lying spinner.** Bad. It signals "working, hang on" while the page is actually dead, so
users keep clicking, and every click queues up to fire at once when the thread frees. Prefer an
indicator driven by the main thread, or — better — don't block the main thread.

**Presenting a worse wall time.** Lead with the user-facing metric: "interactions during the
import went from 420ms to 40ms; the import itself takes 40ms longer". Nobody perceives total
duration of background work; everybody perceives a frozen page. If pressed, note that the extra
40ms is the copy, and it can be reduced by moving the fetch into the worker.
</details>

---

## 🏗️ Build challenge: make it stream

The worker fixes responsiveness. The *next* problem is that the user still waits for the whole
payload before seeing anything.

Build a streaming pipeline:

```
fetch(url).body  →  worker  →  parse NDJSON per chunk  →  aggregate incrementally
                                        │
                                        └─► postMessage a progress update ~10×/sec
```

Requirements:

1. Add an NDJSON mode to the lab server (or transform in the worker) and consume
   `response.body` as a `ReadableStream` inside the worker, with `TextDecoderStream`.
2. Maintain the aggregate **incrementally** — do not buffer all rows. Prove it: memory stays flat
   as N grows from 10k to 1M. Take heap snapshots.
3. Post progress at a bounded rate (~10/sec), not per row. Posting per row is a self-inflicted
   message storm that will out-cost the parsing.
4. Render partial results as they arrive, without layout thrash (batch DOM writes into one rAF).
5. Support cancellation: an `AbortController` on the main thread stops the fetch and the worker's
   loop within one chunk.
6. Compare, at 4× throttle, for N = 1,000,000:

| | time to first row rendered | time to complete | peak memory | fps |
|---|---|---|---|---|
| main thread, `json()` | | | | |
| worker, `json()` | | | | |
| worker, streaming NDJSON | | | | |

**Done when:** the first rows render in under 200ms for a million-row payload, memory is flat, and
cancelling mid-stream leaves nothing running (verify: no pending fetch, no worker loop, no
timers).

---

## Interview questions

1. Does moving work to a worker make it faster? What does it actually change?
2. Why can't you chunk `JSON.parse`? What are the alternatives?
3. What's wrong with `worker.postMessage(bigArray)`?
4. Where should the fetch happen — main thread or worker — and why?
5. When is chunking on the main thread the better answer than a worker?
6. A CSS spinner animates during a main-thread block. Why is that a problem?
