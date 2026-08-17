# Lab 04 — Frame timing ⭐⭐⭐⭐⭐

**Goal:** understand where rendering sits in the loop, why `requestAnimationFrame`'s timestamp is
the only correct clock for animation, and what a compositor animation buys you.

**Primary metric:** drift in pixels from ground truth after 15 seconds, and frames dropped.

> Open <http://localhost:8080/event-loop/labs/04-frame-timing/>

---

## The concept

Rendering is not a task you queue. It's a phase the browser runs **between** tasks, when it wants
a frame — usually aligned to the display's refresh (vsync). The order inside that phase is fixed:

```
task → microtask checkpoint → [ resize obs → IntersectionObserver → rAF callbacks
                                → ResizeObserver → style → layout → paint → composite ]
```

Three consequences:

1. **`requestAnimationFrame` runs *before* style and layout**, in the same frame. That's why it's
   the right place to write DOM changes and the wrong place to read geometry you just dirtied.
2. **The timestamp passed to your rAF callback is the frame's start time**, and it is *identical*
   for every callback in that frame. `performance.now()` inside the callback is not — it's later,
   by however long the previous callbacks took. Use the parameter.
3. **If the frame is late, the timestamp tells you.** Position derived from `ts` is correct even
   after a 500ms stall; position derived from "+3px per callback" is permanently wrong.

The three ways to be wrong, all visible in this lab:

| Bug | Why it happens | Symptom |
|---|---|---|
| `setInterval(fn, 16)` | timers aren't aligned to vsync and get clamped/coalesced | judder; two updates land in one frame, then none |
| `+= speed * 16` per frame | assumes every frame is 16.67ms | runs 2× fast on a 120Hz display, slows down under load |
| `+= speed * (now - last)` | accumulates float error, and `now` ≠ frame time | small permanent drift; jumps after a stall |

The correct JS form is absolute: `x = f(ts - t0)`. And the correct *non*-JS form is to not animate
in JS at all — a WAAPI or CSS animation of `transform`/`opacity` runs on the compositor thread and
keeps going while your main thread is on fire.

## Break it

1. Click **start all**. Watch for ~15 seconds. The two red dots visibly separate from the green.
2. Read the table. Note the max error, in pixels, for each animator.
3. Click **block main thread 800ms**. The green (WAAPI) dot doesn't miss a beat. The rAF+absolute
   dot *jumps* to the correct position (correct, if not smooth). The counter-based ones fall
   permanently behind — and they never catch up, because they have no concept of real time.
4. Set **every 1000ms** and let it run. This is what a page with a chatty polling loop feels like.
5. Click **simulate half frame rate**. Note which animators keep their speed and which halve.

| Animator | callbacks/s | avg error px | max error px | after an 800ms block |
|---|---|---|---|---|
| setInterval(16) | | | | |
| setTimeout(16) chain | | | | |
| rAF + frame counter | | | | |
| rAF + delta | | | | |
| rAF + absolute time | | | | |
| WAAPI (compositor) | | | 0 | |

## Measure it

1. Performance panel → record 5 seconds with everything running.
2. Turn on the **Frames** track. Green = presented frames, red/yellow = dropped or partially
   presented. Hover one to see its duration.
3. Expand a frame in the Main track. You will see, in order: the rAF callbacks (all of them, one
   after another), then `Recalculate Style`, `Layout`, `Pre-Paint`, `Paint`, `Commit`.
4. Find the WAAPI animation. It is **not** in the Main track — look at the **Compositor** and
   **GPU** tracks, or the "Animations" section. That's the point.
5. Click **block main thread** during the recording. Note that the frames track shows a gap, but
   the composited animation's ticks continue.

Also worth doing once: in DevTools, use the **Rendering** drawer → *Frame Rendering Stats* to see
your display's actual refresh rate. If it's 120, the frame-counter animator is running at double
speed and you've just learned why that bug ships — it's invisible on the developer's 60Hz monitor.

## Think about

Answer before reading anything else:

