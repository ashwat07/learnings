# Lab 02 — Microtask starvation ⭐⭐⭐⭐

**Goal:** internalise that "async" and "yields to the browser" are unrelated properties, by
watching two identical-looking loops produce 0 fps and 60 fps.

**Primary metric:** frames painted per second, and clicks handled, during a 2-second run.

> Open <http://localhost:8080/event-loop/labs/02-microtask-starvation/>

---

## The concept

The browser drains the microtask queue **to empty** before it is allowed to do anything else —
including rendering, including handling your click. So a microtask that queues another microtask
extends the current checkpoint. Do it in a loop and you have built a hang that:

- never paints,
- never handles input,
- cannot be interrupted,
- and in Chrome may not even trigger the "page unresponsive" dialog, because from the browser's
  point of view the page is not stuck in a loop — it is making progress, forever.

An infinite `for` loop is a *better* bug than an infinite microtask loop.

The production version of this is never `queueMicrotask(loop)`. It's this:

```js
async function drainQueue() {
  while (queue.length) {
    await handle(queue.shift());     // handle() resolves synchronously most of the time
  }
}
```

or this:

```js
function poll() {
  return checkCache().then(hit => hit ? hit : poll());   // recursive promise chain
}
```

Both read as "yielding" code. Neither yields to anything that can paint.

## Break it

1. Run **A. plain busy loop**. 2 seconds of nothing. That's your baseline for "blocked".
2. Run **B. queueMicrotask chain**, mashing the poke button. Note the frames painted.
3. Run **C. await in a while loop**. Same numbers. This is the point of the lab: C is the code
   people write when they've been told to "make it async".
4. Run **D. setTimeout chain** and **E. rAF chain**. Now the bar moves and your clicks land.

| Strategy | Frames painted | fps | Clicks handled | Worst frame |
|---|---|---|---|---|
| A. busy loop | | | | |
| B. queueMicrotask chain | | | | |
| C. await in while loop | | | | |
| D. setTimeout chain | | | | |
| E. rAF chain | | | | |
| F. your version | | | | |

Expect A ≈ B ≈ C ≈ 0 frames, and D ≈ E ≈ 60fps but with very different *wall time*: the
setTimeout chain gets clamped to ~4ms per turn after a few levels of nesting (Lab 05), so D does
far less work per second than F should.

## Measure it

1. Performance panel, record, run **C**.
2. You get **one task**, ~2000ms long, flagged red. Expand it: hundreds of tiny slices, all
   inside that one task. No `Frame` markers at all inside it.
3. Now record **D**. Hundreds of separate small tasks with frames interleaved.
4. Look at the *Interactions* track in both. In C, your clicks are recorded but their processing
   is stacked up at the end of the long task — that's an INP of ~2000ms from a single handler.

That contrast — "one long task with internal structure" vs "many short tasks" — is the thing to
recognise in a trace in under five seconds.

## Fix it yourself

Implement `yourYieldingVersion()` in `app.js`. The naive fix (`await yieldToBrowser()` after
*every* unit of work) works but is slow — you pay a full task-scheduling round trip per unit.
The good version works until the frame budget is nearly spent, then yields once.

- [ ] Yield to a queue the browser can render between. Pick one and justify it in a comment.
- [ ] Only yield when you're near the frame deadline (~5ms of work per chunk is a good start).
- [ ] Keep fps ≥ 45 and handle every click.
- [ ] Beat D's wall time — you should be doing far more work per second than a clamped timer chain.

<details>
<summary>Hint 1 — which yield primitive</summary>

| Primitive | Yields to | Cost per yield | Notes |
|---|---|---|---|
| `queueMicrotask` / `await null` | microtask queue | ~0 | **does not let the browser render** |
| `setTimeout(0)` | timer queue | ≥4ms after 5 nested levels | the classic; slow because of the clamp |
| `MessageChannel` postMessage | postMessage queue | ~0.1ms | no clamp — this is why React's scheduler used it |
| `requestAnimationFrame` | render steps | up to 16.7ms | ties you to the frame rate; wrong for non-visual work |
| `scheduler.yield()` | continuation queue | ~0.1ms | Chrome 129+; **keeps your priority** so you resume before other pending tasks |
| `scheduler.postTask()` | task queue at a chosen priority | ~0.1ms | you go behind other tasks |

For a background transform: `scheduler.yield()` with a `MessageChannel` fallback.
</details>

<details>
<summary>Hint 2 — the chunking shape</summary>

```js
const FRAME_BUDGET = 5;                       // ms of work per chunk
let chunkStart = performance.now();
for (const item of items) {
  doWork(item);
  if (performance.now() - chunkStart > FRAME_BUDGET) {
    await yieldToBrowser();
    chunkStart = performance.now();
  }
}
```

Note the deadline check is on *elapsed time*, not item count. Item count is a lie the moment your
items have variable cost — and they always do.
</details>

<details>
<summary>Hint 3 — a yield that actually paints</summary>

```js
const yieldToBrowser = globalThis.scheduler?.yield
  ? () => scheduler.yield()
  : () => new Promise(resolve => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { ch.port1.close(); resolve(); };
      ch.port2.postMessage(null);
    });
```

Do not use `setTimeout(resolve, 0)` in the fallback unless you've measured it. The 4ms clamp
turns a 200-chunk job into a minimum 800ms job on its own.
</details>

---

## 🏗️ Build challenge: `cooperative.js`

Build a small library that makes long jobs cooperative, and prove it on 100k items.

```js
const job = cooperative(items, processItem, {
  budgetMs: 5,
  priority: 'background',      // 'user-blocking' | 'user-visible' | 'background'
  signal: controller.signal,
  onProgress: p => bar.style.width = `${p * 100}%`,
});
await job;                     // resolves with the results array
```

Requirements:

1. Time-sliced, not count-sliced. Adapt `budgetMs` down automatically if you detect you're
   missing frames (measure with rAF deltas).
2. `AbortSignal` support that stops between chunks and rejects with an `AbortError`.
3. Use `scheduler.postTask` when available (with real priorities), falling back to
   `MessageChannel`. Never `setTimeout`.
4. If `navigator.scheduling?.isInputPending?.()` is available, yield immediately when input is
   pending, regardless of remaining budget. Measure whether it actually helps your INP.
5. Progress callbacks must not themselves cause layout thrash — call them at most once per frame.

Then benchmark against the naive versions, at 4× CPU throttle:

| Version | 100k items, wall time | fps during | INP during (click a button repeatedly) |
|---|---|---|---|
| plain `for` loop | | | |
| `await null` per item | | | |
| `setTimeout(0)` per item | | | |
| `cooperative()` | | | |

**Done when:** `cooperative()` is within 25% of the plain loop's wall time while holding ≥45fps
and an INP under 200ms.

---

## Interview questions

1. A colleague says "I made the import loop `async` so it doesn't block the UI." What do you ask
   to find out whether that's true?
2. Why can an infinite microtask loop be harder for a browser to recover from than an infinite
   `while (true) {}`?
3. `await fetch(...)` inside a loop — does *that* let the browser paint? Why is your answer
   different from `await null`?
4. React's scheduler used `MessageChannel` rather than `setTimeout`. Give both reasons.
5. You're told to add a yield to a hot loop and your INP gets worse. Name two ways that happens.
