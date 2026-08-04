# Critical Rendering Path — Reflow vs Repaint

A hands-on lab course. You don't read your way to performance intuition; you break the
browser on purpose, watch it bleed in the Performance panel, then fix it and prove the fix
with numbers.

Every lab ships **broken on purpose**. Your job is to profile it, explain *which stage of the
pipeline* is burning time, fix it, and re-measure. Each lab also ends with a **build
challenge** — something you write from scratch, because recognising layout thrash in someone
else's code is easier than not writing it in your own.

---

## The pipeline, once, properly

```
                    ┌──────────── main thread ────────────┐   ┌── compositor ──┐
HTML ──parse──> DOM ─┐
                     ├─> Render Tree ─> Layout ─> Paint ─> ... ─> Composite ─> screen
CSS ──parse──> CSSOM ┘   (style calc)   (reflow)  (raster)         (GPU)
```

| Stage | Also called | Answers the question | Cost driver |
|---|---|---|---|
| Parse | — | What elements exist? | bytes, blocking resources |
| Style | Recalculate Style | What computed values apply? | # elements × selector complexity |
| **Layout** | **Reflow** | Where and how big is everything? | # elements in the dirty subtree |
| **Paint** | Raster | What pixels, in what order, on which layer? | painted area × per-pixel cost |
| Composite | — | How are layers stacked/transformed? | # layers, layer memory |

The single most important idea in this whole folder:

> **You can only skip stages forwards, never backwards.**
> Change geometry → Style + Layout + Paint + Composite.
> Change a paint-only property (`color`, `background`, `box-shadow`) → Style + Paint + Composite.
> Change `transform` / `opacity` on a composited layer → Composite only.

Second most important idea:

> **Layout is lazy — until you read.** The browser batches style/geometry writes and flushes
> them once before the next frame. Reading a geometry property (`offsetWidth`,
> `getBoundingClientRect()`, `scrollTop`, `getComputedStyle`) while the DOM is dirty forces the
> flush *right now*. Write→read→write→read in a loop = **forced synchronous layout**, N times
> per frame. That's layout thrashing, and it's Lab 01.

A 60fps frame budget is **16.7ms**, of which you realistically own ~10ms. 120Hz displays give
you 8.3ms. Every measurement in these labs is against that budget.

---

## Curriculum

Work them in order — later labs assume the profiling reflexes from earlier ones.

| # | Lab | Pipeline stage under attack | ⭐ |
|---|---|---|---|
| 01 | [Layout thrashing](labs/01-layout-thrashing/) | Forced synchronous layout | ⭐⭐⭐⭐⭐ |
| 02 | [Scroll jank](labs/02-scroll-jank/) | Long tasks on a high-frequency event | ⭐⭐⭐⭐⭐ |
| 03 | [Animating the wrong property](labs/03-animating-the-wrong-property/) | Layout per frame vs composite | ⭐⭐⭐⭐⭐ |
| 04 | [Paint storms](labs/04-paint-storms/) | Paint area & invalidation | ⭐⭐⭐⭐ |
| 05 | [DOM monster](labs/05-dom-monster/) | Node count, style recalc, virtualization | ⭐⭐⭐⭐⭐ |
| 06 | [Expensive CSS](labs/06-expensive-css/) | Per-pixel paint cost | ⭐⭐⭐⭐ |
| 07 | [Render-blocking JS](labs/07-render-blocking-js/) | Parser blocking, `defer`/`async` | ⭐⭐⭐⭐ |
| 08 | [React re-render storm](labs/08-react-rerender-storm/) | Framework work → style+layout | ⭐⭐⭐⭐⭐ |
| 09 | [Memory leaks](labs/09-memory-leaks/) | Heap growth, detached nodes | ⭐⭐⭐⭐⭐ |
| 10 | [Listener leaks](labs/10-listener-leaks/) | Retainers, detached DOM trees | ⭐⭐⭐⭐ |
| 11 | [Image disaster](labs/11-image-disaster/) | Decode, LCP, bandwidth | ⭐⭐⭐⭐ |
| 12 | [Network waterfall](labs/12-network-waterfall/) | Request count, connection reuse | ⭐⭐⭐ |
| 13 | [CSS blocking first paint](labs/13-css-blocking-first-paint/) | Render-blocking stylesheets | ⭐⭐⭐⭐ |
| 14 | [Forced reflow detector](labs/14-forced-reflow-detector/) | Reading *why* each read flushes | ⭐⭐⭐⭐⭐ |
| 15 | [Composite layers](labs/15-composite-layers/) | Layer creation, `will-change` cost | ⭐⭐⭐⭐⭐ |
| 16 | [Input responsiveness (INP)](labs/16-input-responsiveness/) | Input delay, processing, presentation | ⭐⭐⭐⭐⭐ |
| 17 | [Style recalculation](labs/17-style-recalculation/) | Invalidation scope, selector cost | ⭐⭐⭐⭐ |
| 18 | [Layout shift (CLS)](labs/18-layout-shift/) | Unexpected layout, session windows | ⭐⭐⭐⭐ |
| 19 | [Capstone: the terrible dashboard](capstone/terrible-dashboard/) | All of it, at once | ⭐⭐⭐⭐⭐⭐ |
| 20 | [Capstone: performance playground](capstone/performance-playground/) | Teach it back | ⭐⭐⭐⭐⭐ |
| 21 | [Capstone: production audit](capstone/production-audit/) | Diagnose code you didn't write | ⭐⭐⭐⭐⭐⭐ |

