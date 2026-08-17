# Lab 04 — Canvas 2D ⭐⭐⭐⭐⭐

**Goal:** know when the DOM stops being the right tool, and how to make canvas fast.

**Primary metric:** FPS and draw-ms/frame at 500, 2,000 and 10,000 objects.

> <http://localhost:8080/graphics-and-animation/labs/04-canvas-2d/>

---

## Why canvas wins at scale

The DOM isn't slow at *drawing* 10,000 dots — it's slow at **maintaining** 10,000 elements. Each one
carries style resolution, a layout box, compositing decisions and an accessibility tree node, every
frame.

Canvas has one element and a bitmap. Fill in:

| | 500 | 2,000 | 10,000 |
|---|---|---|---|
| DOM (`transform`) | | | |
| canvas 2D | | | |

Watch **draw ms/frame**: that's your real budget line. Keep drawing under ~8ms of the 16.7.

## Device pixel ratio — the most common canvas bug

A canvas has **two sizes**:

```js
canvas.width  = cssWidth  * devicePixelRatio;   // the backing store — pixels you draw into
canvas.height = cssHeight * devicePixelRatio;
canvas.style.width  = cssWidth  + 'px';         // how big it appears
canvas.style.height = cssHeight + 'px';
ctx.scale(devicePixelRatio, devicePixelRatio);  // now draw in CSS pixels
```

Get it wrong one way and everything is blurry. Get it wrong the other and you fill **nine times** as
many pixels on a 3× phone — the device that can least afford it.

For expensive scenes, cap it: `Math.min(devicePixelRatio, 2)`. The visual difference above 2× is
small and the fill cost is quadratic. Re-run the setup on resize **and** when the window moves
between monitors (`matchMedia('(resolution: Xdppx)')`).

## The rules

| Rule | Why |
|---|---|
| **batch by state** | `fillStyle`/`font` changes are the expensive part, not the shapes |
| `fillRect` beats `arc()` | no path construction; for small particles nobody can tell |
| avoid `save()`/`restore()` per object | the state stack costs more than the draw |
| round coordinates | a 0.5 offset makes the rasteriser antialias every edge |
| **pre-render sprites to an offscreen canvas** | the single biggest win — turns rasterisation into a blit |
| **layer static and dynamic content** | stacked canvases; redraw the background rarely |
| clear only what changed (dirty rects) | clearing everything is a full-surface fill |
| `getContext('2d', {alpha: false})` | an opaque context skips per-pixel blending |
| cull off-screen objects | the cheapest draw is the one you skip |
| **never `getImageData` in a loop** | it forces a GPU→CPU sync and destroys the frame |

For hit-testing, keep your own spatial index (or use `ctx.isPointInPath`) rather than reading pixels.

## OffscreenCanvas

Two different jobs:

1. **An off-DOM drawing surface** on the main thread — the pre-rendering target above.
2. **A canvas a worker can draw into:**

```js
const off = canvas.transferControlToOffscreen();
worker.postMessage({ canvas: off }, [off]);
```

After `transferControlToOffscreen` **the main thread can no longer draw to that canvas** — control
has moved. The worker's render loop is then completely unaffected by main-thread jank: 60fps while
React re-renders, while a long task runs, while the user drags a list. Same prize as compositor-thread
animation in [lab 01](../01-the-pipeline/). Built in
[web-workers lab 05](../../../web-workers/labs/05-when-not-to/).

Costs: input still arrives on the main thread (post it across), no DOM access, and your state now
lives in two places — an architectural commitment, not a flag.

## What canvas takes away

Canvas content is invisible to assistive technology, text search, translation, selection, and a user
zoomed to 400%. It's a picture.

- **Put real content inside the `<canvas>` element** — its children are fallback content and *are*
  exposed to assistive tech. A data table, or focusable buttons mirroring your hotspots. This is the
  specified mechanism and it's badly underused.
- Provide the information another way: a table below the chart, a summary, a CSV.
- For interactive canvases, maintain a parallel DOM of focusable proxies kept in sync — what
  accessible charting libraries do.

**If the content is information, prefer SVG or the DOM.** If it's a rendering, canvas is right and
you owe the user another path to the information. [Lab 06](../06-choosing/).

## Think about

- Your canvas is blurry on a MacBook. Why?
- You draw 5,000 identical icons. What's the fastest approach?
- Why is `getImageData` so expensive?

<details>
<summary>Answers</summary>

**Blurry canvas.** The backing store is at 1× while the element is displayed at 2× (or 3×), so the
browser upscales your bitmap. Set `canvas.width/height` to CSS size × `devicePixelRatio` and scale the
context. The complementary bug — setting the backing store correctly but forgetting `ctx.scale` —
gives you a sharp image drawn at half size in the corner.

**5,000 identical icons.** Pre-render the icon **once** into an offscreen canvas at the right size,
then `drawImage` it 5,000 times. You convert 5,000 path constructions and rasterisations into 5,000
blits, which is roughly an order of magnitude cheaper. If they vary by colour, pre-render one per
colour into a sprite atlas and draw sub-rectangles.

**`getImageData`.** It forces a **pipeline stall**: the canvas may be GPU-backed, so reading pixels
means the CPU must wait for the GPU to finish everything queued and then transfer data back across
the bus. That's typically several milliseconds — most of a frame — regardless of how few pixels you
asked for.
</details>

---

## 🏗️ Build challenge

1. Take a DOM-rendered visualisation with more than ~1,000 nodes and rewrite the drawing in canvas.
   Measure FPS before and after.
2. Fix DPR handling and verify sharpness on a 2× display and cost on a 3× one.
3. Pre-render every repeated shape into a sprite; measure the improvement.
4. Split into two stacked canvases: static background, dynamic foreground.
5. Add fallback content inside the `<canvas>` and a data table — then use it with a screen reader.
6. Move the render loop into a worker with `OffscreenCanvas` and confirm it survives a 500ms
   main-thread task.

**Done when:** 60fps with your real object count at 4× throttle, and the information is available to
a screen reader.

---

## Interview questions

1. Why does canvas beat the DOM at scale — what exactly is the DOM paying for?
2. Explain the two canvas sizes and the DPR setup.
3. Name three canvas optimisations and what each saves.
4. What does `transferControlToOffscreen` do, and what can you no longer do after it?
5. How do you make a canvas visualisation accessible?
