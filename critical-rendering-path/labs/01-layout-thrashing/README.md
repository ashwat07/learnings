# Lab 01 — Destroy FPS with layout thrashing ⭐⭐⭐⭐⭐

**Goal:** see forced synchronous layout with your own eyes, and never write it again by accident.

**Primary metric:** number of `Layout` entries inside a single task (and the task's duration).

---

## The concept

Style and layout are **batched**. When you write `el.style.width`, the browser marks the node
dirty and moves on — it plans to lay out once, before the next paint. But when you *read* a
geometry property, the answer has to be correct *now*, so the browser must flush the pending
layout synchronously before returning a value.

Do that in a loop and you get one full layout per iteration:

```js
boxes.forEach(box => {
  box.style.width = Math.random() * 500 + 'px';   // dirty
  console.log(box.offsetWidth);                   // ← forced layout, right here
});
```

500 boxes = 500 layouts in one task. The pipeline runs Style→Layout, Style→Layout, Style→Layout…
hundreds of times, all inside one yellow JS block, and the frame is gone.

## Break it

`app.js` ships with `thrash()` — the classic write→read interleave. Open `index.html`, set the
box count to 500, click **Thrash**.

The HUD's worst-frame number will spike. Note it.

## Measure it

1. Incognito window. DevTools → Performance → gear → CPU **4× slowdown**.
2. Record. Click **Thrash**. Stop after ~2 seconds.
3. Find the long task in the Main track. Expand it.
4. You are looking for this shape:

```
Function Call  (thrash)
├─ Recalculate Style
├─ Layout            ← forced
├─ Recalculate Style
├─ Layout            ← forced
├─ Recalculate Style
├─ Layout            ← forced
└─ … ×N
```

5. Bottom-Up → Group by activity. Record **Layout** count and total.
6. Hover a `Layout` entry — DevTools flags forced reflows and links to the source line that
   caused them. Click through and confirm it points at the `offsetWidth` read.

| Metric | Broken | Fixed | Target |
|---|---|---|---|
| Layout entries in the task | | | 1 |
| Task duration | | | < 16ms |
| Worst frame (HUD) | | | < 20ms |
| Recalculate Style total | | | |

Also: turn on `PerfHUD.start({ countReflows: true })` (already enabled in this lab) and run
`PerfHUD.breakdown()` in the console to see which property you read most.

## Why is it slow?

Write it out in one sentence before reading on. The sentence should name the stage and the cause:
*"Layout, run N times per task, because each iteration reads `offsetWidth` after dirtying the
tree."*

## Fix it yourself

`app.js` has three functions stubbed with `TODO`. Implement them in order — each one is a
different real-world shape of the same fix.

- [ ] **`batched()`** — split the loop into a read pass and a write pass. Prove it's 1 layout.
- [ ] **`batchedRaf()`** — same, but the writes happen inside `requestAnimationFrame`. Explain
      why this is *also* important when the reads come from an event handler.
- [ ] **`cachedConstant()`** — the sneaky one: the read is loop-invariant
      (`container.offsetWidth` never changes inside the loop). Hoist it out. Note that this is the
      most common real-world version of the bug.

Constraints: don't change the visual result. Every box must still end up with the same width and
the same reported number as the broken version would have produced.

<details>
<summary>Hint 1 — I batched the reads but still see many Layouts</summary>

Check whether anything inside your "write" pass also reads. `getComputedStyle`, `offsetHeight`,
`scrollTop`, and `getBoundingClientRect()` all count. Also check that the HUD itself isn't the
culprit — it reads nothing, but React DevTools and some extensions do; use incognito.
</details>

<details>
<summary>Hint 2 — Why does rAF matter if I already batched?</summary>

Batching fixes N layouts → 1 layout *within one task*. rAF fixes something else: it ensures your
writes land once per frame, at the point in the frame where the browser was going to lay out
anyway. If a scroll handler fires 5× before the next paint and you write each time, you're
re-dirtying the tree repeatedly. That's Lab 02.
</details>

<details>
<summary>Hint 3 — the layout-invariant read</summary>

```js
const containerWidth = container.offsetWidth; // once, before the loop
for (const box of boxes) box.style.width = containerWidth * Math.random() + 'px';
```
Zero forced layouts. In real code this read is usually hidden behind a helper like
`getSize(el)` three files away — which is why you profile instead of eyeballing.
</details>

---

## 🏗️ Build challenge: `fastdom.js` — a read/write scheduler

Batching by hand works when the reads and writes are in the same function. In a real app they
aren't: a tooltip component measures its anchor, a sticky header writes a transform, a chart
reads its container — all in the same frame, from unrelated modules. Each one is polite on its
own, and together they thrash horribly.

**Build a tiny scheduler that makes cross-module batching automatic.**

```js
// api
fastdom.measure(() => { /* reads only */ });   // returns a Promise of the callback's value
fastdom.mutate(() => { /* writes only */ });
fastdom.clear(handle);                          // cancel a queued job
```

Requirements:

1. All queued `measure` callbacks run before any `mutate` callback, in a single
   `requestAnimationFrame`, so a frame does at most one layout flush.
2. A `mutate` that queues a `measure` must schedule it for the *next* frame, not the current one
   — otherwise you've reintroduced the interleave. Detect that case and warn in dev.
3. Exceptions in one callback must not prevent the rest of the queue from running.
4. `measure`/`mutate` return promises so callers can `await` them, and the promise rejects if the
   callback throws.
5. A dev-mode guard: while a `mutate` phase is running, patch the geometry getters and
   `console.warn` (with a stack) if anything reads. This is the part that will actually catch
   bugs on your team.

Then prove it: build a demo page with 200 independent "widgets", each of which measures its own
position and writes a transform based on it, on every scroll event. Show a Performance trace of
the naive version (200 forced layouts per scroll event) next to the fastdom version (1 layout per
frame). Write the two numbers in your README.

**Stretch:** add `fastdom.measure` support for `ResizeObserver`-driven widgets, and explain why
observer callbacks are a *safe* place to read but still a dangerous place to write.

**Done when:** the demo's scroll trace shows exactly one `Layout` entry per frame at 4× CPU
throttle, and your dev guard fires on a deliberately misplaced read.

---

## Interview questions

Answer out loud, no notes:

1. What is a forced synchronous layout, and how would you spot one in a trace in 10 seconds?
2. Why is `textContent` safe to read but `innerText` not?
3. `requestAnimationFrame` runs before the browser's layout pass. So why doesn't reading
   `offsetWidth` inside rAF still force a layout?
   (Careful — it *can*. When?)
4. You're told "we fixed the jank by wrapping the loop in `setTimeout`." Why is that not a fix?
5. Where would `ResizeObserver` let you delete a forced read entirely?
