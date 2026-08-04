# Lab 03 — Animate the wrong property ⭐⭐⭐⭐⭐

**Goal:** feel the difference between an animation that costs layout + paint every frame and one
that runs on the compositor while the main thread is on fire.

**Primary metric:** `Layout` + `Paint` entries per second during the animation, and FPS while the
main thread is blocked.

---

## The concept

Animating `left` means: new value → style recalc → **layout** (the box moved, so its containing
block and possibly siblings must be resolved) → **paint** → composite. Every frame. On the main
thread.

Animating `transform: translateX()` on a composited layer means: the compositor multiplies a
matrix. No layout. No paint. Not even on your thread.

The killer demonstration isn't the frame time — it's this: **block the main thread for 2 seconds
mid-animation.** The `left` animation freezes solid. The `transform` animation keeps going,
perfectly smooth, because the compositor thread already has everything it needs.

That's the thing to internalise. "Use transform" isn't a micro-optimisation; it moves the work to
a different thread.

## Break it

`index.html` animates 200 boxes by writing `style.left` in a `requestAnimationFrame` loop. Open
it and watch the HUD.

Then press **block main thread (2s)** and watch the animation stop dead.

## Measure it

1. CPU 4× throttle. Record 3 seconds of the `left` animation.
2. Bottom-Up, group by activity. Record:
   - `Layout` count and total
   - `Paint` + `Rasterize` total
   - `Composite Layers` total
3. Switch to `transform` (once you've implemented it) and record again with the same settings.
4. Rendering panel → **Paint flashing**. The `left` version flashes the moving region every frame.
   The `transform` version should barely flash at all after the first frame.
5. Rendering panel → **Layer borders**. Compare how many layers exist in each mode.
6. With each mode running, press **block main thread**. Note FPS during the block.

| Metric | `left` (JS) | `left` (CSS) | `transform` (JS) | `transform` (CSS) |
|---|---|---|---|---|
| Layout entries in 3s | | | | 0 |
| Paint total | | | | ~0 |
| FPS | | | | ~60 |
| FPS during 2s main-thread block | | | | ~60 |
| Composited? (Animations panel) | no | no | | yes |

That last row is the one to remember: **a CSS animation of `left` is not composited either.** The
property matters, not whether you used CSS or JS. But CSS + `transform` beats JS + `transform`,
because the compositor can run it without ever waking your thread.

## Why is it slow?

Explain, precisely, why moving a box with `left` requires layout at all — the box's own size
didn't change. (Think about what layout computes, and what "static position" means for siblings
and for a `position: relative` element.) Then explain why `transform` does not.

## Fix it yourself

In `app.js`:

- [ ] **`transformJs()`** — same rAF loop, write `transform: translateX(...)`. Compare traces.
- [ ] **`transformCss()`** — delete the rAF loop entirely. One CSS animation/transition; JS only
      toggles a class. Confirm in the Animations panel that it's composited.
- [ ] **`marginLeft()`** — implement it and predict its cost *first*. Is it closer to `left` or to
      `transform`? Why? (This is a real interview question.)
- [ ] **`flip()`** — the honest hard case. You need a box to move from a genuinely different
      *layout* position (e.g. it changes flex order or grid cell), but you want composited
      animation. Implement FLIP: measure First, apply the layout change, measure Last, apply an
      inverting `transform`, then animate the transform to identity. Exactly two layouts total,
      then composited animation.

Constraint for all of them: the visual motion must look identical. If your `transform` version
moves a different distance, you've measured two different things.

<details>
<summary>Hint — why margin-left is not the answer</summary>

`margin-left` changes the box's position *within layout*, so it dirties layout just like `left` —
and worse, it can affect siblings in normal flow, widening the layout blast radius. `left` on a
`position: absolute` element at least only affects itself. So `margin-left` is usually the worst of
the three.
</details>

<details>
<summary>Hint — FLIP mechanics</summary>

```js
const first = el.getBoundingClientRect();     // read
applyLayoutChange();                          // write (e.g. change class/order)
const last = el.getBoundingClientRect();      // read → one forced layout, unavoidable and fine
const dx = first.left - last.left, dy = first.top - last.top;
el.animate(
  [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
  { duration: 300, easing: 'cubic-bezier(.2,0,0,1)' }
);
```
Two reads, one write, then the compositor does the rest. This is how a good shared-element
transition works — and what `view-transition` does for you natively.
</details>

<details>
<summary>Hint — my transform animation still shows Layout entries</summary>

Something else in your keyframes or handler is dirtying layout. Common culprits: setting
`width`/`height` in the same frame, reading `offsetTop` in the rAF callback, or a
`transition: all` picking up a layout property. Also check that you're not animating a
`transform` on an element whose *parent* size depends on it.
</details>

---

## 🏗️ Build challenge: a drawer + modal + toast system where nothing touches layout

Every design system has these three, and almost every implementation animates the wrong property.

Build:

1. **A side drawer** that slides in from the right, with a backdrop that fades in.
2. **A centred modal** that scales and fades in, and traps focus.
3. **A toast stack** where new toasts slide in from the bottom and existing toasts move up to make
   room — this is the interesting one, because "move up to make room" is a genuine layout change.
4. **An accordion** that expands to its content's natural height — the other genuine layout change.

**Constraints:**

- No animated `left`, `top`, `width`, `height`, `margin`, or `padding`. Anywhere.
- The toast reflow uses FLIP: one measure pass for all toasts, then composited transforms. Adding
  the 5th toast must not cost 5 layouts.
- The accordion animates to `auto` height without animating `height` per frame. Solve it — options
  include `scaleY` with counter-scaled content, a `grid-template-rows: 0fr → 1fr` transition, or
  `calc-size()`/`interpolate-size` where available. Implement at least two and compare the traces
  *and* the visual quality (text squash is a real defect, not a nitpick).
- Every animation must keep running at 60fps while a 1-second main-thread block is in flight. Add
  a "block main thread" button to your demo and leave it there — it's the proof.
- `will-change` is applied on interaction start and removed on `transitionend`/`animationend`. If
  you leave it on permanently, you've failed Lab 15 in advance.
- Respect `prefers-reduced-motion: reduce` — no transforms, just instant state changes.

**Done when:** a Performance trace of opening the drawer, opening the modal, firing 5 toasts, and
expanding the accordion contains **zero** `Layout` entries attributable to the animations
themselves (FLIP's two measure-flushes are allowed and expected — point at them in the trace and
explain them), and the whole sequence stays at 60fps under a main-thread block.

---

## Interview questions

1. Why does animating `left` require layout when the element's size didn't change?
2. Is a CSS `transition: left` composited? Why is that a trick question?
3. What's the difference in cost between `transform: translateX(100px)` and
   `transform: translate3d(100px, 0, 0)` in modern Chromium?
4. Explain FLIP to someone who's never heard of it, in 60 seconds.
5. When would you *deliberately* animate a layout property?
6. Your designer wants a card to grow from 200px to 400px wide on hover. Give two
   implementations and their trade-offs.
