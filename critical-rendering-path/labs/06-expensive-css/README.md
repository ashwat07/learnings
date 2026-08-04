# Lab 06 — Expensive CSS ⭐⭐⭐⭐

**Goal:** build an intuition for *per-pixel* paint cost. Not every pixel is the same price, and
the difference between a cheap card and an expensive one is usually three CSS declarations.

**Primary metric:** `Paint` + `Rasterize` total per second while scrolling.

---

## The concept

Filling a rectangle with a solid colour is essentially free. These are not:

| Property | Why it costs |
|---|---|
| `box-shadow` with a large blur | a Gaussian blur over the shadow's area, per element; two-sided if `inset` too |
| `filter: blur(n)` | blurs the whole element's rendered content; cost grows with radius **and** area |
| `backdrop-filter` | must read back what's *behind* the element, blur that, then composite — the most expensive thing on this list |
| `border-radius` + overflow clipping | forces a clip/mask path instead of a fast rect blit |
| `clip-path` (non-rect) | mask rasterization per element |
| gradients, especially `conic-gradient` and multiple layered gradients | per-pixel computation instead of a fill |
| `mix-blend-mode`, `opacity` on a group | forces an offscreen buffer, then a blend pass |
| large `background-size` / `background-attachment: fixed` | re-rasters on scroll |
| text with `text-shadow`, or many web-font glyph variants | glyph rasterization + blur |

Stack five of these on 500 elements and you'll be painting for 100ms+ per frame while the FPS
counter reads 6.

The key nuance: **cost = per-pixel price × area × number of elements**, and promoting an element
to its own layer can make an expensive paint a *one-time* cost instead of a per-frame one. That's
the difference between "expensive CSS" and "expensive CSS that also invalidates every frame."

## Break it

`index.html` renders 500 cards with every expensive property enabled at once, and scrolls/animates
them. Open it, scroll, and watch the HUD collapse.

## Measure it

This lab is an **ablation study**. That's the skill being taught: isolate one variable at a time.

1. Baseline: all effects **off**. Scroll 3s at 4× CPU. Record Paint total and FPS.
2. Turn on **one** property. Record. Turn it off.
3. Repeat for each property individually.
4. Then turn them all on and record. Is the total the sum of the parts, or worse? Explain either
   result.
5. For the worst offender, vary its magnitude (blur radius 2 → 8 → 20 → 60) and record. Plot it.
   Is it linear in radius? In radius²?
6. Vary the element count (50 / 200 / 500 / 2000) with just that one property on.

| Effect | Paint ms/s @500 | FPS | Notes |
|---|---|---|---|
| baseline (none) | | | |
| `border-radius` | | | |
| `box-shadow` small | | | |
| `box-shadow` large blur | | | |
| `filter: blur(8px)` | | | |
| `backdrop-filter: blur(12px)` | | | |
| `clip-path` polygon | | | |
| conic gradient | | | |
| `mix-blend-mode` | | | |
| **all on** | | | |

You now have a **cost table for your own machine**. This is a genuinely useful artefact — keep it,
and re-derive it when you get a new laptop or when a designer asks for glassmorphism.

## Why is it slow?

For your worst offender, answer: is the cost driven by the number of elements, the painted area,
or the effect's parameters? And separately: is it repainting every frame, or painting once and
compositing? Use Paint flashing plus the Layers panel to tell those apart — they lead to completely
different fixes.

## Fix it yourself

- [ ] **Promote the expensive element.** Give one expensive card `will-change: transform` and
      re-measure while scrolling. Did the per-frame paint go away? Explain what you traded for it.
- [ ] **Fake the shadow.** Replace `box-shadow` on 500 cards with a single pre-rendered shadow
      (a 9-slice `border-image`, a data-URI PNG, or one shared absolutely-positioned shadow
      element). Measure. Then judge: is the visual difference acceptable?
