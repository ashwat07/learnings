# 03 — Compositing and layers

## What a layer is

The browser can split the page into multiple textures ("compositing layers"), raster each one
separately, and then have the GPU stack them with a per-layer transform + opacity. The
compositor thread does this, independent of the main thread.

Consequence: a `transform` animation on its own layer keeps running at 60fps *while your main
thread is blocked*. A `left` animation cannot — every frame needs main-thread layout and paint.
Lab 03 makes you see this directly by blocking the main thread mid-animation.

## What creates a layer

Roughly, in Chromium:

- 3D transform (`translateZ(0)`, `translate3d`, `rotate3d`, `perspective`)
- `will-change: transform` / `will-change: opacity`
- `<video>`, `<canvas>`, WebGL contexts, some plugins
- `position: fixed` / `sticky` (often)
- animated `transform` or `opacity` (the compositor promotes it for the animation's duration)
- `backdrop-filter`
- an element that overlaps a composited layer and paints above it → **layer explosion**, see below
- `filter`, `mix-blend-mode`, `isolation` in some cases

There is no spec for this. It's an engine heuristic and it changes between versions. Verify with
DevTools → Rendering → **Layer borders**, and the **Layers** panel, which tells you the
compositing *reason* for each layer.

## The costs

| Cost | Detail |
|---|---|
| Memory | `width × height × devicePixelRatio² × 4 bytes`. A full-screen layer at DPR 2 on a 1440×900 window ≈ 20MB. |
| Raster | Each layer is rasterized separately; more layers = more raster work and more tiles to manage. |
| Bookkeeping | The compositor tracks, sorts, and uploads every layer each frame. |
| Text quality | Text on a layer being animated with a scale transform can render blurry (rastered once, then stretched). |

So promotion is a **trade**: main-thread work for GPU memory. Promoting the one element you're
animating is a good trade. Promoting 500 cards is not.

### Layer explosion

If element B paints *above* a composited element A and overlaps it, B usually must be promoted
too — otherwise the compositor couldn't preserve paint order. One `translateZ(0)` on a
low-`z-index` element can therefore promote a chain of unrelated elements. Check the Layers
panel and look for reasons like "overlaps composited content" / "assumed to overlap".

## `will-change`: the right way

```css
/* Wrong: permanent promotion of many elements */
.card { will-change: transform; }

/* Right: promote just before the animation, drop it after */
.card:hover,
.card.is-animating { will-change: transform; }
```

`will-change` is a hint that says "I'm about to animate this, get ready." Leaving it on forever
means the browser can never un-promote. Rules:

- Apply it to as few elements as possible.
- Apply it shortly before the change (hover/focus, or via JS on interaction start) and remove it
  when done.
- If an element is animated by a CSS animation or transition, you often don't need it at all —
  the engine promotes for the animation's duration automatically.
- `translateZ(0)` is the old hack for the same thing; `will-change` is the declarative version.
  Don't use both.

## Compositor-friendly animation: what actually qualifies

For an animation to run entirely on the compositor:

- It animates only `transform` and/or `opacity` (and `filter`, engine permitting).
- Nothing in the animation forces layout (no `width` in the same keyframes).
- The element doesn't have a paint dependency that changes per-frame.
- You're not reading geometry every frame in JS (that drags it back to the main thread).

DevTools tells you when this fails: in the Animations panel and in the Performance trace,
non-composited animations get flagged, and Chrome logs a compositing failure reason.

## Scroll, sticky, and fixed

Scrolling is compositor-driven when it can be. It falls back to the main thread when:

- a non-passive `wheel`/`touchstart` handler exists (it might `preventDefault()`, so the
  compositor must ask the main thread first) — always pass `{ passive: true }`;
- `background-attachment: fixed` needs repainting as you scroll;
- a scroll handler does layout-forcing work per event (Lab 02).

## Try it

1. Open Lab 15. Turn on Layer borders.
2. Promote 1 card, then 100. Watch the GPU memory readout in the Layers panel.
3. Put `will-change: transform` on a container and see how many descendants get promoted.
4. Animate `transform` on a card, block the main thread for 2s, and confirm the animation
   continues. Then do the same with `left`.
