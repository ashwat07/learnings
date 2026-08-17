# Event loop & scheduling ⭐⭐⭐⭐⭐

You know `setTimeout` runs "later" and promises run "sooner". That's not the same as knowing the
event loop. This course ties the loop to the two things it actually decides in production: **why
the page janks**, and **when your work gets to run**.

Run everything through the lab server:

```sh
./serve.sh    # from the repo root, then open http://localhost:8080/event-loop/labs/01-task-vs-microtask/
```

---

## The loop, once, properly

One iteration of the event loop, in the order the HTML spec runs it:

```
┌─ pick ONE task from a task queue ──────────────────────────────────┐
│  run it to completion — nothing can interrupt it                   │
└────────────────────────────────────────────────────────────────────┘
        │
┌─ microtask checkpoint ─────────────────────────────────────────────┐
│  drain the microtask queue COMPLETELY                              │
│  microtasks queued by microtasks run in the SAME checkpoint        │
└────────────────────────────────────────────────────────────────────┘
        │
┌─ "update the rendering" — only if the browser decides to render ───┐
│  1. run resize / scroll observers                                  │
│  2. run IntersectionObserver callbacks                             │
│  3. run requestAnimationFrame callbacks   (microtask checkpoint    │
│     … between each callback)                                       │
│  4. run ResizeObserver callbacks (can loop, max depth)             │
│  5. style → layout → paint → composite                             │
└────────────────────────────────────────────────────────────────────┘
        │
┌─ if there's spare time before the next frame ──────────────────────┐
│  run requestIdleCallback callbacks                                 │
└────────────────────────────────────────────────────────────────────┘
        └──► back to the top
```

Four facts that fall out of that diagram, and that most people get wrong:

1. **A task runs to completion.** There is no preemption. A 300ms function is a 300ms freeze:
   no input handled, no frame painted, no timer fired. This is why "long task" is the unit of
   jank measurement.
2. **The microtask queue is drained to empty, not one-per-turn.** A microtask that queues another
   microtask keeps the checkpoint going. That's an infinite loop the browser cannot escape — see
   Lab 02.
3. **Rendering is not a task you can queue.** It happens *between* tasks, when the browser wants
   a frame. You cannot force it, you can only get out of its way. `requestAnimationFrame` is the
   only hook that runs at a known point in it.
4. **"Async" does not mean "yields".** `await` yields to the *microtask* queue, which runs before
   the browser can render. A loop of a thousand `await`s that never touches a task queue blocks
   the frame just as hard as a `for` loop.

### Task sources are not one queue

The spec says "a task queue", plural. A browser can and does prioritise between them, so
ordering *between different sources* is not something to rely on:

| Source | Examples |
|---|---|
| Timers | `setTimeout`, `setInterval` (clamped, see Lab 05) |
| DOM manipulation | `MessageChannel` / `postMessage`, `MutationObserver`… no wait, that one's a microtask |
| User interaction | `click`, `keydown`, `pointermove` — usually the highest priority queue |
| Networking | `fetch` response arrival, `XHR` events |
| Idle | `requestIdleCallback` |

Microtask sources are much shorter: promise reactions, `queueMicrotask`, `MutationObserver`
callbacks, and `await` continuations.

### The budget

| Target | Budget |
|---|---|
| One frame at 60Hz | **16.7ms** (you own ~10) |
| One frame at 120Hz | 8.3ms |
| "Long task" (Lighthouse, PerformanceObserver) | anything **> 50ms** |
| Good INP (p75) | **< 200ms** from input to next paint |
| Chrome's own advice for a single JS block | keep it under 50ms, ideally under 16 |

---

## Curriculum

| # | Lab | What it makes automatic | ⭐ |
|---|---|---|---|
| 01 | [Task vs microtask](labs/01-task-vs-microtask/) | Predict the exact order, every time | ⭐⭐⭐⭐⭐ |
| 02 | [Microtask starvation](labs/02-microtask-starvation/) | Why an infinite microtask loop is worse than an infinite `for` | ⭐⭐⭐⭐ |
| 03 | [Long tasks & yielding](labs/03-long-tasks-and-yielding/) | Chunking, `scheduler.yield()`, INP under load | ⭐⭐⭐⭐⭐ |
| 04 | [Frame timing](labs/04-frame-timing/) | rAF vs timers, where rendering sits, animation drift | ⭐⭐⭐⭐⭐ |
| 05 | [Timer clamping & throttling](labs/05-timer-clamping/) | 4ms nesting clamp, background tabs, `setInterval` pile-up | ⭐⭐⭐⭐ |
| 06 | [async/await traps](labs/06-async-await-traps/) | Where the ticks actually go; sequential vs parallel awaits | ⭐⭐⭐⭐⭐ |
| 07 | [Scheduling APIs](labs/07-scheduling-apis/) | `requestIdleCallback`, `scheduler.postTask`, priorities, `isInputPending` | ⭐⭐⭐⭐ |

Do 01 and 02 back to back — 02 is only shocking if 01 is fresh.

## The one-sentence test

At the end of this course you should be able to answer, with no hedging:

- Why does `await` inside a `for` loop over 10,000 items still freeze the page?
- Why does `setTimeout(fn, 0)` not run in 0ms — and what does it actually run in?
- Why can a `MutationObserver` callback jank a frame that a `setTimeout` callback cannot?
- Where exactly does React's concurrent scheduler yield, and to what?
- Your click handler takes 8ms. INP is 450ms. Where did the other 442ms go?
