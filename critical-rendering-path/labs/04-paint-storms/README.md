# Lab 04 — Trigger a massive repaint ⭐⭐⭐⭐

**Goal:** learn to see paint *area* — the pixels you invalidated, versus the pixels you meant to
change — and learn which properties can change without repainting at all.

**Primary metric:** paint area (Paint flashing) + `Paint`/`Rasterize` total per second.

---

## The concept

Paint cost = **area invalidated × per-pixel cost**. This lab is about area; Lab 06 is about
per-pixel cost.

The trap is that *you* think you changed one card, and the browser repainted the viewport. That
happens when:

- You change a property on an **ancestor** (a class on `<body>` for theming, a `background` on the
  grid container) — everything inside its layer repaints.
- The element you changed is **at the bottom of the stacking order** in its layer, so everything
  painting above it must be redrawn too.
- The change is on a **large** element — a full-width row, a backdrop, a sticky header spanning the
  viewport.
- Your change triggers layout, which invalidates paint for everything that moved.

Meanwhile `opacity` and `transform` on a composited layer change *nothing* in the raster — the GPU
reuses the existing texture. This is why a fade is cheaper than a colour change even though the
fade "changes more pixels".

## Break it

`index.html` renders 500 colourful boxes. Four modes:

1. **`hoverAncestor`** (broken) — hovering a box sets a class on the *container*, and the CSS
   changes the container's background. One hover → whole-grid repaint.
2. **`hoverAll`** (broken) — hovering recolours every box via JS.
3. `hoverSelf` — the sane version: recolour only the hovered box.
4. `fadeOpacity` — animate `opacity` instead of colour.

## Measure it

1. Rendering panel → check **Paint flashing**. Now hover boxes in mode 1.
   The entire grid flashes green. That's your repaint area.
2. Switch to mode 3 and hover. Only one box flashes.
3. Switch to mode 4 (`fadeOpacity`). Almost nothing flashes at all — and the first frame flashes
   once as the layer is created, then never again.
4. Now record traces (CPU 4×) for a 3-second hover sweep in each mode, and record:
   - `Paint` + `Rasterize` totals
   - `Composite Layers` total
   - number of `Recalculate Style` entries and, importantly, **how many elements each restyled** —
     hover the entry, DevTools shows "Elements Affected".
5. Open the **Layers** panel in mode 4 and note the layer that got created and its memory.

| Metric | hoverAncestor | hoverAll | hoverSelf | fadeOpacity |
|---|---|---|---|---|
| Flashing area (describe) | whole grid | | one box | |
| Paint total (3s) | | | | ~0 |
| Style recalc — elements affected | | | | |
| Worst frame | | | | |

## Why is it slow?

For mode 1, explain the chain precisely: what did the class change, which element's paint was
invalidated, and why did its children have to repaint even though nothing about them changed?

Then answer the sharper question: in mode 4, the box visibly changes appearance every frame, and
yet Paint is ~0. Where is the work happening, and what did the browser keep so it didn't have to
repaint?

## Fix it yourself

- [ ] **`hoverSelf()`** — implement it with **no JS at all**. A `:hover` rule on the box. Then
      explain why the pure-CSS version is still cheaper than a JS handler that sets the same style.
- [ ] **`fadeOpacity()`** — implement the hover highlight as an `opacity` change on an overlay
      pseudo-element that's already composited. Confirm Paint ≈ 0.
- [ ] **Isolate the paint.** Add `contain: paint` to the boxes and re-measure mode 2. What changed,
      and why is `contain: paint` a *promise* you have to be careful about?
- [ ] **The theming trap.** Implement a dark/light toggle that flips a class on `<html>` and
      measure the repaint. Then implement it with CSS custom properties and measure again. Is it
      cheaper? (Careful — the honest answer is "not necessarily, and here's why.") Then find the
      version that *is* cheap.
- [ ] **Stacking order experiment.** Give one box `z-index: -1` and a full-size sibling above it.
      Change the bottom box's background and observe what repaints. Write down the rule you
      derived.

<details>
<summary>Hint — why the custom-property theme toggle may not be cheaper</summary>

Custom properties inherit. Setting `--bg` on `:root` invalidates style for every element that
consumes it, and every element that consumes it repaints. You've swapped "one class change,
everything repaints" for "one variable change, everything that reads it repaints" — often the same
set. The genuinely cheap version limits the *area*: change only what's visible, or accept one
full repaint (a theme switch is a one-off, not a per-frame cost) and make sure it isn't animated.
The lesson: a one-time full repaint is fine. A per-frame full repaint is not.
</details>

<details>
<summary>Hint — contain: paint</summary>

`contain: paint` promises that no descendant will paint outside the element's bounds, which lets
the browser (a) clip, and (b) skip painting the subtree entirely when the element is off-screen. It
also creates a containing block for absolutely-positioned descendants and a new stacking context —
which is why "careful": it can change your layout and your overflow behaviour. Read what breaks
before you sprinkle it everywhere.
</details>

---

## 🏗️ Build challenge: a heatmap grid that repaints only what changed

Build a live 100×100 cell grid (10,000 cells) that receives ~2,000 random cell updates per second
— think a server-status matrix, a Conway's Life board, or a trading heatmap.

**Version A (the honest baseline):** DOM cells, update `background-color` per changed cell.
Measure paint area and FPS. Find the point where it collapses.

**Version B (optimise the DOM version):**
- update only changed cells, batched into one rAF
- `contain: strict` or `content-visibility` where valid
- avoid per-cell class churn; consider a fixed palette of classes vs inline styles and measure
  which restyles fewer elements
- prove with Paint flashing that only changed cells flash

**Version C (change the medium):** render the same grid to a single `<canvas>`, redrawing only
dirty rectangles. Now the paint area is literally under your control.

**Version D (go further):** the same grid on the GPU — a WebGL/WebGPU quad with cell state in a
texture, or a CSS `paint()` worklet.

Then write up the comparison: FPS, worst frame, paint area, memory, *and* accessibility and
development cost. The point of D is not that it's best — it's that you can articulate when the DOM
stops being the right tool, and what you gave up (selection, a11y, hit testing, text rendering)
when you left it.

**Done when:** you have a table of all four versions with real numbers at 4× CPU throttle, you can
state the cell-count threshold where each approach stops holding 60fps, and you can justify which
one you'd actually ship for a 100×100 grid and for a 1000×1000 grid.

---

## Interview questions

1. What are the two independent components of paint cost?
2. Why does changing an element's background repaint its children?
3. Explain why an `opacity` fade can be cheaper than a `background-color` change.
4. What does `contain: paint` promise, and what breaks if the promise is wrong?
5. Your theme toggle causes a 400ms hitch. Walk me through how you'd diagnose and fix it.
6. When would you move from DOM to canvas, and what do you lose?