- [ ] **Cheapen the blur.** Take your `filter: blur(20px)` decoration and get within visual spitting
      distance for a fraction of the cost. Options: smaller radius on a smaller element that's then
      `scale()`d up, a pre-blurred image asset, or a downscaled blur layer. Measure each.
- [ ] **Kill the `backdrop-filter`.** Find two alternatives that look close enough (a
      semi-transparent solid, or a pre-blurred snapshot of the background) and measure all three.
- [ ] **Reduce the area.** Same `box-shadow`, but only on the 8 cards actually near the viewport
      (`IntersectionObserver`). Measure. Is "expensive CSS but only where visible" a legitimate
      technique or a hack? Argue both sides.
- [ ] **Set a budget.** Write down a rule you'd put in a code review: e.g. "`backdrop-filter` is
      allowed on at most one full-viewport element, never on list items." Make it specific enough
      to enforce.

<details>
<summary>Hint — why promotion helps and what it costs</summary>

An expensive paint on a promoted layer happens once; afterwards the compositor reuses the texture
and just transforms it. So scrolling costs nothing extra. You pay in GPU memory
(`w × h × dpr² × 4` bytes per layer) and in raster cost whenever the layer's *content* changes.
Promote the few expensive-and-static things; never promote 500 of them (Lab 15).
</details>

<details>
<summary>Hint — the blur trick</summary>

Blur cost scales with the area you blur and roughly with the radius. So: render the thing you want
blurred at 1/4 size into a small element, blur it with 1/4 the radius, and `transform: scale(4)`
it. You've cut the blurred pixel count by 16×. The result is slightly different (and often
*better*-looking for decorative glows). This is what design tools do too.
</details>

---

## 🏗️ Build challenge: two versions of the same beautiful UI

Take a genuinely fashionable design — a glassmorphic music player, or a dashboard with frosted
sidebars, soft shadows, gradient meshes, and glowing hover states. Build it twice.

**Version A — "the Figma-faithful build."** Every effect done the obvious way:
`backdrop-filter: blur(20px)` on panels, `box-shadow: 0 20px 60px` on every card, layered
`conic-gradient` background, `filter: drop-shadow` on icons, `mix-blend-mode: overlay` accents.
Make it genuinely pretty. Measure it while scrolling and while a card animates.

**Version B — "the same design, at 60fps."** Identical to a screenshot diff at rest (within a
tolerance you define), but built with a paint budget:
- shadows pre-rendered or drastically simplified
- one `backdrop-filter` at most, on a promoted layer, or replaced entirely
- gradients rasterized to an image, or moved to a single full-page layer that never repaints
- glows done with `opacity` transitions on pre-painted layers
- expensive decoration only where visible

**Deliverable:** a side-by-side comparison page showing both, with:
1. A screenshot diff at rest (they should be very close — if B looks obviously worse, you cheated).
2. Paint ms/s and FPS for both, scrolling and animating, at 4× throttle.
3. GPU memory for both, from the Layers panel.
4. A written list of every visual compromise you made, and which ones a designer would actually
   notice. **This list is the deliverable that matters** — "we can't do that, it's slow" loses the
   argument; "we can do 95% of that for 8% of the cost, here's the diff" wins it.

**Done when:** Version B holds 60fps at 4× CPU throttle while scrolling and animating, and you can
defend every compromise in the list to an imaginary designer without saying "performance" as if it
were a magic word.

---

## Interview questions

1. Rank these by paint cost and explain: `border-radius`, `box-shadow: 0 1px 2px`,
   `box-shadow: 0 30px 80px`, `backdrop-filter: blur(20px)`.
2. Why is `backdrop-filter` fundamentally more expensive than `filter`?
3. How does promoting an element to its own layer change the cost of an expensive paint?
4. How would you get a large soft shadow on 1,000 list items at 60fps?
5. Blur radius doubles. What happens to cost, roughly, and why?
6. A designer wants frosted glass over a scrolling list. What do you tell them?