- Why does `rAF + delta` drift *less* than `rAF + counter` but still drift?
- After an 800ms block, `rAF + absolute` jumps forward. Is that a bug? When would you *want*
  the animation to resume where it left off instead, and how would you implement it?
- The WAAPI dot has zero error by definition here (it *is* the ground truth). Design a way to
  measure whether the compositor animation is actually smooth on screen, given that JS can't
  observe the compositor's frames directly. (Hint: `requestAnimationFrame` + `getComputedStyle`
  is the wrong answer, and understanding why is the lesson.)

<details>
<summary>Answer — why delta still drifts</summary>

Two reasons. First, `ts - last` measures the interval between *callback invocations*, which is
the interval between frame starts — fine — but you're accumulating a float thousands of times,
and small errors compound. Second and worse: if a frame is dropped, `dt` is 33ms and you advance
by 33ms worth of pixels *in one step*, which is correct for position but produces a visible jump.
Absolute time gets the same position without accumulating anything.

The practical rule: **derive state from time, don't integrate it**, unless you're running a
physics simulation that genuinely needs integration — in which case use a fixed timestep with an
accumulator, which is a different lab entirely.
</details>

<details>
<summary>Answer — why you can't observe compositor frames from JS</summary>

Your rAF callback runs on the main thread. If the main thread is idle, you get called at vsync
and see smooth deltas — but that tells you nothing about whether the *compositor* presented a
frame, because the compositor can present frames when the main thread produced nothing at all
(that's the whole point of a composited animation).

What you can use: `requestAnimationFrame` deltas tell you about main-thread frame health;
the DevTools Frames track and `chrome://tracing` tell you about presentation. In the field, the
closest real signal is the `LoAF` (Long Animation Frames) API — `PerformanceObserver` with
`type: 'long-animation-frame'` — which reports frames whose *rendering* was delayed, along with
attribution to the script that caused it.
</details>

---

## 🏗️ Build challenge: a frame budget monitor

Build `frame-monitor.js` that a real app can leave running in production at negligible cost.

```js
const mon = frameMonitor({
  onJank(info) { /* { droppedFrames, gapMs, attribution } */ },
  sampleSeconds: 5,
});
mon.report();  // { fps, p50, p95, p99, longestGap, droppedRatio, refreshHz }
```

Requirements:

1. Detect the display refresh rate rather than assuming 60 — measure the modal frame interval
   over the first second, and handle 60/90/120/144.
2. Report dropped frames as a *ratio against the detected refresh*, not against 60.
3. Use `PerformanceObserver({type: 'long-animation-frame'})` when available to attribute a janky
   frame to a script URL and function name; fall back to `longtask` entries.
4. The monitor itself must cost < 0.1ms per frame. Prove it: profile with the monitor on and off
   and compare the total main-thread time over 10 seconds.
5. Stop sampling when `document.visibilityState === 'hidden'` — background rAF doesn't fire, and
   naive monitors report a catastrophic dropped-frame count every time you switch tabs. This is
   a real bug in real monitoring code.

**Stretch:** add an `animateTo(el, props, ms)` helper that uses WAAPI when the properties are
compositable (`transform`, `opacity`, `filter`) and falls back to a correct absolute-time rAF loop
otherwise — and logs a warning naming the property that forced the fallback.

**Done when:** your monitor's fps matches DevTools' Frame Rendering Stats within 1fps, and its
dropped-frame count matches the Frames track during a deliberate 800ms block.

---

## Interview questions

1. Why is the timestamp argument to `rAF` better than `performance.now()` inside the callback?
2. An animation looks perfect on your machine and runs at double speed on a colleague's laptop.
   One question tells you the cause. What is it?
3. Where in the frame do `IntersectionObserver` and `ResizeObserver` callbacks run relative to
   `rAF`, and why does the difference matter for a lazy-loading implementation?
4. What does a composited animation get you that `rAF` cannot, and what's the cost?
5. Your rAF loop keeps running when the tab is hidden. Does it? What actually happens, and how do
   you make a "keep counting while hidden" feature correct?