The three capstones test different skills and are deliberately different in kind: 19 is *fix it*,
20 is *explain it*, 21 is *diagnose it, with no answer key*. Do 19 first; 21 is the one that most
resembles a senior interview exercise.

Concept notes, to read *when a lab sends you there* (not up front):

- [concepts/01-pipeline.md](concepts/01-pipeline.md) — each stage in detail, and what invalidates it
- [concepts/02-what-triggers-what.md](concepts/02-what-triggers-what.md) — property → stage lookup table, and the forced-layout read list
- [concepts/03-compositing-and-layers.md](concepts/03-compositing-and-layers.md) — why `transform` is free-ish, when it isn't
- [concepts/04-measurement-toolkit.md](concepts/04-measurement-toolkit.md) — DevTools recipes, `PerformanceObserver`, how to not lie to yourself with numbers
- [concepts/05-fix-patterns.md](concepts/05-fix-patterns.md) — the standard toolbox: batching, rAF, virtualization, containment, throttling

---

## Running the labs

Most labs are plain files — `open index.html` works. Labs 07, 11, 12, 13 involve the network,
so they need a real server:

```sh
./serve.sh          # http://localhost:8080
```

Lab 08 loads React from a CDN, so it needs internet the first time.

## Method — the four questions

Ask these every single time, in this order. Answer them in writing before you touch the fix.

| Question | How you answer it |
|---|---|
| **1. How do I break it?** | Reproduce the jank on demand. If you can't trigger it reliably you can't measure it. |
| **2. How do I measure it?** | Performance recording + one primary metric. Frames, not vibes. |
| **3. Why is it slow?** | Name the stage: Style / Layout / Paint / Composite / JS / Network / Memory. |
| **4. How do I fix it?** | Smallest change that moves the primary metric. Re-measure. Keep the trace. |

## Filling in the numbers

Each lab has a metrics table. Copy [MEASUREMENTS.md](MEASUREMENTS.md) into the lab folder and
fill it in as you go — before/after numbers are the whole point, and "it felt smoother" is not
a number. Throttle your CPU (Performance panel → CPU → 4× or 6× slowdown) for every
measurement, and use the same throttle for before and after.

## Definition of done for a lab

- [ ] You can state, in one sentence, which pipeline stage was the bottleneck and why.
- [ ] You have before/after numbers for the lab's primary metric.
- [ ] The fix is the *minimal* one — you know which part of it did the work.
- [ ] You built the build challenge and it hits its budget.
- [ ] You can answer the lab's interview questions out loud, without notes.
