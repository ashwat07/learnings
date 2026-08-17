# Lab 06 — Choosing ⭐⭐⭐⭐

**Goal:** pick a rendering technology once, deliberately, and know what you traded.

> <http://localhost:8080/graphics-and-animation/labs/06-choosing/>

---

## The matrix

| Tech | Objects | Accessibility | Text | Hit-testing | Debugging |
|---|---|---|---|---|---|
| DOM + CSS | < ~1,000 | free | selectable, searchable, translatable | free | Elements panel |
| SVG | < ~5,000 | good (roles, `<title>`, focusable) | real text | free, per shape | Elements panel |
| canvas 2D | ~100,000 | you build it | pixels | you build it | hard |
| WebGL/WebGPU | millions | you build it | pixels | you build it | very hard |

**Read the middle columns first.** The object counts are what people choose on; the accessibility,
text and hit-testing columns are what they regret.

## The question that decides it

> **Is this content, or a rendering?**

**Content** — a chart a person reads, a diagram, a table, a form. It has meaning someone might need
to read with a screen reader, select, copy, search, translate, or zoom to 400%. **Use the DOM or
SVG.** A 40-bar chart in SVG is accessible, styleable, printable and hoverable for free.

**A rendering** — a game, a map, a 50,000-point scatter plot, a photo editor. The pixels are the
product. **Use canvas or WebGL**, and provide the information another way.

The mistake in each direction:

- a dashboard rebuilt in canvas "for performance" that now needs a custom tooltip system, a custom
  focus model, and a data table nobody built — to render 200 elements
- a 100,000-point scatter plot in SVG that takes eight seconds to open

## Rough budgets

| Count | Use |
|---|---|
| 10–100 | DOM. Anything else is premature. |
| 100–1,000 | DOM with care: `transform`/`opacity` only, virtualize lists |
| 1,000–5,000 | SVG if content, canvas if a rendering |
| 5,000–100,000 | canvas 2D with batching, culling, pre-rendered sprites |
| 100,000+ | WebGL/WebGPU, **or aggregate before rendering** |

### The option missing from the table: render fewer things

- **Virtualize** — a list of 100,000 rows renders 40
- **Cull** — don't draw what's outside the viewport
- **Aggregate** — 500,000 points is at most 1,920 columns of pixels; bin server-side or in a worker.
  Nobody can see 500,000 points, and a shape-preserving downsample (LTTB) looks identical
- **Simplify geometry** — map polygons at zoom 3 don't need 12 decimal places

Every one is cheaper than changing technology, and several are necessary even if you do.

## Hybrids are usually the right answer

| Pattern | Example |
|---|---|
| canvas for data, DOM for chrome | a map: canvas tiles, DOM controls and popups |
| canvas scene, DOM for the focused item | 10,000 points drawn; the hovered one gets a real tooltip element |
| **SVG over canvas** | a canvas heatmap with SVG axes and labels — real, selectable text |
| two stacked canvases | static background, dynamic foreground |
| OffscreenCanvas in a worker | the render loop is immune to main-thread jank |
| a DOM proxy layer | invisible focusable elements mirroring canvas hotspots |

**Draw the many things on a canvas; keep the few important things in the DOM.** Ten thousand points
are pixels; the one the user is pointing at is an element with a tooltip, a focus ring and an
accessible name. That gets you canvas throughput and most of the DOM's accessibility, for far less
work than either extreme.

## The motion questions, whatever you chose

1. **`prefers-reduced-motion`** — check it in CSS *and* JS. "Reduce" means remove *movement*, not all
   feedback. [accessibility lab 05](../../../accessibility/labs/05-visual-and-motion/).
2. **Stop when hidden.** rAF pauses in a background tab; `setInterval` doesn't, and an
   OffscreenCanvas worker keeps running — stop those explicitly on `visibilitychange`.
3. **Degrade on weak devices.** `hardwareConcurrency` and `deviceMemory` are crude signals; measuring
   your own frame rate for a second and dropping particle count or pixel ratio is better. Design for
   three fidelities.
4. **Does the motion mean something?** Motion showing causality, continuity or state earns its cost.
   Decoration is a cost paid on every device, including the cheap one on a train.

That last one isn't a performance point, but it produces the biggest wins — the fastest animation is
the one you decided not to build.

## Think about

- Your PM wants a 3D landing page. What do you ask?
- A chart library renders to canvas. Is that a problem?
- When would you use SVG over both?

<details>
<summary>Answers</summary>

**3D landing page.** Ask what it's for and what the fallback is. Concretely: what does a user on a
mid-range Android on 4G see, how many bytes and how much GPU is it, what happens under
`prefers-reduced-motion`, what does a crawler see, and is the LCP element inside the 3D scene (in
which case your Core Web Vitals are now bound to a WebGL boot). If the answers are good it's a fine
idea — a hero canvas that lazy-loads after the content and degrades to a static image is entirely
reasonable.

**Canvas chart library.** Only if it doesn't give you an accessible alternative. The good ones render
canvas *and* maintain an accessible description or a DOM proxy layer; the rest hand you a picture of
your data. Check before you adopt: turn on a screen reader and try to read a value. If you can't, you
own that gap — usually solved by rendering a visually-hidden data table alongside.

**SVG over both.** When the content is information *and* it needs to be styleable, animatable per
element, hit-testable, printable, or resolution-independent — diagrams, icons, maps at moderate
detail, charts up to a few thousand marks. SVG is the DOM's answer for graphics, so you keep CSS,
accessibility, and event handling per shape. It falls over on count, and on text-heavy re-layout.
</details>

---

## 🏗️ Build challenge

1. List your app's rendering-heavy surfaces. Classify each: content or rendering.
2. For any built in canvas, check whether the object count justifies it. Some won't.
3. For any built in the DOM that struggles, try "render fewer things" before changing technology.
4. Add the missing accessible path to one canvas surface.
5. Add fidelity degradation driven by measured frame rate.
6. Audit for animation that stops when the tab is hidden — including worker-driven loops.

**Done when:** every rendering choice in your app has a written justification, and every canvas has an
accessible alternative.

---

## Interview questions

1. What's the question that decides DOM vs canvas?
2. What do you lose when you move to canvas?
3. Name three ways to render fewer things.
4. Describe a hybrid architecture and what each layer is for.
5. What must you check before shipping any animation?
