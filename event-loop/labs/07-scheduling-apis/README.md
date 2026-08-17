# Lab 07 — Scheduling APIs ⭐⭐⭐⭐

**Goal:** pick the right scheduling primitive on purpose, knowing what each one costs and who it
lets go first.

**Primary metric:** wall time, fps and clicks handled for the same 800ms of work.

> Open <http://localhost:8080/event-loop/labs/07-scheduling-apis/> — Chromium for the full set.

---

## The concept

You have 800ms of work that must happen but isn't urgent. Every option below completes it. They
differ in **what the browser is allowed to do in between** and **what happens under load**.

| API | Queue | Under load | Use it for |
|---|---|---|---|
| plain loop | none | blocks everything | never, above ~5ms |
| `setTimeout(0)` | timer | 4ms clamp per hop | legacy yielding; almost always the wrong choice now |
| `MessageChannel` | postMessage | fast, no clamp | yielding, when you can't use `scheduler` |
| `requestAnimationFrame` | render steps | 1 per frame; **stops in background tabs** | visual work only |
| `requestIdleCallback` | idle | may **never** run without `timeout` | analytics, prefetch, cache warming, log flush |
| `scheduler.postTask` | task, 3 priorities | you go behind existing tasks | discrete jobs with a known urgency |
| `scheduler.yield()` | continuation | you go **ahead** of tasks queued while you worked | yielding inside a long job |

Two details that decide most real choices:

- **`requestIdleCallback` has no SLA.** Under sustained load it runs zero times. The `timeout`
  option converts it from "maybe never" into "at the latest, then" — and once it times out,
  `deadline.timeRemaining()` is 0 and `didTimeout` is true, so *you* must decide whether to do
  the work anyway or reschedule.
- **`scheduler.yield()` beats `postTask` for resuming a loop.** With `postTask` you re-enter at
  the *back* of the queue, so a chatty page can starve your loop and your job takes forever. With
  `yield()` your continuation is prioritised ahead of newly-posted work at the same priority.

### The priorities, concretely

| Priority | Meaning | Examples |
|---|---|---|
| `user-blocking` | The user is waiting and the UI is stuck | Applying a filter they just clicked; hydrating the widget under their cursor |
| `user-visible` (default) | They'll notice, but a frame of delay is fine | Rendering below-the-fold list items; the same priority as `setTimeout` |
| `background` | Nobody is waiting | Prefetching the next route, sending telemetry, warming a cache |

## Break it / measure it

Run A–E, mashing the poke button through each one. Fill in:

| Strategy | Wall ms | Overhead % | fps | Clicks handled | Worst frame |
|---|---|---|---|---|---|
| A. plain loop | | | | | |
| B. setTimeout each | | | | | |
| C. requestIdleCallback | | | | | |
| D. postTask background | | | | | |
| E. chunk + yield | | | | | |
| F. yours | | | | | |

What you should find, and should be able to explain:

- **B is catastrophically slow** — 200 units × 4ms clamp = 800ms of pure scheduling overhead on
  top of 800ms of work. Overhead ~100%.
- **C is smooth but unpredictable.** Its wall time depends entirely on how idle the page is. Run
  the **starve requestIdleCallback** demo to see it go to nearly zero.
- **D is smooth and slow** — a task per unit means a queue round trip per unit.
- **E is smooth *and* fast** — one yield per 5ms of work, so overhead is a few percent.

Then run the **priority ordering** and **TaskController** demos, and read the log.

## Fix it yourself

Implement `yours` in `app.js`:

- [ ] Time-budget chunking like E.
- [ ] Yield immediately when `navigator.scheduling.isInputPending()` is true, mid-budget.
- [ ] Adaptive budget: shrink it when you see frames over 20ms, grow it (max ~10ms) when the page
      is idle. Log every adjustment.
- [ ] `AbortSignal` support.
- [ ] Beat E on clicks handled, within 15% of E's wall time.

