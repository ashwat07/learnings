# Web Workers & offloading compute ⭐⭐⭐⭐

The main thread is where layout, paint, and every input event live. A worker is a second thread
that has none of those things — no DOM, no `window`, no direct pixels — which is exactly why work
moved there stops causing jank.

The trade is never free: you pay a startup cost, a message-passing cost, and a large increase in
architectural complexity. This course is about knowing when that trade pays.

```sh
./serve.sh    # then http://localhost:8080/web-workers/labs/01-main-thread-blocking/
```

---

## The model

```
main thread                          worker thread
───────────                          ─────────────
DOM, layout, paint, input            no DOM, no layout, no input
your event handlers                  pure computation
  │                                    │
  ├── postMessage(data) ───────────────►  (structured clone: a COPY)
  │                                    │
  ◄──────────────── postMessage(result) ┘
```

Three facts that decide every design:

1. **Messages are copied, not shared.** `postMessage` performs a *structured clone*. Sending a
   50MB array means serialising and copying 50MB — on the main thread, synchronously-ish. That
   copy can cost more than the work you moved.
2. **Unless you transfer.** `ArrayBuffer`s (and a few other types) can be *transferred*: ownership
   moves, nothing is copied, the sender's reference becomes unusable. This is the difference
   between a worker being a win and a worker being a wash.
3. **A worker has a startup cost** — spawning a thread, and parsing/executing its script. Tens of
   milliseconds, more on mobile. Spawning one per task is a common and expensive mistake.

### What can be transferred vs cloned

| Type | Behaviour |
|---|---|
| `ArrayBuffer`, `MessagePort`, `ImageBitmap`, `OffscreenCanvas`, `ReadableStream` | **transferable** — zero copy, sender loses access |
| Typed arrays, `Map`, `Set`, `Date`, `RegExp`, `Blob`, `File`, `Error` | cloned (deep copy) |
| Plain objects and arrays | cloned |
| Functions, DOM nodes, class instances (prototypes are lost), anything with a closure | **throws** `DataCloneError` |
| `SharedArrayBuffer` | shared — both threads see the same memory (needs cross-origin isolation) |

### The decision table

| Situation | Worker? |
|---|---|
| Parsing/transforming a large payload (> ~50ms of CPU) | ✅ |
| Image/video processing, compression, crypto, diffing | ✅ |
| Anything CPU-bound that runs during an interaction | ✅ |
| Work that must touch the DOM | ❌ — it can't |
| Work that's dominated by the size of its input/output | ⚠️ measure the copy first |
| A 5ms task | ❌ — the round trip costs more than the work |
| Work you could simply do less of | ❌ — fix that first |

---

## Curriculum

| # | Lab | Question it answers | ⭐ |
|---|---|---|---|
| 01 | [Main-thread blocking](labs/01-main-thread-blocking/) | What does moving work off the main thread actually buy? | ⭐⭐⭐⭐⭐ |
| 02 | [Message passing costs](labs/02-message-costs/) | Clone vs transfer vs share — with numbers | ⭐⭐⭐⭐⭐ |
| 03 | [Worker pools & cancellation](labs/03-worker-pool/) | How do I run N jobs without spawning N threads? | ⭐⭐⭐⭐ |
| 04 | [An RPC layer](labs/04-rpc/) | How do I make a worker feel like a normal module? | ⭐⭐⭐⭐⭐ |
| 05 | [When *not* to use a worker](labs/05-when-not-to/) | Startup cost, OffscreenCanvas, and the honest alternatives | ⭐⭐⭐⭐ |

## How to measure

Two numbers, always, and they answer different questions:

- **Worst frame / long tasks** — did the jank go away? (Performance panel, or `PerfHUD`.)
- **Wall time end to end** — did the total get *worse*? Moving work to a worker often makes the
  same job take longer overall (copy + startup + round trip) while making the page feel
  dramatically better. Both facts should be in your report.

Always throttle CPU to 4× before concluding anything. A worker's benefit scales with how slow the
device is, which is precisely why it doesn't show up on your laptop.
