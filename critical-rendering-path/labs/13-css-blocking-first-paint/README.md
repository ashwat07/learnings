# Lab 13 — CSS blocking first paint ⭐⭐⭐⭐

**Goal:** understand *render*-blocking versus *parser*-blocking, and learn the critical-CSS technique
properly — including its real costs, which are usually left out of the blog posts.

**Primary metric:** First Contentful Paint.

> **Needs a generator and a server.**
> ```sh
> node make-css.mjs           # writes css/part-00.css … part-19.css
> cd ../.. && ./serve.sh
> ```
> Then <http://localhost:8080/labs/13-css-blocking-first-paint/>.

---

## The concept

CSS is **render-blocking, not parser-blocking**. The HTML parser keeps building the DOM while
stylesheets download — but the browser will not paint until every render-blocking stylesheet has
arrived and the CSSOM is complete.

Why? Because painting with incomplete styles would produce a flash of unstyled content, then a
re-render. The browser chooses a blank screen over a wrong screen.

Consequences, in order of how often they bite:

1. **FCP is gated by your slowest stylesheet.** 20 stylesheets on HTTP/1.1 means 4 rounds of 6
   connections before anything appears.
2. **A stylesheet blocks scripts, which blocks the parser.** A synchronous script must wait for
   pending stylesheets (it might call `getComputedStyle`), and the parser waits for the script. So
   slow CSS → delayed JS → delayed DOM. That's a three-link chain from one slow file.
3. **`@import` inside CSS is the worst case.** The imported file isn't discoverable until the parent
   stylesheet has arrived and been parsed. A latency chain, invisible to the preload scanner. Never
   use it for anything in the critical path.
4. **`media` attributes make a stylesheet non-blocking.** `<link media="print">` isn't render
   blocking. This is the mechanism behind the standard async-CSS trick.
5. **Fonts add a second gate.** A web font can block *text* rendering (`font-display: block`) even
   after the CSS has arrived, so FCP happens but with invisible text. `font-display: swap` trades a
   FOUT for earlier text.

## Break it

| Page | What it does |
|---|---|
| [01-twenty-stylesheets.html](01-twenty-stylesheets.html) | 20 render-blocking stylesheets, one with an `@import` chain, one web font with `font-display: block`. |
| [02-async-css.html](02-async-css.html) | Demonstrates the `media` swap technique so you can see it work before you build with it. |
| [03-your-fix.html](03-your-fix.html) | **Yours.** |

## Measure it

Fast 3G, CPU 4×, incognito, reload-and-record:

1. **Performance panel** — FP, FCP, LCP, DCL. Note the gap between `Parse HTML` finishing and the
   first paint. That gap *is* the CSS blocking.
2. **Network panel** — find the 20 stylesheets. Note their priority (Highest), and find the
   `@import`ed file: notice it starts *after* its parent finished.
3. Screenshot filmstrip (Performance panel → check "Screenshots"): the blank frames are the cost.
4. Turn on **Rendering → "Highlight ad frames"?** No — instead check the Coverage tab
   (⌘⇧P → "Show Coverage"), reload, and read **how much of the CSS was actually used**. This is the
   number that motivates critical CSS, and it's usually shocking.
5. Note the **font** behaviour: is text visible before the font loads? Toggle `font-display` and
   re-measure.

| Metric | Broken | Fixed | Target |
|---|---|---|---|
| FCP | | | < 1s |
| Blank frames in filmstrip | | | ≤ 1 |
| Render-blocking requests | 20 | | 1 (or 0) |
| CSS bytes before first paint | | | < 14KB |
| Unused CSS % (Coverage) | | | |
| Text visible before font loads? | no | | yes |

That 14KB figure is not arbitrary — it's roughly what fits in the first TCP congestion window, so
inlined CSS under that size arrives in the first round trip.

## Why is it slow?

1. Where exactly, in the trace, is the browser waiting? Name the thing it's waiting for and the
   thing it refuses to do until then.
2. The page has both 20 stylesheets *and* an `@import` chain. Which costs more? Measure separately.
3. Find the script in page 01 that is delayed by CSS. Explain the chain in one sentence.
4. Coverage says most of the CSS is unused. Why doesn't the browser just skip it?

## Fix it yourself

Build **03-your-fix.html**:

- [ ] **Inline critical CSS.** Extract the styles needed for above-the-fold content and inline them
      in a `<style>` block. Keep it under 14KB. Measure FCP.
