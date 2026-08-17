# Lab 03 — Frame budget ⭐⭐⭐⭐⭐

**Goal:** treat 16.7ms as a budget you share with the browser, not a target for your code alone.

**Primary metric:** p95 frame time and dropped frames — never average FPS.

> <http://localhost:8080/graphics-and-animation/labs/03-frame-budget/>

---

## The budget

```
~10ms   your JavaScript (be suspicious well before that)
 ~4ms   style + layout
 ~2ms   paint + composite
──────
16.7ms  at 60Hz
```

**And on a 120Hz phone every one of those halves.** The lab measures your display's actual refresh
rate — check it.

**Your code is not the budget, it's a share of it.**

## Four experiments

| | p50 | p95 | dropped |
|---|---|---|---|
| clean animation | | | |
| 12ms of JS per frame | | | |
| layout thrashing | | | |
| one 300ms task | | | |

**Watch p95, not the average.** An animation that averages 12ms and spikes to 90ms four times a
second feels broken, and the average says it's fine. Users perceive the *worst* frames.

**The long task doesn't slow the animation — it stops it**, then it jumps. That discontinuity is far
more noticeable than a consistently lower frame rate, which is why "average FPS" is such a poor
metric. It's also exactly what INP measures as input delay
([web-vitals lab 04](../../../web-vitals-and-react-perf/labs/04-inp/)).

## Layout thrashing

Reading `offsetHeight` after writing `style.height` forces a **synchronous** layout before your next
line runs. In a loop, that's one forced layout per element.

```js
const heights = [...els].map(el => el.offsetHeight);          // all reads
els.forEach((el, i) => el.style.height = heights[i] + 'px');  // all writes
```

The properties that force layout, worth memorising: `offsetTop/Left/Width/Height`,
`clientWidth/Height`, `scrollTop/Height`, `getBoundingClientRect`, `getComputedStyle`, `focus()`,
`scrollIntoView`. Entire lab:
[critical-rendering-path lab 03](../../../critical-rendering-path/labs/14-forced-reflow-detector/).

## What fits

| Work | Cost | Fits? |
|---|---|---|
| a compositor `transform` animation | ~0ms main thread | yes |
| `transform` on 1,000 DOM nodes | 4–15ms | marginal |
| 10,000 `fillRect`s on canvas | 2–6ms | yes |
| a React re-render of ~500 components | 10–40ms | **no** |
| `JSON.parse` of 1MB | 10–30ms | **no** — worker it |
| `getBoundingClientRect` in a 100-item loop after writes | 10–50ms | **no** |

Order-of-magnitude on a mid-range device; measure your own. When something doesn't fit, there are
only two structural moves: **do it somewhere else** (worker, compositor, GPU) or **do less of it**
(virtualize, cull, batch, lower fidelity). "Do it faster" is generally not available — a 40ms React
render doesn't become 10ms by micro-optimising, it becomes 10ms by rendering a quarter as many
components.

## Refresh rates are not 60Hz any more

- **Your budget may be 8.3ms.** Code that "just fits" at 60Hz drops every other frame at 120Hz.
- **Never assume a fixed frame interval.** Animate from the rAF timestamp or a measured delta.
  `x += 5` per frame runs at double speed on a 120Hz display — a real and common bug.
- **`setInterval` is not a frame timer.** It drifts, it's throttled or paused in background tabs, and
  it isn't aligned to the display.

rAF callbacks run **before** style and layout for that frame — which is why read-then-write batching
belongs inside one rAF callback, and why a write followed by a read inside rAF is still a forced
layout.

## Measuring

| Tool | Gives |
|---|---|
| Performance panel | the full frame breakdown with causality — always start here |
| Rendering → Frame Rendering Stats | a live FPS overlay with dropped frames |
| Rendering → Paint flashing | what repaints, and how much |
| `PerformanceObserver('longtask')` | tasks over 50ms, in production |
| **`long-animation-frame`** | the **script and character position** that caused a slow frame — the best field tool available |

```js
new PerformanceObserver(l => { for (const e of l.getEntries()) report(e); })
  .observe({ type: 'long-animation-frame', buffered: true });
```

Measure with the **same** CPU throttle before and after, or the comparison is fiction.

## Think about

- Your animation averages 58 FPS. Is it smooth?
- Where do rAF callbacks run relative to style and layout?
- Why is one 300ms task worse than 20 frames at 15ms?

<details>
<summary>Answers</summary>

**58 FPS average.** Unknowable — that number is consistent with perfectly smooth 60Hz with two
dropped frames a second, *and* with 55 perfect frames plus three 100ms stalls. Look at the frame-time
distribution and the dropped-frame count. Average FPS is the single most misleading animation metric
in common use.

**rAF timing.** Callbacks run at the start of the frame, *before* style recalculation and layout —
that's what makes it the right place to batch DOM writes, and why a write-then-read inside rAF still
forces a synchronous layout (you've asked for a value that depends on work scheduled for later in the
same frame).

**One 300ms task vs 20 slow frames.** The long task is a *discontinuity*: motion stops dead and then
jumps, which the visual system notices immediately, and any input during it is queued — so it damages
responsiveness as well as smoothness. Twenty frames at 15ms is a uniformly slightly-slower animation,
which is far less perceptible and doesn't block input at all.
</details>

---

## 🏗️ Build challenge

1. Add a debug overlay to your app: rAF deltas, p50/p95, dropped-frame count.
2. Add `long-animation-frame` reporting to production. Group by the attributed script.
3. Find your worst animation at 4× throttle and identify which stage owns the time.
4. Fix the top offender using "somewhere else" or "less of it". Re-measure at the same throttle.
5. Audit for `setInterval` used as an animation timer.
6. Test on an actual 120Hz device — or force it, and check nothing runs at double speed.

**Done when:** you can state p95 frame time for your three key animations at 4× throttle.

---

## Interview questions

1. What's in the 16.7ms besides your code?
2. Why p95 rather than average FPS?
3. What is a forced synchronous layout, and how do you avoid it?
4. What changes at 120Hz?
5. What does `long-animation-frame` give you that `longtask` doesn't?
