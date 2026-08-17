# Lab 01 — Task vs microtask ⭐⭐⭐⭐⭐

**Goal:** predict the exact execution order of any mix of `setTimeout`, promises, `await`, rAF,
observers and events — and be able to explain each position from the loop diagram.

**Primary metric:** how many of the six demos you get right *before* clicking, with reasons.

> Open <http://localhost:8080/event-loop/labs/01-task-vs-microtask/> (needs `./serve.sh`).

---

## The concept

Two queues, and they are not peers.

| | Task queue ("macrotask") | Microtask queue |
|---|---|---|
| Who queues into it | timers, events, network, `postMessage`, idle | promise reactions, `queueMicrotask`, `await`, `MutationObserver` |
| How many run per turn | **exactly one** | **all of them**, including ones queued while draining |
| Can the browser render in between | yes — that's the point | **no** |
| Can it starve the loop | no | yes (Lab 02) |

The whole model in one sentence: **the browser runs one task, then empties the microtask queue,
then maybe renders, then repeats.**

Everything confusing about "async ordering" falls out of that sentence plus one detail: a
microtask checkpoint also happens whenever the JS stack empties — which is why microtasks
interleave *between* individual rAF callbacks in a single frame.

## Predict first

Fill this in before you touch the page. Write the order as a list; you'll grade yourself.

| Demo | Your predicted order | Right? |
|---|---|---|
| 1. ordering baseline (9 lines) | | |
| 2. microtask drain (7 lines) | | |
| 3. rAF interleave (7 lines) | | |
| 4. observers (7 lines) | | |
| 5. nesting (8 lines) | | |
| 6. task sources (6 lines) | | |

The specific traps, if you want to check your reasoning is for the right reason:

- Demo 1: where does `sync B` (inside the async function, *before* the `await`) go?
- Demo 3: does the microtask queued inside rAF callback 1 run before or after rAF callback 2?
- Demo 4: `MutationObserver` — microtask or task? What about `IntersectionObserver`?
- Demo 6: is `dispatchEvent` asynchronous?

## Measure it

The log proves the order. The Performance panel proves the *shape* — that microtasks are inside
the same task block and tasks are not.

1. DevTools → Performance → record → click **1. ordering baseline** → stop.
2. In the Main track you will see one task containing the sync lines and all the microtasks,
   then separate small tasks for each timer, then a `Frame` with the rAF callback inside.
3. Confirm: there is **no** "Frame"/paint between the sync code and the microtasks. There *is*
   one before the rAF callback.
4. Now record demo 2. The five chained microtasks are all inside the same task block. That's the
   picture you want burned in.

<details>
<summary>Answers — demo 1</summary>

```
sync A
sync B        ← async function bodies run synchronously up to the first await
sync C
Promise.then          ┐
queueMicrotask        │ microtask checkpoint, in registration order
after await null      ┘
MessageChannel onmessage    ← a task, but from the postMessage queue (no timer clamp)
setTimeout(0)               ← timer queue; 0 is clamped, see Lab 05
setTimeout(1)
requestAnimationFrame       ← render steps: needs a frame, so it waits for one
requestIdleCallback         ← only when the browser has slack
```

The `MessageChannel`/`setTimeout` relative order is the one line you should *not* rely on across
browsers — different task sources, browser's choice. Everything above it is guaranteed.
</details>

<details>
<summary>Answers — demo 3, and why it matters</summary>

```
rAF callback 1
  microtask queued by rAF 1
rAF callback 2
  microtask queued by rAF 2
rAF callback 3
  microtask queued by rAF 3
rAF registered inside a rAF → next frame
```

Why it matters: `await` inside a rAF callback does **not** move you to the next frame. It moves
you a few microseconds later, *still before layout and paint of this frame*. People write
`await this.measure()` inside rAF thinking they've deferred the work to next frame; they haven't,
and if `measure()` reads geometry after a sibling callback wrote to the DOM, they've just bought
a forced synchronous layout.
</details>

<details>
<summary>Answers — demo 4</summary>

`MutationObserver` is a **microtask**. Its records are queued during DOM mutation and delivered
at the next checkpoint — before rendering.

`IntersectionObserver` and `ResizeObserver` are **render-step callbacks**, run once per frame as
part of "update the rendering" (IO before rAF, RO after).

Consequence: a `MutationObserver` callback that does expensive work delays the very frame it is
reacting to, and it can re-trigger itself into a loop that never lets a frame out. A
`ResizeObserver` that resizes things has a spec-defined depth limit and will log
"ResizeObserver loop completed with undelivered notifications" rather than hang. One of these
failure modes is much friendlier than the other.
</details>

## The bit people actually get wrong at work

```js
// "I made it async so it doesn't block the UI"
async function processAll(items) {
  for (const item of items) {
    await transform(item);          // transform() is synchronous CPU work
  }
}
```

`await` on an already-resolved value yields to the **microtask** queue. The browser cannot render
between microtasks. 10,000 items × 0.2ms is a 2-second freeze, exactly as if you'd written a
plain `for` loop — you've just made it harder to see in a profile, because the flame chart is
now 10,000 tiny slices inside one task instead of one fat one. Lab 03 fixes this properly.

---

## 🏗️ Build challenge: an ordering test harness

Prediction is a skill; a test suite is proof. Build `order-test.js`:

```js
const t = orderTest();
t.sync('a');
t.micro('b');            // queueMicrotask
t.task('c');             // setTimeout 0
t.frame('d');            // rAF
await t.settle();        // resolves once nothing is left in any queue
t.expect(['a', 'b', 'c', 'd']);   // throws with a diff if wrong
```

Requirements:

1. `settle()` must resolve only after all queues are empty — including the idle callback, which
   may take several frames. Do it without a fixed `setTimeout(500)`.
2. Record a real timestamp *and* a monotonically increasing sequence number for each entry, and
   report both in the failure diff.
3. Add `t.frameOf(label)` returning which frame number an entry ran in, so you can assert
   "these three ran in the same frame".
4. Write at least 12 assertions covering every ordering fact in this lab, and run them in
   Chrome, Firefox and Safari. **Write down every disagreement you find** — they are all
   legitimate (different task queues, different priorities), and knowing which orderings are
   guaranteed is more valuable than knowing what Chrome does.

**Stretch:** add `t.longTask(ms)` that blocks the main thread, and assert that the frame
containing it is late. That's the bridge to Lab 03.

**Done when:** your suite passes in three browsers, or you can explain each failure by pointing
at the spec text ([HTML spec §event loop processing model](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model)).

---

## Interview questions

1. `Promise.resolve().then(f)` and `queueMicrotask(f)` — is there any observable difference?
2. Why is `setTimeout(fn, 0)` not a way to "run this after the DOM updates", and what is?
3. A `MutationObserver` callback mutates the DOM again. What happens? Now make it a
   `ResizeObserver`. What's different, and why did the spec authors treat them differently?
4. You need to run a callback after the browser has painted your DOM change. Write it.
   (`rAF` alone is wrong. Why?)
5. Explain why `await` is not a yield point for rendering, in one sentence, to a junior dev.
