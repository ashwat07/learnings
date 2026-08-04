# Lab 18 — Layout shift (CLS) ⭐⭐⭐⭐

**Goal:** understand how CLS is actually computed — including the session-window rule almost nobody
knows — and fix every common source of shift, including the one that fixing a *different* metric
creates.

**Primary metric:** CLS. Good < 0.1, poor > 0.25.

> Lab 11 covered image-driven shift. This lab covers everything else, and fonts.

---

## The concept

A layout shift is an **unexpected** movement of visible content. The score for one shift:

```
score = impact fraction × distance fraction

impact fraction   = (viewport area affected by moved elements) / (viewport area)
distance fraction = (greatest distance any element moved) / (viewport's largest dimension)
```

So a small element moving a long way and a large element moving slightly can score the same. Both
matter because both make the user lose their place or tap the wrong thing.

**CLS is not the sum of all shifts.** It's the largest **session window**: a group of shifts where
each is within 1s of the previous, and the window is at most 5s long. The reported CLS is the highest
window's total. This matters because it means one bad moment dominates, and it means a long page with
many small scattered shifts can score better than a short page with one clustered burst.

**The 500ms input exclusion.** A shift within 500ms of a user interaction has `hadRecentInput: true`
and is excluded from CLS — the reasoning being that shifts the user *caused* are expected. Which
creates a trap: an accordion that violently reflows the page on click scores 0.00 and is still a bad
experience. Metric and experience diverge; know where.

### The sources

| Source | Why | Fix |
|---|---|---|
| Images/embeds without dimensions | no space reserved until bytes arrive | `width`/`height`, `aspect-ratio` |
| Injected banners, cookie notices, promos | inserted above existing content | reserve space, or `position: fixed`/overlay |
| Async content above the fold | placeholder smaller than the real thing | skeletons with the *correct* size |
| Web fonts | fallback metrics ≠ web font metrics, so text reflows on swap | `size-adjust`, metric overrides, or matched fallback |
| Late CSS | element styled after first paint | inline critical CSS (Lab 13) |
| Animating layout properties | every frame is a shift | animate `transform` (Lab 03) |
| Scrollbar appearing | content width changes | `scrollbar-gutter: stable` |
| `content-visibility` / virtualization | estimated sizes wrong → scroll jump | accurate `contain-intrinsic-size` |
| `@container` / late-resolving layout | first paint uses the wrong branch | reserve, or avoid above the fold |

Note two entries there that are *caused by fixing other things*. `font-display: swap` fixes Lab 13's
invisible text and creates shift. `content-visibility: auto` fixes Lab 05's layout cost and creates
scroll instability. That's the theme of this lab: performance fixes trade against each other, and the
senior skill is knowing the trade rather than chanting the tip.

## Break it

`index.html` has eight shift sources, each independently triggerable:

