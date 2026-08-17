# Lab 03 — CLS ⭐⭐⭐⭐

**Goal:** find the node that moved, look *upward* for the cause, and reserve the space.

**Primary metric:** CLS, and the source node.

> <http://localhost:8080/web-vitals-and-react-perf/labs/03-cls/>

---

## The scoring

**impact fraction × distance fraction.** How much of the viewport moved, times how far the biggest
mover travelled as a share of the viewport. So half the screen twitching and one element crossing
the screen score similarly — the metric is about *how much of what you were looking at jumped*.

A shift at the top of a long page is expensive because everything below it moves. That's why the
header/banner area deserves most of your attention.

**Two definitional facts that change how you build:**

1. **Shifts within 500ms of a user input don't count** (`hadRecentInput`). Accordions, menus,
   filters — all free. The metric is about *unexpected* movement, so your UI doesn't need to be
   static, only predictable.
2. **CLS is the largest 5-second session window**, not a total. A long-lived page is judged on its
   worst moment, not its lifetime.

## The five causes

| Cause | Fix |
|---|---|
| images/video/iframes with no dimensions | `width`+`height` attributes, or `aspect-ratio` |
| content injected above existing content | reserve space, overlay it, or render it server-side |
| ad/embed slots that resize | reserve the **largest** size, per breakpoint |
| web fonts with different metrics | `size-adjust` + `ascent-override`, or `font-display: optional` |
| animating layout properties | `transform` and `opacity` only |
| client-side A/B tests | decide server-side — a flicker-free client swap isn't really possible |

## The debugging trap

Run **injected banner**. The `layout-shift` entry blames the **paragraph**. The banner didn't
shift — it *appeared*.

**The source is the victim, not the cause.** Always look for what was inserted above the node that
moved. In DevTools, the Performance panel's Layout Shift markers give you the same information with
before/after screenshots, which is usually faster.

## Images: you never had to choose

```html
<img src="hero.jpg" width="620" height="220" style="width:100%;height:auto">
```

Modern browsers turn `width`/`height` into a default `aspect-ratio`, so the box is reserved at the
right *shape* even when CSS makes the width fluid. Responsive **and** stable.

`aspect-ratio` is the general form — use it for anything whose shape you know but whose size you
don't: video embeds, maps, charts, skeleton cards.

## Fonts: metric matching beats every `font-display` value

```css
@font-face {
  font-family: "Fallback"; src: local("Arial");
  size-adjust: 107%; ascent-override: 90%; descent-override: 22%; line-gap-override: 0%;
}
```

Now `swap` costs nothing, because nothing moves.

| `font-display` | LCP | CLS |
|---|---|---|
| `swap` | best | worst — always risks the reflow |
| `block` | worst — invisible text up to 3s | hides FOUT |
| `optional` | good | **zero** — uses the font only if nearly instant, and still caches it for next time |

`optional` is underrated: it accepts one page load in the fallback in exchange for never shifting.

## `transform` is invisible to CLS

CLS counts changes to an element's **start position in layout**. `transform` is applied by the
compositor after layout, so a transform animation contributes nothing however dramatic it looks.

Same fact as [critical-rendering-path lab 05](../../../critical-rendering-path/labs/15-composite-layers/),
arriving from a different direction: there it made animation cheap, here it makes it free. Animating
`top`/`left`/`width`/`height` does both harms — janky frames *and* layout shift.

## Think about

- Your cookie banner is required and must be visible. How do you get CLS to zero?
- An infinite feed appends 20 rows every scroll. Is that CLS?
- Why doesn't opening an accordion count?

<details>
<summary>Answers</summary>

**Cookie banner.** Make it not participate in layout: `position: fixed` at the bottom (or as an
overlay). It shifts nothing, because nothing flows around it. If legal insists it be inline at the
top, render it **server-side** so it's in the first paint — the shift comes from arriving late, not
from existing. The version that always fails is "inject it client-side once the consent SDK loads."

**Infinite feed appending.** No, if it appends *below* the viewport — nothing visible moves.
Prepending is the problem (chat, "new messages"), and the fix is scroll anchoring: browsers do this
automatically via `overflow-anchor`, which you can accidentally disable with `overflow-anchor: none`.
Manually: read `scrollHeight` before insertion and restore the offset after.

**Accordion.** `hadRecentInput` — any shift within 500ms of a discrete user input is excluded. The
metric is about movement the user didn't cause. Note the 500ms window is short: an accordion that
animates open over 600ms *can* produce counted shifts near the end, which is one more reason to
animate with `transform`/`max-height` on the compositor path rather than reflowing content.
</details>

---

## 🏗️ Build challenge

1. Add `onCLS` with attribution to your RUM and log `largestShiftTarget` per route.
2. Take the top offender and fix it by reserving space. Confirm the number moves.
3. Write a Playwright test that loads a route, waits for network idle, and asserts CLS < 0.1 using
   the same `PerformanceObserver` as `shared/vitals.js`. Run it in CI.
4. Audit every `<img>` in your codebase for `width`/`height` — a lint rule (`jsx-a11y` won't do it;
   write a simple one) is cheaper than remembering.
5. Add fallback metric overrides for your primary web font and measure the difference.

**Done when:** CI fails when someone adds an unsized image to a top route.

---

## Interview questions

1. How is CLS scored?
2. The entry names a `<p>`. What do you look for?
3. Why is CLS windowed rather than summed?
4. Which shifts are excluded, and why?
5. `font-display: swap` vs `optional` — which for LCP, which for CLS, and how do you get both?
