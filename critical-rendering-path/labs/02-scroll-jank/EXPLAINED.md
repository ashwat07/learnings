# Lab 02 — Scroll jank, explained from scratch

`README.md` is the assignment. This is the worked explanation: what the problem actually is,
how the browser really behaves, what every line of the solution does, and — most importantly —
how to tell a real win from a fake one.

---

## Table of contents

1. [The problem in one sentence](#1-the-problem-in-one-sentence)
2. [Background: what the browser does every frame](#2-background-what-the-browser-does-every-frame)
3. [Background: why scroll is the most dangerous event on the platform](#3-background-why-scroll-is-the-most-dangerous-event-on-the-platform)
4. [The frame budget](#4-the-frame-budget)
5. [The broken version, line by line](#5-the-broken-version-line-by-line)
6. [The cost model — and how to predict a fix before writing it](#6-the-cost-model--and-how-to-predict-a-fix-before-writing-it)
7. [How to measure](#7-how-to-measure)
8. [False wins: the four traps](#8-false-wins-the-four-traps)
9. [The harness code](#9-the-harness-code)
10. [Strategy 2 — rAF coalescing](#10-strategy-2--raf-coalescing)
11. [Strategy 3 — transform only](#11-strategy-3--transform-only)
12. [Strategy 4 — visible rows only](#12-strategy-4--visible-rows-only)
13. [Strategy 5 — no JavaScript at all](#13-strategy-5--no-javascript-at-all)
14. [Strategy 6 — content-visibility](#14-strategy-6--content-visibility)
15. [Passive listeners](#15-passive-listeners)
16. [Results table](#16-results-table)
17. [Interview questions, answered](#17-interview-questions-answered)
18. [Takeaways](#18-takeaways)

---

## 1. The problem in one sentence

We have 10,000 elements whose width is driven by scroll position, and we update all of them on
every scroll event — which means we do 10,000 layout-invalidating writes roughly 60 times a
second, on the one thread that also has to draw the page.

The result is ~16fps, 60+ long tasks in a 5-second recording, and worst frames near 180ms.

The lab's real lesson is not "use rAF" or "use transform." It is: **you cannot fix what you have
not measured, and three of the four obvious fixes attack the wrong factor.**

---

## 2. Background: what the browser does every frame

The browser runs a pipeline. Chrome's DevTools names each stage, and you'll see these exact names
in the Performance panel's Bottom-Up view:

```
  JavaScript
      ↓
  Recalculate Style   ← which CSS rules apply to which elements; compute final values
      ↓
  Layout              ← where is everything, and how big (geometry)
      ↓
  Pre-paint           ← update the transform / clip / effect property trees
      ↓
  Paint               ← record a display list ("draw a rounded rect here, gradient there")
      ↓
  Layerize            ← group content into compositor layers
      ↓
  Commit              ← hand the layer tree to the compositor thread
      ↓
  Raster + Draw       ← compositor thread + GPU. NOT on the main thread.
```

Everything above `Commit` runs on the **main thread** — the same thread as your JavaScript. If a
frame's main-thread work exceeds the frame budget, the frame is late. That's jank.

The critical property of this pipeline: **you enter it at different points depending on what you
changed.**

| What you change | Stages that must re-run |
|---|---|
| `width`, `height`, `top`, `margin`, `font-size` … | Style → **Layout** → Pre-paint → Paint → Composite |
| `background`, `color`, `box-shadow`, `border-radius` … | Style → Pre-paint → Paint → Composite |
| `transform`, `opacity`, `filter` | Style → Pre-paint → **Composite** (Layout skipped; Paint often skipped) |

This table *is* the lab. Strategy 3 exists purely to move from row 1 to row 3.

Note the subtlety in row 3: `transform` skips Layout unconditionally, but you only skip
**Recalculate Style** if the change doesn't come from JavaScript touching `element.style`. Setting
`row.style.transform = ...` still dirties that element's style. A CSS animation (strategy 5) does
not — which is why strategy 5 is a different tier of fast, not just a stylistic preference.

---

## 3. Background: why scroll is the most dangerous event on the platform

**Scrolling is normally free.** The compositor thread already has the layer tree. To scroll, it
re-draws the existing layers at a different offset. The main thread isn't involved at all. This is
why a page with a completely blocked main thread can still scroll smoothly — try it with the
"block main thread 500ms every 3s" checkbox.

You give up free scrolling in three ways:

1. **A non-passive `wheel` / `touchstart` / `touchmove` listener.** The compositor cannot know
   whether you'll call `preventDefault()`, so it must stop and ask the main thread before it is
   allowed to scroll. If the main thread is busy, scrolling stalls. `{ passive: true }` is a
   promise that you won't cancel, which lets the compositor proceed immediately.
2. **A `scroll` handler that does real work.** The work lands on the main thread, per frame.
3. **A handler that both reads geometry and writes to the DOM.** Now you have forced synchronous
   layout (layout thrashing — Lab 01) at 60Hz.

### When does a scroll event actually fire?

This matters enormously, and almost everyone gets it wrong. Per the HTML spec, each frame the
browser runs an "update the rendering" sequence, in this order:

```
  1. run the resize steps
  2. run the scroll steps          ← your `scroll` handlers fire HERE
  3. evaluate media queries
  4. update animations and send events
  5. run the animation frame callbacks  ← your requestAnimationFrame callbacks fire HERE
  6. run the update intersection observations steps  ← IntersectionObserver callbacks HERE
  7. update the rendering (style, layout, paint, commit…)
```

Three consequences you should carry around permanently:

- **`scroll` on the document/window fires at most once per frame.** The browser coalesces it for
  you, before your code ever runs. This is why strategy 2 does nothing (see §10).
- **rAF runs after scroll, in the same frame.** So deferring a write from a scroll handler into rAF
  costs you no latency — the write still lands before that frame paints.
- **IntersectionObserver callbacks are delivered *after* rAF, in the same frame.** So inside your
  rAF you are reading the visibility state from the *previous* frame. That's why strategy 4 needs
  a `rootMargin` buffer (see §12).

`scroll` is also **not cancelable** — it fires after the scroll has already happened. So
`{ passive: true }` on a `scroll` listener changes nothing at all. It matters on `wheel` and
`touchmove`.

---

## 4. The frame budget

| Refresh rate | Budget per frame | Realistic budget for your code |
|---|---|---|
| 60Hz | 16.7ms | ~10ms (the browser needs the rest) |
| 120Hz | 8.3ms | ~5ms |

A "long task" is >50ms of uninterrupted main-thread work — three frames' worth at 60Hz. The
baseline in this lab produces 60+ of them in five seconds, with the longest at 183ms.

**Always profile with CPU throttling on (4×).** Your laptop is not your users' phone. A bug that
is invisible at 1× is obvious at 4×.

---

## 5. The broken version, line by line

```js
function broken() {
  return listen('scroll', () => {              // 1
    eventCount++;
    updateCount++;
    const y = window.scrollY;                  // 2
    rows.forEach(row => {                      // 3
      row.style.width = 60 + (y % 300) + 'px'; // 4
    });
  });
}
```

1. **A `scroll` listener with no coalescing.** Fires once per frame. Everything inside runs on the
   main thread, inside the frame that's trying to render.
2. **`window.scrollY` is a layout-dependent read.** If layout is currently dirty, reading it forces
   the browser to synchronously flush layout *right now* to give you an accurate number. Here it
   happens to be safe, because the read comes before the writes in the same task — but reverse
   those two lines and you'd have a forced reflow every frame.
3. **10,000 iterations.** The loop itself is cheap JavaScript (~5ms). This is a decoy: it shows up
   as only ~8% of the trace. The expensive part is what the loop *causes*.
4. **The actual crime, twice over.** `row.style.width` is (a) an inline style write, which
   invalidates that element's computed style, and (b) a **layout property**, which invalidates
   geometry. 10,000 elements × per frame = full Style + Layout + Pre-paint + Paint over the whole
   list, every frame.

Baseline measurement (5s recording, 10,000 rows, 4× throttle):

| Stage | Self time | Share |
|---|---|---|
| Layout | 1247ms | 30.9% |
| Recalculate style | 1045ms | 25.9% |
| Pre-paint | 566ms | 14.0% |
| Paint | 474ms | 11.8% |
| **rendering subtotal** | **~3.3s** | **~83%** |
| Scripting (the loop itself) | ~334ms | 8.3% |

**Read that table before optimizing anything.** It says the JavaScript is 8% of the problem. Any
"fix" that targets the JavaScript is capped at an 8% improvement. That single observation predicts
the outcome of strategy 2 exactly.

---

## 6. The cost model — and how to predict a fix before writing it

Model the per-frame main-thread cost as:

```
  total_ms  =  passes  ×  cost_per_pass
  cost_per_pass  =  N_elements  ×  cost_per_element(property)
```

Three independent factors. Each strategy attacks exactly one:

| Strategy | Factor attacked | Mechanism |
|---|---|---|
| 2. `rafCoalesced` | `passes` | at most one write pass per frame |
| 3. `transformOnly` | `cost_per_element` | pick a property that skips the Layout stage |
| 4. `visibleOnly` | `N_elements` | 10,000 → ~40 |
| 5. `cssOnly` | all of it | move the work off the main thread entirely |
| 6. `content-visibility` | `N_elements` | let the browser skip off-screen work for you |

### Predicting with Amdahl's law

```
  speedup = 1 / ((1 − p) + p/s)
```

where `p` is the fraction of recording time the change targets (read straight off Bottom-Up) and
`s` is how much faster that part gets. Worked examples from the baseline above:

- **Strategy 2** targets `passes`, which is already 1 per frame. `p ≈ 0` → predicted speedup
  **1.0×**. Zero. Measured: zero.
- **Strategy 3** eliminates Layout (30.9%) and most of Paint (11.8%). `p ≈ 0.42`, `s ≈ ∞` →
  predicted **~1.7×**. Recalculate Style survives, which is what caps it.
- **Strategy 4** shrinks `N` by 250×, and *every* rendering stage scales with `N`. `p ≈ 0.9+` →
  the speedup is large enough that you should predict a target frame time, not a ratio.

### Deriving your own constant

From any trace: `busy_ms ÷ pass_count ÷ N_elements` = ms per element per pass. Read `pass_count`
off the page's readout (`DOM update passes`). Once you have that constant you can predict any
combination of row count and strategy arithmetically, before writing a line.

**Validate the model cheaply:** rebuild at 1,000 rows instead of 10,000 on `broken`. Busy time
should drop ~10×. If it does, cost is linear in `N`, and you've pre-confirmed that strategy 4 is
where the win lives.

---

## 7. How to measure

### Setup

1. DevTools → Performance → gear icon → **CPU: 4× slowdown**.
2. Record → **scroll steadily for ~5 seconds** → stop. Use the same gesture every time; a mouse
   wheel and a trackpad drag are not the same workload.
3. Pick the same strategy, same row count, and reset the HUD between runs.

### What to read, in priority order

| Where | What | Why |
|---|---|---|
| **Bottom-Up, as percentages** | Layout / Recalculate style / Pre-paint / Paint | The shape of the work. Percentages compare across recordings of different lengths; raw ms do not. |
| **HUD** | `long tasks >50ms`, `longest task` | The honest jank numbers. |
| **HUD** | `worst frame (ever)` | One bad frame is a visible stutter. |
| **Page readout** | `events handled` vs `DOM update passes` | Whether coalescing did anything. |
| **HUD** | `geometry reads` | Forced-reflow counter. Should be 0 in every strategy here. |
| **Frames track** | count of red / partially-presented frames | What the user actually perceives. |
| **Main track** | are tasks back-to-back with no idle gaps? | That's what "saturated main thread" looks like. |

### Two HUD gotchas

- **`FPS` and `worst frame (1s)` are only meaningful mid-scroll.** They're computed from rAF ticks;
  read them after you stop and they show an idle 120fps, which is meaningless. In the traces from
  this lab, `FPS: 119` sat right next to `61 long tasks` — the FPS number was stale.
- **`geometry reads` does not catch `window.scrollY`.** `PerfHUD.start({ countReflows: true })`
  patches `offsetWidth`, `getBoundingClientRect`, `getComputedStyle` and friends on
  `Element`/`HTMLElement`. `window.scrollY` isn't one of them, so this counter reads 0 in the
  broken version even though a layout-dependent read is happening. Don't read a win into it.

---

## 8. False wins: the four traps

Every one of these was hit while solving this lab, and every one produced a *beautiful* trace.
This is the most transferable section in the document.

### Trap 1 — rAF per event, with no latch

```js
// WRONG
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  requestAnimationFrame(() => { /* 10,000 writes */ });  // a NEW callback every event
});
```

This defers work; it does not coalesce it. Three events in one frame queue three callbacks, all of
which fire in that same frame. Strictly worse than `broken`.

### Trap 2 — a latch that never resets

```js
// WRONG
let scheduled = false;
window.addEventListener('scroll', () => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => { /* writes; but `scheduled` is never set back */ });
});
```

Runs exactly once for the lifetime of the page, then early-returns forever. The trace showed
Recalculate style at **0.2%** and Layout at **3.2%**, down from 26% and 31%. Nothing goes from 26%
to 0.2%. The work had simply stopped happening.

Also: declare the latch **inside** the strategy function. A module-level flag survives strategy
switches, so `activate()` can't reset it — same bug, but intermittent.

### Trap 3 — a CSS function called as a JavaScript function

```js
row.style.transform = translateX(60 + 'px');    // ReferenceError, every frame
row.style.transform = `translateX(${60}px)`;    // correct — it's a string
```

The throw happens inside the rAF callback, where `activate()`'s try/catch can't see it. The page
looks fast because nothing renders. Only the console knows.

### Trap 4 — collecting state you never use

```js
// WRONG — builds the Set, then never reads it. No listener, no writes.
function visibleOnly() {
  const set = new Set();
  const io = new IntersectionObserver(entries => { /* populate set */ });
  rows.forEach(row => io.observe(row));
  return () => io.disconnect();
}
```

Related: adding class `animation` when `activate()` strips `scroll-driven`. The class does nothing,
*and* it's never cleaned up, so it contaminates every later measurement.

### The rule

> **A performance number is meaningless until you have confirmed the effect still happens.**

Checklist before trusting any trace:

- [ ] Do the bars still visibly change as you scroll?
- [ ] Is the console clean?
- [ ] Does `DOM update passes` climb while scrolling? (Except `cssOnly`, where 0 is correct.)
- [ ] Did switching strategies fully undo the previous one?

---

## 9. The harness code

Worth understanding, because the harness is how you avoid trap 2 and trap 4.

```js
function listen(type, handler) {
  const opts = { passive: passiveBox.checked };
  window.addEventListener(type, handler, opts);
  return () => window.removeEventListener(type, handler, opts);   // teardown
}
```

Every strategy returns a **teardown function**. This is the pattern that makes A/B measurement
trustworthy: switching strategies must leave zero residue from the previous one.

```js
function activate(name) {
  detach();                    // 1. undo the previous strategy
  detach = () => {};
  eventCount = updateCount = 0;
  PerfHUD.reset();             // 2. reset all counters
  rows.forEach(r => {
    r.style.cssText = '';      // 3. wipe inline styles from strategies 1–4
    r.classList.remove('scroll-driven');   // 4. and the class from strategy 5
  });
  if (name === 'off') return report('no strategy active');
  try {
    detach = strategies[name]() || (() => {});
    report(`strategy: ${name}`);      // ← note: this OVERWRITES any report() your strategy made
  } catch (err) {
    report(`strategy: ${name}\n  ${err.message}`);   // ← so signal failure by throwing
    console.warn(err);
  }
}
```

Two things follow from line 3 and line 4:

- Anything you set as an **inline style** gets wiped on switch — which is why
  `transform-origin: left center` belongs in the stylesheet, not in JS.
- The class must be named exactly **`scroll-driven`**, or your strategy leaks.

And from the `try/catch`: a strategy signals "I can't run here" by **throwing**, not by calling
`report()` — because the `report()` on the line after your strategy returns would clobber it.

---

## 10. Strategy 2 — rAF coalescing

**Hypothesis:** the handler runs too often. Cap it at one write pass per frame.

```js
function rafCoalesced() {
  let scheduled = false, y = 0, rafId = 0;      // 1
  const stop = listen('scroll', () => {
    eventCount++;                                // 2
    y = window.scrollY;                          // 3
    if (scheduled) return;                       // 4
    scheduled = true;
    rafId = requestAnimationFrame(() => {        // 5
      scheduled = false;                         // 6
      updateCount++;                             // 7
      rows.forEach(row => {
        row.style.width = 60 + (y % 300) + 'px';
      });
    });
  });
  return () => { stop(); cancelAnimationFrame(rafId); };   // 8
}
```

1. **State lives inside the function.** Per-activation, so `activate()` genuinely resets it. This
   is the fix for trap 2's second half.
2. **Count every event**, before any early return — otherwise the counter lies.
3. **Read `scrollY` on every event, and let the latest win.** If you only read it when scheduling,
   you render a stale position. The read is cheap; the write is not.
4. **The latch.** If a pass is already queued for this frame, we're done — the queued callback will
   pick up the newest `y` when it runs, because `y` is closed over, not passed in.
5. **`requestAnimationFrame`** schedules the callback for just before the next paint — step 5 in
   the frame sequence from §3, i.e. still inside this frame. No added latency.
6. **Reset the latch first thing inside the callback.** This is trap 2. Reset it here, not at the
   end, so an exception in the write loop can't wedge the strategy permanently.
7. **`updateCount` belongs here**, not in the event handler. `eventCount / updateCount` is the
   coalescing ratio, and it's the entire measurement for this step.
8. **Teardown cancels the pending frame.** Otherwise a queued callback fires after you've switched
   strategies and writes widths the new strategy never asked for.

### Result: no improvement. This is the correct answer.

| | broken | rAF |
|---|---|---|
| Layout | 31.2% | 30.6% |
| Recalculate style | 30.0% | 26.5% |
| Pre-paint | 14.1% | 14.6% |
| Paint | 10.2% | 10.7% |
| long tasks | ~57 | 61 |

Identical shape. **Why:** as established in §3, `scroll` on the window is dispatched by the browser
at most once per frame. There was never a second pass inside a frame for the latch to suppress. You
divided by one. The proof is on the page: `events handled ≈ DOM update passes`.

### So is rAF coalescing useless?

No — it's necessary but not sufficient, and it's necessary for cases this lab doesn't isolate:

- `wheel`, `pointermove`, `mousemove`, `touchmove`, `resize` **can** fire multiple times per frame.
- Multiple independent features (a progress bar, a sticky header, a parallax hero) each with their
  own listener means N write passes per frame. One shared rAF scheduler collapses them to one.
- It guarantees your writes land at a well-defined point in the frame, which keeps you out of
  read-write thrashing by construction.

Keep it. Strategies 3 and 4 build on it. Just don't credit it with a win it didn't earn.

---

## 11. Strategy 3 — transform only

**Hypothesis:** the problem is the *property*, not the frequency.

```js
const scaleFor = y => (60 + (y % 300)) / 60;    // 1

function transformOnly() {
  let scheduled = false, y = 0, rafId = 0;
  const stop = listen('scroll', () => {
    eventCount++;
    y = window.scrollY;
    if (scheduled) return;
    scheduled = true;
    rafId = requestAnimationFrame(() => {
      scheduled = false;
      updateCount++;
      const scale = scaleFor(y);                 // 2
      rows.forEach(row => {
        row.style.transform = `scaleX(${scale})`; // 3
      });
    });
  });
  return () => { stop(); cancelAnimationFrame(rafId); };
}
```

1. **`scaleFor` reproduces the original visual exactly.** The `width` version went 60px → 360px, so
   the scale factor is that divided by the 60px base width. This matters for honesty: if strategy 3
   *looks* different from strategy 1, you're no longer comparing the same workload. `translateX`
   would also be composited, but it slides the bars sideways instead of growing them — a different
   effect, and a worse comparison.
2. **Compute the scale once, outside the loop.** 10,000 identical divisions is free relative to the
   rendering cost, but hoisting invariants out of a hot loop is a habit worth having.
3. **`transform` is a string.** This is trap 3. `` `scaleX(${scale})` `` — template literal, not a
   function call.

`transform-origin: left center` lives in the stylesheet on `.row`, because `activate()` wipes
inline styles. Without it, `scaleX` grows from the centre in both directions.

### What vanished, and what didn't

**Layout disappears.** `transform` is not a layout property — it's applied when the property trees
are built, so geometry never changes and the Layout stage has nothing to invalidate. That's ~31% of
the recording gone.

**Paint should drop a lot,** because the rasterized content of each row is unchanged; only its
transform node moves. How far it drops depends on whether Chrome can reuse the existing raster —
with 10,000 distinctly-transformed elements it can't promote them all to layers, so verify this one
rather than assuming it.

**Recalculate Style survives, at ~26%.** This is the important lesson of the step. You are still
setting an **inline style** on 10,000 elements, and every one of them must have its computed style
rebuilt. Choosing a composited property saved you the Layout stage; it did nothing about the fact
that you're touching 10,000 elements.

Predicted speedup ~1.7×. That's real, but it's ~9fps → ~15fps. Still broken. Which is the setup for
strategy 4.

---

## 12. Strategy 4 — visible rows only

**Hypothesis:** the problem is `N`. There are 10,000 rows and about 40 on screen.

```js
function visibleOnly() {
  const visible = new Set();                                       // 1
  let scheduled = false, y = 0, rafId = 0;

  const io = new IntersectionObserver(entries => {                 // 2
    for (const entry of entries) {                                 // 3
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    }
  }, { rootMargin: '200px 0px' });                                 // 4

  rows.forEach(row => io.observe(row));                            // 5

  const stop = listen('scroll', () => {
    eventCount++;
    y = window.scrollY;
    if (scheduled) return;
    scheduled = true;
    rafId = requestAnimationFrame(() => {
      scheduled = false;
      updateCount++;
      const scale = scaleFor(y);
      visible.forEach(row => {                                     // 6
        row.style.transform = `scaleX(${scale})`;
      });
    });
  });

  return () => {
    stop();
    cancelAnimationFrame(rafId);
    io.disconnect();                                               // 7
    visible.clear();
  };
}
```

1. **A `Set`, not an array.** Add/delete/has are O(1), and it de-duplicates for free — the observer
   can report the same element more than once across callbacks.
2. **`IntersectionObserver` is the whole point of this step.** It computes intersections
   asynchronously, outside your handler, and hands you only the *changes*. "Which rows are visible"
   therefore costs you nothing per frame.

   The alternative — `getBoundingClientRect()` in the scroll handler — forces a synchronous layout
   *per element, per event*. You would be rebuilding Lab 01 in order to solve Lab 02. This is why
   the README makes the distinction the centrepiece: the naive version of "only update what's
   visible" is slower than not optimizing at all.
3. **The callback receives only changed entries**, not all 10,000 — so it's cheap after the initial
   delivery. There is one unavoidable large first callback when observation starts.
4. **`rootMargin` grows the intersection rectangle by 200px above and below the viewport.** Two
   reasons it's needed:
   - Rows are added to the Set slightly *before* they're visible, so they've already been written
     by the time the user sees them. Without it, a row entering the viewport shows one frame with a
     stale transform.
   - Per §3, IntersectionObserver callbacks are delivered **after** rAF callbacks in the frame
     sequence. So your rAF is always reading last frame's visibility state. The buffer band absorbs
     exactly that one-frame lag.
5. **Observing 10,000 elements is a real one-time cost**, paid at activation, not per frame. Fine
   here; worth knowing if you'd be doing it repeatedly.
6. **The payoff, and it's one word: `visible` instead of `rows`.** ~40 iterations instead of 10,000.
   Every downstream stage scales with that: 40 style recalcs, no layout, a tiny paint.
7. **`io.disconnect()` in the teardown.** An observer holds strong references to its targets and
   keeps firing callbacks forever otherwise. This is the leak the README explicitly warns about.

Note what is *deliberately absent*: no `getBoundingClientRect`, no `offsetTop`, no `scrollHeight`
anywhere in the handler. The HUD's `geometry reads` counter should stay at 0. That constraint —
zero geometry reads in any scroll handler — is the one to carry into real code.

---

## 13. Strategy 5 — no JavaScript at all

**Hypothesis:** the main thread shouldn't be involved in this at all.

### The JS side

```js
function cssOnly() {
  if (!CSS.supports('animation-timeline', 'scroll()')) {   // 1
    throw new Error('no animation-timeline: scroll() support in this browser');
  }
  rows.forEach(row => row.classList.add('scroll-driven')); // 2
  return () => rows.forEach(row => row.classList.remove('scroll-driven'));  // 3
}
```

1. **Feature-detect, and fail loudly.** `CSS.supports()` asks the browser directly rather than
   sniffing versions. Throwing is how you signal failure here — `activate()`'s catch puts the
   message in the readout, whereas a `report()` call would be immediately overwritten (§9).
2. **One class, then nothing.** No listener, no rAF, no per-frame code. `events handled` and
   `DOM update passes` both stay at **0** for the whole recording — and that's the metric.
3. **Explicit teardown** even though `activate()` also strips the class. Belt and braces, and it
   keeps the strategy self-contained.

### The CSS side

```css
@keyframes grow-with-scroll {
  from { transform: scaleX(1); }
  to   { transform: scaleX(6); }        /* 60px → 360px, same range as before */
}

@supports (animation-timeline: scroll()) {          /* 1 */
  .row.scroll-driven {
    animation-name: grow-with-scroll;
    animation-duration: auto;                       /* 2 */
    animation-timing-function: linear;              /* 3 */
    animation-fill-mode: both;
    animation-timeline: scroll(root block);         /* 4 */
  }
}
```

1. **`@supports` mirrors the JS feature detection**, so a browser without scroll timelines gets no
   half-applied animation.
2. **`animation-duration: auto` is mandatory here.** For a progress-based timeline, `auto` maps the
   animation across the timeline's entire range. A time value (`2s`) scales it instead, which is
   almost never what you want.
3. **`linear`** because the timeline *is* the input. An ease curve here would make the bars
   accelerate relative to your scroll, which feels wrong.
4. **`animation-timeline: scroll(root block)`** — take progress from the root scroller's block axis
   (vertical, in a horizontal-writing-mode document). `scroll()` also accepts `nearest` and `self`.

   **Two gotchas worth memorising:** `animation-timeline` is *not* part of the `animation`
   shorthand, and the shorthand **resets it to `auto`**. So if you write
   `animation: grow-with-scroll linear` after setting `animation-timeline`, the timeline silently
   disappears and you get a normal time-based animation. Always set the timeline *after* any
   shorthand — or avoid the shorthand entirely, as above.

### Is it actually the fastest?

Don't assume. You are creating **10,000 scroll-driven animations**. Scroll timelines can run off
the main thread, but that's per-animation bookkeeping at a scale nobody designed for. Predict
whether `cssOnly` beats `visibleOnly` (which touches ~40 elements) *before* you look, then check
the **Compositor** and **Thread pool** tracks, not just Main — the work may have moved rather than
vanished.

This is the most interesting measurement in the lab, precisely because the "obviously best"
strategy might lose.

---

## 14. Strategy 6 — content-visibility

One line in the stylesheet, currently commented out in `index.html`:

```css
.row {
  content-visibility: auto;
  contain-intrinsic-size: auto 22px;
}
```

**What `content-visibility: auto` does:** the browser skips rendering work — style, layout, paint —
for elements that are off-screen, and does it for you, without you writing any visibility logic.
The element gets `contain: size layout style paint` applied while skipped.

**The catch, and it's the interview answer:** a skipped element has **no intrinsic size**, so it
collapses to zero height. That makes the document's total height a fiction, and the scrollbar jumps
around as content is rendered and un-rendered. `contain-intrinsic-size` supplies a placeholder size
so the layout stays stable — the `auto` keyword means "use the last actually-measured size once
you've seen it, and this estimate until then."

Turn it on and re-measure **every** strategy, including `broken`. It changes the baseline, so any
comparison you made earlier no longer holds.

---

## 15. Passive listeners

The `passive listeners` checkbox feeds `{ passive: passiveBox.checked }` into `listen()`.

**On a `scroll` listener it changes nothing measurable, and it never can.** `scroll` is not
cancelable — it fires after scrolling has happened — so the compositor never waits on your handler
to decide anything.

To see passive actually matter, you need an event that *can* cancel scrolling. Add a `wheel`
listener and compare traces:

```js
window.addEventListener('wheel', () => {}, { passive: false });  // compositor must wait
window.addEventListener('wheel', () => {}, { passive: true });   // compositor proceeds
```

With `passive: false`, the compositor must ask the main thread "will you `preventDefault()`?" before
it may scroll. Combine that with the "block main thread 500ms" checkbox and scrolling visibly
stalls. With `passive: true` the compositor scrolls immediately, and the same blocked main thread
doesn't touch scrolling at all.

Chrome makes `touchstart`/`touchmove` on window/document passive by default *because* this was such
a common mistake. It does not do that for `wheel`.

---

## 16. Results table

Fill this in from your own traces. Same gesture, same duration, 4× throttle, 10,000 rows.

| Metric | broken | rAF | transform | visible | css | Target |
|---|---|---|---|---|---|---|
| FPS while scrolling | | | | | | ≥ 55 |
| Worst frame | | | | | | < 20ms |
| Long tasks > 50ms | | | | | | 0 |
| Layout (%) | | | | | | 0 |
| Recalculate style (%) | | | | | | ~0 |
| Paint (%) | | | | | | |
| events handled | | | | | 0 | |
| DOM update passes | | | | | 0 | |
| geometry reads | 0 | 0 | 0 | 0 | 0 | 0 |

Recorded so far:

| | broken | rAF |
|---|---|---|
| Layout | 30.9% | 30.6% |
| Recalculate style | 25.9% | 26.5% |
| Pre-paint | 14.0% | 14.6% |
| Paint | 11.8% | 10.7% |
| Long tasks | 57 | 61 |
| Longest task | 112ms | 183ms |

---

## 17. Interview questions, answered

**1. Why is `{ passive: true }` pointless on `scroll` but important on `touchmove`?**
`scroll` is not cancelable — it fires after the scroll has already happened, so the compositor never
blocks on it. `touchmove` *is* cancelable: a non-passive listener forces the compositor to wait for
the main thread's `preventDefault()` decision before it may scroll, so a busy main thread stalls
scrolling entirely.

**2. A colleague throttles their scroll handler to 16ms with `setTimeout`. What's wrong versus rAF?**
`setTimeout` is not aligned to the frame boundary, so the write can land at an arbitrary point —
sometimes twice before one paint, sometimes not before a paint that needed it, and always at the
mercy of task-queue delays. It also keeps running when the tab is hidden or the element is
off-screen. rAF fires exactly once per frame, immediately before rendering, and pauses when the
page isn't visible. And 16ms is wrong on a 120Hz display; rAF adapts.

**3. Your scroll handler is empty and scrolling is still janky. Name three causes.**
(a) A non-passive `wheel`/`touchmove` listener elsewhere is forcing compositor→main-thread
round-trips. (b) Something on the main thread is busy for other reasons — long tasks from timers,
observers, or third-party script — so frames can't be produced. (c) The page is expensive to draw
per frame regardless of JS: huge layers, `background-attachment: fixed`, large `box-shadow`/`filter`
/`backdrop-filter`, or thousands of paint-heavy elements newly exposed by scrolling. (Also: a
scroll-linked `IntersectionObserver` with an expensive callback, or scrollbar-triggered layout in a
sticky/`position: fixed` subtree.)

**4. How would you implement "highlight the section in view" with zero per-frame main-thread work?**
`IntersectionObserver` with a `rootMargin` that defines the "active" band (e.g.
`-40% 0px -60% 0px`, so a section is active while it crosses the middle of the viewport). The
callback fires only on transitions — a handful of times per scroll, not per frame — and toggles a
class. No scroll handler, no geometry reads, no per-frame cost.

**5. What does `content-visibility: auto` actually skip, and what's the catch with scrollbar
position?**
It skips style, layout, and paint for off-screen subtrees (applying `contain: size layout style
paint` while skipped). The catch: a skipped element reports no intrinsic size, so it collapses and
the document's scroll height becomes wrong — the scrollbar jumps as content enters and leaves.
`contain-intrinsic-size` (ideally with the `auto` keyword, which remembers the last real
measurement) supplies a stable size estimate.

---

## 18. Takeaways

1. **Read the profile before choosing a fix.** The baseline said scripting was 8% of the recording.
   That one number predicted, exactly, that strategy 2 would do nothing.
2. **Compare percentages, not milliseconds,** across recordings of different lengths. The *shape* of
   the work is the signal.
3. **`scroll` on the window is already coalesced to once per frame by the browser.** Coalescing it
   again divides by one.
4. **Property choice determines which pipeline stages run.** `width` costs you Layout; `transform`
   does not. That's a table you should know by heart, not derive each time.
5. **Element count is usually the biggest lever,** and every rendering stage scales with it. 10,000
   → 40 beats any amount of cleverness applied to all 10,000.
6. **Writing an inline style always costs a style recalc,** even for a composited property. The only
   way to zero that out is to stop touching elements from JS — a CSS animation, which the compositor
   can drive alone.
7. **Never read geometry in a scroll handler.** `getBoundingClientRect`, `offsetTop`, `scrollHeight`
   force synchronous layout. Measure once, cache, invalidate with `ResizeObserver`. Use
   `IntersectionObserver` for visibility.
8. **A perf number is meaningless until you've confirmed the effect still happens.** Four separate
   "wins" in this lab were code that had silently stopped doing anything. That failure mode is far
   more common than a genuine regression, and it looks like success.