1. **`injectBanner`** — a promo bar inserted at the top of the document after 1s.
2. **`asyncContent`** — a placeholder replaced by taller real content.
3. **`lateImage`** — an image with no dimensions (a compact version of Lab 11's).
4. **`fontSwap`** — a web font with mismatched fallback metrics.
5. **`embedIframe`** — an iframe with no reserved height.
6. **`prependItems`** — a "load newer" that prepends to a list you're reading.
7. **`accordion`** — animates `height`, shifting everything below, on click. This one scores ~0.
8. **`scrollbar`** — content grows past the viewport, the scrollbar appears, everything narrows.

The page implements the **real** CLS algorithm — session windows and all — so you can watch the
windows form and see why the number is what it is.

## Measure it

1. The page shows: every individual shift with its score, impact and distance fractions, and the
   source elements; the current session windows; and the resulting CLS.
2. **Performance panel → Experience track.** Each shift marker is clickable and names the moved
   elements. Cross-check against the page's numbers.
3. **Rendering → "Layout Shift Regions"** — flashes the shifted regions blue. Turn it on and trigger
   each source; it's the fastest way to see what actually moved versus what you thought moved.
4. For interaction 7, note `hadRecentInput: true` and that CLS stays at 0.
5. Lighthouse for a second opinion, and to see the "Avoid large layout shifts" audit's element list.

| Source | Individual score | Impact fraction | Distance fraction | In CLS? | Fixed score |
|---|---|---|---|---|---|
| 1 injected banner | | | | yes | |
| 2 async content | | | | yes | |
| 3 late image | | | | yes | |
| 4 font swap | | | | yes | |
| 5 iframe | | | | yes | |
| 6 prepended items | | | | yes | |
| 7 accordion (after click) | | | | **no** | |
| 8 scrollbar | | | | yes | |
| **total CLS** | | | | | **< 0.05** |

## Why does it shift?

1. For source 1, compute the score by hand from the banner's height and the viewport size, then check
   your arithmetic against the reported value. Doing this once makes the metric concrete forever.
2. Sources 2 and 3 both "load something late". Why do they score differently?
3. For source 4, what exactly moved? (It isn't the font — it's every line of text after the metrics
   changed.) Measure the shift with the fallback set to a metric-matched font and explain the delta.
4. Source 7 scores 0.00 and is clearly bad. Justify the spec's exclusion rule anyway — what would go
   wrong if input-driven shifts *were* counted?
5. Source 8: why does a scrollbar appearing shift content, and why is this worse on desktop Windows
   than on macOS with overlay scrollbars?

## Fix it yourself

- [ ] **`fixInjectBanner()`** — the banner must still appear. Two implementations: reserve space up
      front, and render it as a fixed overlay. Measure both, and say which you'd ship for a cookie
      notice versus for a persistent nav banner.
- [ ] **`fixAsyncContent()`** — a skeleton whose size *matches* the real content. Then handle the
      honest case where you can't know the height in advance: what's the least-bad option? Implement
      it and defend it.
- [ ] **`fixLateImage()`** — `width`/`height` plus `aspect-ratio`. Then the harder case: a
      user-uploaded image whose dimensions you don't know server-side. Solve it.
- [ ] **`fixFontSwap()`** — the full treatment: `preload` the woff2, `font-display: optional` versus
      `swap` (measure both, they trade differently), and a metric-matched `@font-face` fallback using
      `size-adjust` / `ascent-override` / `descent-override`. Compute the override values from the
      font's actual metrics rather than guessing, and show your working.
- [ ] **`fixEmbedIframe()`** — reserve space with `aspect-ratio`, and handle the resize-after-load
      case without a shift.
- [ ] **`fixPrependItems()`** — new items must be *available* without moving what the user is reading.
      Options: a "3 new items" button that prepends on demand, or prepend + scroll-anchor compensation.
      Implement one and explain how `overflow-anchor` interacts with it.
- [ ] **`fixAccordion()`** — no shift at all, even though it scored 0 to begin with. This is the
      "fix the experience, not the metric" exercise. Reuse Lab 03's height-animation techniques.
- [ ] **`fixScrollbar()`** — `scrollbar-gutter: stable`. Then check what it costs you visually and
      whether it's the right default for your layout.
- [ ] **The trade-off audit.** Take your Lab 13 critical-CSS fix and your Lab 05
      `content-visibility` fix, apply them to this page, and measure CLS. If either made CLS worse,
      resolve it. Write down the two-way trade in each case — this bullet is the most valuable one in
      the lab.

<details>
<summary>Hint — computing the score by hand</summary>

Viewport 1000×800. A 100px banner is inserted at the top, pushing a 600px-tall block of content down
by 100px.

- The moved content occupies 600px of height across the full width, and its union with its new
  position covers 700px → impact fraction = 700/800 = 0.875.
- Greatest distance moved = 100px; the viewport's largest dimension is 1000 → distance = 0.1.
- Score = 0.875 × 0.1 = 0.0875. One banner, nearly the entire CLS budget.
</details>

<details>
<summary>Hint — metric overrides</summary>

```css
@font-face {
  font-family: 'Fallback';
  src: local('Arial');
  size-adjust: 107%;        /* scale so the x-height matches */
  ascent-override: 90%;
  descent-override: 22%;
  line-gap-override: 0%;
}
body { font-family: 'Newsreader', 'Fallback', serif; }
```
Get the real numbers from the font's metrics (`ascender`/`descender`/`unitsPerEm` — readable with
`fontkit`, `opentype.js`, or the Fonts pane in DevTools). Tools like `fontaine` and `capsize`
automate the calculation. If the swap produces zero shift, you got the numbers right.
</details>

---

## 🏗️ Build challenge: a shift-source attribution tool

CLS in the field tells you a number. It doesn't tell you what moved, and by the time you look, the
page is settled. Build the thing that answers "what moved, and what caused it".

**Part 1 — the runtime attributor.** For each `layout-shift` entry:
1. Record the score, `hadRecentInput`, and every `source` with its `previousRect`/`currentRect`.
2. Compute a stable selector for each source node (nth-child path or a data attribute), so the
   report survives the page being torn down.
3. **Attribute the cause**, which is the hard and interesting part. Correlate the shift's timestamp
   against: resources that finished in the preceding ~100ms (via `PerformanceObserver` on `resource`),
   `MutationObserver` records in that window, and `document.fonts` load events. Emit a best guess:
   "shift of 0.09 at 1240ms, source `main > article`, likely cause: `<img src=hero.jpg>` finished
   loading at 1231ms with no dimensions."
4. Implement the real session-window algorithm and report CLS, plus the window's contents, so you can
   see which cluster dominates.
5. Keep it under 0.2ms per shift and don't retain the nodes (`WeakRef` — Lab 10's trap again).

**Part 2 — the CI check.** Playwright, on a matrix of viewports (360/768/1440) and network profiles:
1. Load the page, wait for full settle, report CLS with attribution.
2. Additionally test the *interaction* case: click things and report shifts that were excluded by
   `hadRecentInput` but exceed a threshold — the shifts CLS forgives and users don't. Report those as
   a separate "UX shift" metric of your own definition.
3. Fail with the attributed cause, not just a number.

**Part 3 — the finding.** Run it on a real site. Report CLS per viewport, the dominant session window,
the attributed cause of the worst shift, and at least one input-excluded shift that you think should
be fixed anyway. Then fix one and show the before/after.

**Done when:** your CLS matches `web-vitals`'s on the same load, the attributor correctly names the
cause for all eight sources in this lab, and it found a real shift on a real site — including one that
CLS was hiding.

---

## Interview questions

1. How is a layout shift's score computed?
2. What's the session-window rule, and why does CLS use it instead of a plain sum?
3. What does `hadRecentInput` do, and what does it hide?
4. Why do web fonts cause layout shift, and how do you get it to zero?
5. `width`/`height` attributes versus CSS `aspect-ratio` — when do you use which?
6. We added `content-visibility: auto` and CLS got worse. Why, and what's the fix?
7. A cookie banner is required at the top of the page. How do you ship it with zero CLS?
8. Our CLS is 0.02 in the lab and 0.31 in the field. What are the likely causes?
