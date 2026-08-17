# Lab 01 — Images: formats & sizes ⭐⭐⭐⭐⭐

**Goal:** ship the right number of pixels in the right format, and be able to prove which candidate
the browser actually chose.

**Primary metric:** bytes transferred for the image the user actually sees.

> `node make-images.mjs` in `asset-optimization/` first, then
> <http://localhost:8080/asset-optimization/labs/01-images/>

---

## Two decisions, in order of impact

**1. How many pixels.** Bytes scale with pixel count, which is *quadratic* in width — doubling the
width quadruples the pixels. Sending a 2000px image to a 400px slot wastes more than any format
choice can recover.

**2. Which format.** Worth 25–50%, and dependent on content.

Fill in your own numbers (generated on your machine, so WebP/AVIF rows depend on what you have
installed):

| format | bytes | vs uncompressed | vs JPEG |
|---|---|---|---|
| bmp | | 100% | |
| png | | | |
| jpg | | | |
| webp | | | |
| avif | | | |

## Format by content, not by fashion

| Content | Format |
|---|---|
| Photographs | AVIF > WebP > JPEG |
| Flat colour, screenshots, text, line art | PNG or lossless WebP — **JPEG is terrible here** |
| Anything drawable | **SVG**, usually smaller than all of them, and resolution-independent |
| Needs transparency | WebP / AVIF / PNG (JPEG has none) |
| Animation | AVIF / WebP, or a **video** — never GIF (often 10× the size of an equivalent video) |

Ship modern formats with a fallback and let the browser choose:

```html
<picture>
  <source type="image/avif" srcset="hero.avif">
  <source type="image/webp" srcset="hero.webp">
  <img src="hero.jpg" width="1200" height="675" alt="…">
</picture>
```

**Order matters** — the browser takes the first `type` it supports, so best format first.

## The wrong-size problem

Run the **cost of the wrong size** demo. This is the most common image mistake in existence and
it's invisible in review, because the page looks right: the browser scales the image down and
nobody sees the waste.

Find it on any real site by pasting this into the console:

```js
[...document.images]
  .map(i => ({ src: i.currentSrc.split('/').pop(),
               natural: i.naturalWidth,
               needed: Math.round(i.clientWidth * devicePixelRatio) }))
  .filter(i => i.natural > i.needed * 1.5)
```

It's usually a long list. Lighthouse's "Properly size images" audit reports the same thing with
estimated savings.

## `srcset` and `sizes`, precisely

```html
<img src="hero-800.png"
     srcset="hero-400.png 400w, hero-800.png 800w, hero-1200.png 1200w, hero-2000.png 2000w"
     sizes="(max-width: 500px) 380px, 900px"
     width="1200" height="675" alt="…">
```

- **`srcset`** — a menu of candidates with their *intrinsic* widths.
- **`sizes`** — how wide the image *will be*, in CSS pixels, per media condition.

The browser computes `needed = sizes-width × DPR` and picks the smallest candidate ≥ that. So:

- **A wrong `sizes` silently defeats the whole mechanism.** `sizes="100vw"` on an image that's
  actually 400px wide makes a desktop download the 2000px file. This is extremely common, because
  `100vw` is what every tutorial shows.
- `sizes` has to be known *before* layout, which is why it's a media query and not a CSS value.
  Newer browsers support `sizes="auto"` for `loading="lazy"` images, which fixes it properly.
- `width`/`height` attributes are still required — they reserve space (Lab 02).

Use **`currentSrc`** to check what was actually chosen. It's the only reliable verification, and the
lab's picker demo shows it changing as you change the container.

## Think about

- Your CMS stores one 4000px original. What does the pipeline need to produce, and how do you
  decide the breakpoints?
- When is a bigger file the right choice?
- Why is `sizes="100vw"` usually wrong?

<details>
<summary>Answers</summary>

**Breakpoints.** Derive them from your *layout*, not from device names: for each image slot, the CSS
widths it takes across your breakpoints, each × 1 and × 2 DPR, deduplicated and rounded. Usually
3–5 widths per slot. Generating 12 widths "to be safe" costs storage, build time and cache entries
for no benefit.

**Bigger is right when:** the image is the LCP element and a slightly larger, higher-quality file
loads in the same round trip anyway (below ~14KB you're inside the initial congestion window); or
when compression artifacts are visible on the content that matters (a product photo where the
texture is the point). Both are judgement calls that need eyes, not a formula.

**`100vw`.** It claims the image spans the full viewport, so the browser picks a candidate for the
full viewport width. Correct for a full-bleed hero; wrong for anything in a container, a grid, or a
max-width layout — which is most images. Write the real widths, per breakpoint.
</details>

---

## 🏗️ Build challenge: an image pipeline audit

Build `image-audit.mjs` that runs against a real page:

1. For every `<img>` and CSS background image: intrinsic size, displayed size × DPR, format, bytes,
   and whether it's the LCP element.
2. Report **wasted bytes** per image: the difference between the file shipped and the smallest file
   that would have served the slot at 2× DPR. Rank by waste.
3. Detect **missing modern formats**: for each JPEG/PNG, re-encode it locally to WebP and AVIF and
   report the byte savings you'd get. A number beats an argument.
4. Detect **wrong `sizes`**: compare the declared `sizes` against the element's measured width at
   3 viewport widths, and report images where they disagree by more than 20%.
5. Detect images that should be **SVG** — heuristic: PNG, few unique colours, sharp edges. Even a
   crude version finds the icon set someone exported as PNG.
6. Output a per-page total: "2.4MB of images, 1.6MB avoidable" with a per-image breakdown.

**Done when:** you run it on a real site and can hand someone a ranked list where the top item is
one image and one number.

---

## Interview questions

1. Which matters more, format or dimensions? Why?
2. When is JPEG the wrong choice?
3. What does `sizes` do, and what happens when it's wrong?
4. How do you verify which srcset candidate the browser picked?
5. Why does `<picture>` source order matter?
6. How would you choose the breakpoints for a responsive image set?
