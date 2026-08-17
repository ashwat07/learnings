# Lab 01 — The pipeline ⭐⭐⭐⭐⭐

**Goal:** know which stage each property triggers, and stop animating the expensive ones.

**Primary metric:** FPS and worst frame, with identical motion.

> <http://localhost:8080/graphics-and-animation/labs/01-the-pipeline/>
> 4× CPU throttling. DevTools → ⋮ → More tools → **Rendering** → Paint flashing, Layer borders.

---

## Four ways to move the same box

| Animate | Stages | 300 boxes | 1000 boxes |
|---|---|---|---|
| `left` | style + **layout** + paint + composite | | |
| `margin-left` | same, and wider invalidation (affects siblings) | | |
| `box-shadow` | style + **paint** + composite | | |
| **`transform`** | **composite only** | | |

Fill it in. Then note the shape of the result: skipping layout is a big win; skipping paint as well
is a much bigger one.

**The real prize with `transform` isn't "a bit faster".** On a well-behaved page the animation runs
on the **compositor thread**, which means it keeps going smoothly *while the main thread is busy*.
Not faster — unaffected.

## The property table

| Property | Stages | Verdict |
|---|---|---|
| `transform`, `opacity` | composite | animate freely |
| `filter` | composite (usually) | fine; `blur` can be expensive |
| `color`, `background-color` | paint | acceptable for small areas |
| `box-shadow`, `border-radius` | paint | expensive; fade a pre-painted copy instead |
| `width`/`height` | **layout** | use `transform: scale()` |
| `top`/`left` | **layout** | use `transform: translate()` |
| `margin`/`padding` | **layout** | never |
| `font-size` | **layout (text!)** | never |

Two translations you'll use constantly: `width/height` → `scale()` (with `transform-origin`;
remember it scales content and borders — counter-scale a child if that matters), and `top/left` →
`translate()`.

## FLIP

For "I have to animate an expensive property":

- **F**irst — measure the start geometry (`getBoundingClientRect`)
- **L**ast — apply the final state, measure again
- **I**nvert — apply a transform making it *look* like it's still at the start
- **P**lay — animate that transform to `none`

The visual result of animating layout at the cost of animating transform. Every shared-element
transition library does this, and the View Transitions API now does it for you
([lab 02](../02-animation-apis/)).

## Layers cost GPU memory

A compositor layer is a texture the GPU can move without re-rasterising — **width × height × 4 bytes
at device pixel ratio**. A full-screen layer on a 3× phone is roughly 90MB. A handful is a crash on a
low-end device.

| Rule | |
|---|---|
| `will-change: transform` **only** on what you're about to animate | and **remove it** when done — it's a hint about the near future, not decoration |
| never on a rule matching many elements | `.card { will-change: transform }` is a classic memory bug |
| `translateZ(0)` is the old hack | same effect, less honest — use `will-change` |
| layer explosion is slower than no layers | more memory, more compositing work |

Check DevTools → More tools → **Layers** and read the memory estimate. **If you're promoting dozens
of elements to make the DOM keep up, that's the signal to switch to canvas** ([lab 04](../04-canvas-2d/)).

## Think about

- Why is `margin-left` worse than `left`?
- Your animation is smooth alone and janky with the rest of the app running. What does that tell you?
- When is `will-change` harmful?

<details>
<summary>Answers</summary>

**`margin-left` vs `left`.** Both trigger layout, but `margin` participates in normal flow so it can
push *siblings* around — the invalidation is wider and the recalculation touches more of the tree.
`left` on an absolutely positioned element affects only that element's box (out of flow), so the
layout work is more contained. Both are wrong for animation; the point is that layout cost scales
with how much of the tree you invalidate, not just how many elements you touched.

**Smooth alone, janky together.** Your animation is running on the **main thread** — either it's
driven by `requestAnimationFrame`, or it animates a property that requires style/layout/paint each
frame, so it queues behind everything else. A genuinely compositor-driven `transform`/`opacity`
animation is largely immune to main-thread load. That difference is a reliable diagnostic.

**Harmful `will-change`.** When it's permanent, when it's on many elements, or when it's on something
large. Each promotion costs GPU memory at device pixel ratio and adds a layer the compositor must
manage every frame. It's also useless applied to something you never animate, and actively wasteful
applied to a whole class of elements — the browser can't know which one you meant.
</details>

---

## 🏗️ Build challenge

1. Grep your CSS for `transition:` and `animation:` naming `width`, `height`, `top`, `left`,
   `margin`, `padding`, `font-size`. Convert each to `transform`.
2. Where you can't (an accordion's height), implement FLIP or use View Transitions.
3. Audit `will-change` — every occurrence should be added and removed around a specific animation.
4. Open the Layers panel on your heaviest screen and record total layer memory. Set a budget.
5. Record a Performance profile of your key animation at 4× throttle. If you see purple Layout bars,
   you have the wrong property.

**Done when:** your main animations show near-zero main-thread work per frame at 4× throttle.

---

## Interview questions

1. Name the pipeline stages and which properties trigger each.
2. Why is `transform` cheap — and what's the *real* benefit beyond speed?
3. What is FLIP and when do you need it?
4. What does `will-change` do, and how do you misuse it?
5. What does a compositor layer cost?
