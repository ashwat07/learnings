# Lab 15 — Composite layers ⭐⭐⭐⭐⭐

**Goal:** see layers, understand what creates them, learn what they cost, and stop using
`will-change` as a superstition.

**Primary metric:** layer count and GPU memory, against FPS.

---

## The concept

Read [concepts/03-compositing-and-layers.md](../../concepts/03-compositing-and-layers.md) first — it
has the full list of what promotes an element and why.

The short version: a composited layer is a separate texture that the GPU can transform and blend
without the main thread. That's why `transform` animations survive a blocked main thread. But each
layer costs `width × height × devicePixelRatio² × 4` bytes plus per-frame bookkeeping, so promotion
is a **trade**, not a win.

Three things people get wrong:

1. **`will-change: transform` on everything.** It's a hint meaning "I'm about to animate this."
   Left on permanently, the browser can never un-promote, and you've traded main-thread time you
   weren't spending for GPU memory you can't spare.
2. **Layer explosion.** If element B overlaps a composited element A and paints above it, B usually
   has to be promoted too, to preserve paint order. One `translateZ(0)` can promote a chain of
   unrelated elements. The Layers panel gives you the reason string — read it.
3. **Blurry text.** A layer is rastered at one scale. Animate a `scale()` transform on a text layer
   and the text is stretched from that raster, not re-rendered.

## Break it

`index.html` renders N cards with independent controls for:

- promotion strategy: none / `will-change` on all / `translateZ(0)` on all / only the animated one
- an animation: `transform` (composited) or `left` (not)
- an overlapping element that triggers layer explosion
- a `scale()` animation on text, so you can see the raster-quality trade
- a main-thread blocker, so you can prove which animations survive

## Measure it

1. **Rendering → Layer borders.** Orange/olive borders show layer boundaries. Toggle promotion
   strategies and watch them appear.
2. **Layers panel** (⌘⇧P → "Show Layers"). This is the real tool. For each layer it gives you:
   - size and memory estimate
   - **compositing reasons** — the actual explanation, in words
   - paint count
   Rotate the 3D view to see the stack.
3. **Rendering → Frame rendering stats** — live FPS *and* GPU memory. The GPU memory number is the
   one that matters here.
4. **Chrome Task Manager** (⇧Esc) — the tab's "GPU memory" column, for a second opinion.
5. For each configuration, record:

| Config | Layers | GPU memory | FPS | FPS under 2s main-thread block | Worst frame |
|---|---|---|---|---|---|
| no promotion, `left` anim | | | | | |
| no promotion, `transform` anim | | | | | |
| `will-change` on all 100, `transform` | | | | | |
| `will-change` on 1, `transform` | | | | | |
| `translateZ(0)` on all 100 | | | | | |
| overlap explosion on | | | | | |

6. Then push it: 500 cards, 2,000 cards. Find the point where promotion makes things **worse**, and
   record the layer count and memory at that point. That number — "promotion stops paying at about
   N layers on my machine" — is the takeaway.

## Why is it slow (or fast)?

1. With `will-change` on all 100 cards and only one animating, what is the browser doing with the
   other 99 layers every frame?
2. Turn on the overlap element. How many layers appeared, and what reason does the Layers panel
   give? Explain the paint-order argument in your own words.
3. Animate `scale()` on a text card. Why is the text blurry mid-animation, and what does that tell
   you about when a layer is rasterized?
4. `transform` animation, main thread blocked: it keeps running. Now add a `getBoundingClientRect()`
   call in a rAF loop while it animates. Does it still survive? Why not?

## Fix it yourself

- [ ] **Promote on demand.** Add `will-change: transform` on `pointerenter`/animation start and
      remove it on `transitionend`/`animationend`. Measure GPU memory at rest and during animation.
      Confirm the layer disappears afterwards in the Layers panel.
- [ ] **Do you even need it?** Remove `will-change` entirely and animate with a CSS animation.
      Check the Layers panel: the engine promotes for the animation's duration on its own. Measure
      whether `will-change` bought you anything at all. (Often it buys you avoiding the first-frame
      raster hitch. Measure that specifically — record the first frame of the animation.)
- [ ] **Fix the explosion.** Restructure the overlap case so only the intended element is promoted.
      Options: `z-index` ordering, moving the element out of the overlapping stack, or containment.
      Document what worked.
- [ ] **Fix the blurry text.** Two approaches: animate a wrapper's `scale` while counter-scaling the
      text, or animate `font-size`/layout for a small number of elements and accept the cost. Measure
      both, and judge the visual result honestly.
- [ ] **Set a budget.** Decide, from your measurements: what's the maximum number of promoted layers
      you'd allow in a page, and what's your GPU memory ceiling? Write the rule down with the number
      that justifies it.
- [ ] **Find a real one.** Open a site you use daily, turn on Layer borders, and find an
      over-promotion. Screenshot the Layers panel with the reason string. Almost every large site
      has one.

---

## 🏗️ Build challenge: a layer-budget dashboard

You can't enforce what you can't see. Build the tool that makes layers visible in a project.

**Part 1 — the audit script.** Using Playwright + CDP (`LayerTree.enable`,
`LayerTree.layerTreeDidChange`, `LayerTree.compositingReasons`):

1. Load a page, wait for it to settle, and dump every composited layer: bounds, memory estimate,
   paint count, and compositing reasons.
2. Group by reason so you can see "37 layers because of `will-change: transform`" at a glance.
3. Compute total GPU memory and compare against a budget.
4. Do it again *during* a scripted interaction (open a menu, scroll, hover a card) so you catch
   layers that only exist transiently — and layers that were supposed to be transient and aren't.
5. Emit a report: a table plus a diff against the previous run, and a non-zero exit on budget
   violation.

**Part 2 — the in-page overlay.** A dev-mode widget for your app that shows live layer count, GPU
memory, FPS, and a list of the top layers by memory. Add a "why?" button per layer that prints its
compositing reason. Make it good enough that you'd actually leave it on during development.

**Part 3 — the finding.** Run it against a real application and write up:
- total layers and GPU memory at rest and during interaction
- the worst over-promotion, with its reason string
- the fix, with before/after memory
- one case where promotion was *correct* and you left it alone (this matters — a tool that says
  "remove all layers" is as useless as no tool)

**Done when:** the audit runs in CI with a GPU-memory budget, the overlay reports live layer counts,
and you've fixed one real over-promotion with a measured before/after.

---

## Interview questions

1. What is a compositing layer, and why does one make `transform` animations resilient?
2. Name five things that create a layer in Chromium.
3. What does a layer cost? Give the memory formula.
4. What is layer explosion and how do you diagnose it?
5. When does `will-change: transform` help, and when is it harmful?
6. Why does text go blurry during a scale animation, and how do you avoid it?
7. A composited `transform` animation janks. It's supposed to be off-thread — what could be
   dragging it back?
