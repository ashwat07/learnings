# 01 — The rendering pipeline, stage by stage

Read this once carefully, then come back to it whenever a trace confuses you.

## 0. Bytes → tokens → nodes

The HTML parser streams bytes into tokens into DOM nodes. It is **incremental**: the browser can
paint a partial DOM. Two things stop it:

- A synchronous `<script>` — the parser must stop, because the script might `document.write()`.
  It cannot know whether the script mutates the DOM, so it assumes the worst.
- A stylesheet, *indirectly* — parsing continues, but rendering can't, because painting with the
  wrong styles then repainting would be a flash of unstyled content. Also: a sync script that
  might read styles must wait for pending stylesheets.

This is Labs 07 and 13.

## 1. Style (in DevTools: "Recalculate Style")

Match every element against every candidate rule, resolve the cascade, inheritance, and
computed values. Output: computed style per element.

Cost scales with **number of elements invalidated × candidate rules**. Browsers are aggressive
about invalidation scoping — changing a class on a leaf usually restyles that leaf, not the
document. But some things widen the blast radius:

- Descendant/sibling combinators in selectors (`.a .b`, `.a ~ .b`) mean an ancestor/sibling change
  can invalidate a lot.
- Changing something on `<html>` or `<body>` (a theme class, say) invalidates everything.
- CSS custom properties inherit, so setting one high in the tree invalidates every descendant
  that reads it.

Style recalc does **not** compute geometry. `display`, `font-size`, `width: 50%` are resolved as
values here; where the box actually lands is Layout's job.

## 2. Layout (reflow)

Compute the box tree: position and size of every box, from the containing block down. This is
where percentages, `flex`, `grid`, text wrapping, and intrinsic sizing get resolved.

Key properties of layout:

- **It's tree-scoped but leaky.** Dirty a node, and layout must re-run for it and its subtree — and
  often ancestors too, because a child's size can change the parent's (auto height, intrinsic
  sizing, flex).
- **It's batched.** Writes mark nodes dirty; the actual layout runs once, before paint, at the end
  of the frame. Unless you force it (see below).
- **Text is expensive.** Line breaking and shaping is a big chunk of layout for text-heavy pages.
- **`contain: layout` / `content-visibility` cut the tree.** They promise the browser that a
  subtree's layout can't affect the outside, so it can be skipped or isolated. See
  [05-fix-patterns.md](05-fix-patterns.md).

### Forced synchronous layout

The browser flushes pending layout immediately when JS reads a value that depends on geometry
while the tree is dirty. That's the "forced reflow" warning and the little red triangle in the
Performance panel.

```js
el.style.width = '100px';   // marks dirty, cheap
el.offsetWidth;             // ← must know geometry now → full layout, synchronously
el.style.width = '200px';   // dirty again
el.offsetWidth;             // ← layout again
```

N iterations = N layouts in one task. The fix is always the same shape: **read everything first,
then write everything** (Labs 01 and 14).

## 3. Paint (raster)

Fill pixels for each paint op — backgrounds, borders, text glyphs, shadows, images — into one or
more layers. Two independent costs:

1. **Area**: how many pixels were invalidated. Invalidate a full-viewport element and you pay for
   a full-viewport raster. (Lab 04)
2. **Per-pixel cost**: how expensive each pixel is. `background: red` is nearly free per pixel.
   `filter: blur(20px)`, `box-shadow` with a large blur radius, `backdrop-filter`, and
   `border-radius` + clipping are not. (Lab 06)

Paint is also where **stacking order** matters. If an element that paints early is invalidated,
everything painting above it in the same layer gets repainted too.

## 4. Composite

Layers are handed to the compositor and combined on the GPU with a transform and opacity per
layer. Because this happens off the main thread, a `transform`/`opacity` animation on a
composited layer keeps moving even when the main thread is busy — this is why "animate transform,
not left" is the advice, and it's Lab 03.

Layers cost **memory**: `width × height × 4 bytes` per layer, and there's per-layer bookkeeping.
Promoting 500 elements with `will-change: transform` can be slower than not promoting anything.
Lab 15.

## Where each stage shows up in DevTools

| Trace entry | Stage | Colour |
|---|---|---|
| Parse HTML | Parse | blue |
| Evaluate Script, Function Call | JS | yellow |
| Recalculate Style | Style | purple |
| Layout, Layout Shift | Layout | purple |
| Pre-Paint, Paint, Rasterize | Paint | green |
| Layerize, Commit, Composite Layers | Composite | green |

Anything purple/green stacked in a tight repeating comb pattern inside a *single* yellow task is
the shape of forced synchronous layout. Learn to recognise that shape; it's the highest-value
pattern-match in this entire folder.

## The frame budget

```
60fps  → 16.7ms/frame   (~10ms of actual room after browser overhead)
120fps →  8.3ms/frame   (~5ms of room)
```

Frames that miss the budget get dropped; input handled during a long task waits. The user
perceives ~100ms as instant for a tap response, ~1s as "the app is thinking", and anything
above 50ms of unbroken main-thread work as a potential input delay (that's why the INP
metric flags long tasks).