Then answer, in a comment in your code: **why isn't `isInputPending()` strictly better than a
small fixed budget?**

<details>
<summary>Hint — the isInputPending shape, and its catch</summary>

```js
const budget = () => performance.now() - start > adaptiveBudget
  || navigator.scheduling?.isInputPending?.({ includeContinuous: false });
```

The catch: `isInputPending()` reports input the browser has **already received and queued**. If
the user hasn't touched the screen yet, it's false, so a 50ms budget with `isInputPending` still
produces a 50ms first-input delay for the tap that arrives 1ms after your check. It reduces the
*average* delay a lot and the *worst case* not at all. Keep a bounded budget as well; use
`isInputPending` to bail out early within it.

`includeContinuous: false` excludes mousemove/pointermove/scroll, which otherwise report pending
almost constantly and turn your loop into a yield-per-unit.
</details>

<details>
<summary>Hint — adaptive budget</summary>

Track frame deltas in a rAF loop. If the last 10 frames' p90 delta is over 20ms, halve the
budget (floor ~1ms). If it's under 18ms for a second, add 1ms (cap ~10ms). Log each change with
the observed frame time so you can defend the tuning later — an adaptive scheduler that nobody
can explain is a scheduler that gets deleted.
</details>

---

## 🏗️ Build challenge: `taskq.js`, a priority task queue

Build the scheduler you'd want in an app, on top of the platform APIs where available and a
polyfill where not.

```js
const q = taskq({ concurrencyModel: 'main-thread' });

const handle = q.push(() => hydrateWidget(el), { priority: 'user-visible', key: 'widget:42' });
q.promote('widget:42', 'user-blocking');     // the user just scrolled to it
q.cancel('widget:42');
await q.drain();                              // resolves when the queue is empty
q.stats();                                    // { queued, ran, droppedFrames, avgSliceMs }
```

Requirements:

1. Three priorities with strict ordering, FIFO within a priority.
2. Dedupe by `key`: pushing the same key twice replaces the pending job rather than running it
   twice. (This one detail deletes a whole class of "re-render storm" bugs.)
3. Uses `scheduler.postTask` + `scheduler.yield` when available; falls back to `MessageChannel` +
   a hand-rolled priority queue. Never `setTimeout`.
4. Time-sliced execution with an adaptive budget and `isInputPending` bail-out.
5. Cancellation via `AbortSignal` *and* by key. Cancelled jobs must never run, and cancelling a
   running job must stop it at the next slice boundary.
6. `q.drain()` must not resolve while background work remains, and must not hang if a job throws.
7. Report honest stats: jobs run, frames dropped while the queue was active, average slice length.

Prove it with a demo page: 500 widgets to hydrate, a scroll container, and a rule that whatever is
in the viewport gets promoted to `user-blocking`. Record a trace at 4× CPU throttle and show:

| | INP while scrolling | time to hydrate all 500 | longest task |
|---|---|---|---|
| hydrate-all-on-load | | | |
| `taskq` | | | |

**Done when:** scrolling stays at 60fps with INP under 200ms while all 500 widgets still finish
hydrating, and killing the promote logic visibly regresses the INP number (so you know the
promotion is what's doing the work).

---

## Interview questions

1. When would you choose `requestIdleCallback` over `scheduler.postTask({priority:'background'})`?
2. What does `deadline.didTimeout` mean, and what should your code do differently when it's true?
3. Why is `scheduler.yield()` better than `scheduler.postTask()` for resuming a chunked loop?
4. `isInputPending()` returns false and 3ms later the user taps. Did the API fail? What does it
   actually guarantee?
5. You ship a feature using `scheduler.postTask`. Safari and Firefox don't support it. What's your
   fallback, and what behaviour do you lose (not just "it still works")?
6. Design the priority for each of: hydrating the visible part of a page, sending analytics,
   prefetching the next route, decoding an image the user is about to see, running spellcheck.
