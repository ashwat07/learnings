# Lab 02 — Message passing costs ⭐⭐⭐⭐⭐

**Goal:** know what `postMessage` costs for each payload shape, and be able to turn an O(n) message
cost into an O(1) one.

**Primary metric:** milliseconds the main thread is *blocked* by `postMessage`, and one-way
latency.

> Open <http://localhost:8080/web-workers/labs/02-message-costs/>
> For the `SharedArrayBuffer` demo: <http://localhost:8080/web-workers/labs/02-message-costs/?isolate=1>

---

## The concept

`postMessage` performs a **structured clone**: a deep copy, serialised synchronously on the
sender's thread and deserialised on the receiver's.

```
main thread                                   worker
  serialise (BLOCKS the main thread)  ──────►  deserialise
```

The serialisation is the number that matters and the one most benchmarks miss — measuring only
the round trip hides the fact that half of it blocked your UI.

## Measure it

500,000 elements, same data, four representations:

| Payload | MB | postMessage blocked | one-way | MB/s |
|---|---|---|---|---|
| (empty message) | 0 | | | – |
| array of objects | | | | |
| `Float64Array` (cloned) | | | | |
| `ArrayBuffer` (transferred) | | | | |
| `SharedArrayBuffer` | | | | |

What you should see, and why:

- **Empty message**: 0.1–1ms. That's the floor per round trip. At 0.5ms each, a worker call per
  item over 10,000 items is 5 seconds of pure scheduling.
- **Array of objects**: the worst case — every key, string and boolean is walked and rebuilt.
  Often under 100MB/s.
- **Typed array (cloned)**: a flat byte block, essentially a memcpy. Often 10–50× faster than the
  object array. **If your data can be a typed array, make it one.**
- **Transferred `ArrayBuffer`**: near zero, and *constant* regardless of size. Ownership moves.
- **`SharedArrayBuffer`**: zero, and both sides keep access.

## Transfer

```js
worker.postMessage({ buffer }, [buffer]);   // second argument = the transfer list
// buffer.byteLength is now 0 on this side. It's gone.
```

Transferable: `ArrayBuffer`, `MessagePort`, `ImageBitmap`, `OffscreenCanvas`, `ReadableStream`,
`WritableStream`, `TransformStream`.

The catch is in the "what happens after you transfer?" demo: the sender's buffer is **detached**.
Writes to a view over it silently do nothing in some engines rather than throwing — which is how
"transfer then keep using it" survives code review.

Practical pattern: **ping-pong the buffer.** Send it, let the worker fill it, get it back in the
reply — one allocation reused forever, no copies in either direction. This is how audio and video
pipelines are built.

## SharedArrayBuffer, and why it's hard to get

`SharedArrayBuffer` requires **cross-origin isolation**:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

…and then every cross-origin subresource needs `Cross-Origin-Resource-Policy` or CORS. That's a
real deployment cost — third-party scripts, ads and embeds often break.

The reason is Spectre: shared memory plus a high-resolution timer is enough to build a
speculative-execution side channel that reads other origins' data out of the same process.
Isolation guarantees no cross-origin document shares your process.

And once you have it, you have genuine concurrency:

| Need | Use |
|---|---|
| Ordering / visibility between threads | `Atomics.store` / `Atomics.load` |
| Block until a value changes | `Atomics.wait` (**worker only** — forbidden on the main thread) |
| Wake a waiting thread | `Atomics.notify` |
| Non-blocking wait on the main thread | `Atomics.waitAsync` |

Use it for wasm heaps, audio buffers, and tight producer/consumer loops. Don't use it to avoid a
copy of your app state — the debugging cost of a race dwarfs the 3ms you saved.

## What can't be cloned

Run the demo. The one to notice: a **class instance clones successfully and comes back as a plain
object** — prototype gone, methods gone, no error. Functions, DOM nodes and objects containing
methods throw `DataCloneError`.

`structuredClone()` is available on the main thread and uses the exact same algorithm. Test your
payloads with it directly rather than debugging from inside a worker.

## Rules of thumb

1. **Move the data boundary, not the loop.** The best message is a URL and a couple of numbers.
2. **Keep long-lived state in the worker.** Send queries, get answers back.
3. **Batch messages.** Per-item messaging is the most common worker performance bug — the
   scheduling cost dominates everything.
4. **Prefer typed arrays; transfer them; reuse them.**
5. **Measure the blocked time, not just the round trip.**

## Think about

- You send 200,000 objects to a worker and it does 50ms of work on them. Was the worker worth it?
- Why does sending a JSON *string* rarely help?
- Your worker sends progress updates per row. What's wrong, and what's the fix?

<details>
<summary>Answers</summary>

**200k objects for 50ms of work.** Almost certainly not: the clone alone will cost more than
50ms, and half of that blocks the main thread — the exact thing you were trying to protect. Either
move the data production into the worker, or use a typed array, or do the work on the main thread
in chunks.

**JSON strings.** Structured clone of an object is usually faster than `stringify` + `parse`, and
you pay for the intermediate string as well. The exception: when the data *arrives* as a string
(from the network) — then pass the string and parse it in the worker, and never parse on the main
thread just to clone the result.

**Per-row progress.** At ~0.3ms per message, 200,000 progress messages is a minute of scheduling
overhead, and each one wakes the main thread. Post at a bounded rate (~10/sec), carrying a count
rather than a row.
</details>

---

## 🏗️ Build challenge: a zero-copy pipeline

Build an image-processing pipeline where **no pixel data is ever copied**:

```
<input type=file> → createImageBitmap() → transfer to worker → OffscreenCanvas →
  filter kernel over a reused ArrayBuffer → transfer the result back → drawImage
```

Requirements:

1. Use `createImageBitmap` (transferable) rather than reading pixels on the main thread.
2. Allocate the working buffer **once** and ping-pong it between threads — assert with
   `byteLength` checks that no new allocation happens per frame.
3. Process video: pull frames from a `<video>` at 30fps, run the filter, display in a canvas.
   Hold 60fps on the main thread at 4× CPU throttle.
4. Add a `SharedArrayBuffer` variant behind a feature check, using `Atomics.waitAsync` on the main
   thread and `Atomics.wait` in the worker for a lock-free double buffer.
5. Benchmark all three (clone / transfer / shared) at 1080p, reporting main-thread blocked time
   per frame — that's the number that decides whether the UI is usable.

**Stretch:** move the whole rendering into the worker with `OffscreenCanvas` so the main thread
does *nothing* per frame, and compare.

**Done when:** at 1080p30 your main thread is blocked for under 1ms per frame in the transfer
version, and you can explain the remaining cost.

---

## Interview questions

1. What does `postMessage` do to its argument?
2. Which part of a `postMessage` blocks the main thread?
3. What's transferable, and what happens to your reference afterwards?
4. Why does `SharedArrayBuffer` need special headers?
5. You send a class instance to a worker. What arrives?
6. A colleague sends 100,000 messages instead of one array. What do you tell them, with a number?