- [ ] **Async-load the rest.** Two techniques, both implemented and measured:
      ```html
      <link rel="stylesheet" href="rest.css" media="print" onload="this.media='all'">
      <!-- and the preload variant -->
      <link rel="preload" href="rest.css" as="style" onload="this.rel='stylesheet'">
      ```
      Add a `<noscript>` fallback for both. Explain the difference and which you'd ship.
- [ ] **Kill the `@import`.** Replace with parallel `<link>` tags and measure the delta.
- [ ] **Fix the font.** `font-display: swap`, `preload` the font file, and subset it. Measure when
      text becomes visible in each case. Then consider `size-adjust`/fallback metric overrides to
      avoid the layout shift that `swap` introduces — because you'll have traded a FCP problem for a
      CLS problem, and noticing that trade is the point.
- [ ] **Automate the extraction.** Hand-extracting critical CSS is a maintenance disaster. Write a
      script (Playwright + `Coverage` API, or the `critical`/`penthouse` approach) that renders the
      page at 3 viewport sizes, collects the used rules, and emits the critical block. Then find its
      limitations: interactive states (`:hover`, `:focus`), dynamically-added classes, and A/B
      variants — none of which appear in a static render. Document each and your mitigation.
- [ ] **Measure the FOUC risk.** Deliberately get the critical extraction wrong and observe the
      visual result. Then decide how you'd catch that in CI (screenshot diff at first paint).
- [ ] **Consider not doing it at all.** Measure a version with one small, well-organised stylesheet
      and no critical-CSS machinery. If FCP is already under 1s, the honest engineering answer may be
      "delete the complexity". Record the numbers that would justify each choice.

<details>
<summary>Hint — why media="print" works</summary>

A stylesheet whose `media` query doesn't match the current medium is not render-blocking — the
browser still downloads it (at a lower priority) but doesn't wait for it. Once it loads, the `onload`
handler flips `media` to `all`, at which point it applies. The cost: a style recalc and repaint when
it lands, and a possible flash if the stylesheet changes above-the-fold layout. That's why the
critical CSS has to be right.
</details>

<details>
<summary>Hint — the font/CLS trade</summary>

`font-display: swap` renders fallback text immediately, then swaps. If the fallback's metrics differ
from the web font, the swap reflows text — a layout shift. Fix it with `size-adjust`,
`ascent-override`, `descent-override` on a `@font-face` for the fallback, so both fonts occupy the
same space. Chrome DevTools' Fonts pane and the "fontaine"/"capsize" tooling help compute the values.
</details>

---

## 🏗️ Build challenge: a critical-CSS build step you'd actually trust

Most critical-CSS tooling breaks quietly. Build one that doesn't, then prove it.

**The tool:**
1. Renders a page (or a list of routes) in Playwright at 3 viewports (360, 768, 1440).
2. Collects used CSS rules via the CDP `CSS.startRuleUsageTracking` API.
3. Additionally captures rules for interactive states by scripting hovers/focuses on interactive
   elements — the step every naive implementation skips.
4. Emits per-route critical CSS, deduplicated, with a shared base extracted if it exceeds a size
   threshold.
5. Rewrites the HTML: inlines critical, async-loads the remainder, adds the `<noscript>` fallback.
6. **Verifies itself**: re-renders the transformed page with the async CSS artificially delayed by
   5 seconds, screenshots the first paint, and diffs it against the fully-styled render. Fails the
   build if the above-the-fold diff exceeds a threshold. This is the step that makes it trustworthy —
   without it you're shipping a FOUC generator.
7. Reports: FCP before/after, critical size, unused-CSS percentage, and the diff score.

**Then run it against a real site** — your portfolio, a docs site, an open-source app. Report the
before/after Lighthouse numbers and the failure you found (there will be one; there always is).

**Done when:** the self-verification step catches a deliberately broken extraction, and the tool
improves FCP on a real site by a number you can point at.

---

## Interview questions

1. Is CSS parser-blocking or render-blocking? What's the difference and why does it exist?
2. How can a slow stylesheet delay your JavaScript?
3. Why is `@import` in CSS a performance problem?
4. Explain the `media="print"` async-CSS trick and its cost.
5. What is critical CSS, why 14KB, and what breaks in practice?
6. `font-display: swap` improves FCP. What does it cost you, and how do you mitigate it?
7. When would you *not* implement critical CSS?
