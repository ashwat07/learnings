# Lab 02 — Make scrolling horrible ⭐⭐⭐⭐⭐

**Goal:** understand what a high-frequency event does to your frame budget, and why scroll is the
most dangerous event on the platform.

**Primary metric:** dropped frames while scrolling + worst frame time.

---

## The concept

Scrolling is normally handled by the **compositor thread** — the main thread isn't involved at
all, which is why a page with a blocked main thread can still scroll. You lose that for free
scrolling when:

1. You attach a **non-passive** `wheel` / `touchstart` / `touchmove` listener. The compositor now
   has to ask the main thread "are you going to `preventDefault()`?" before it can scroll.
2. Your `scroll` handler does real work. `scroll` fires as often as the browser can dispatch it —
   potentially every frame, sometimes more — and the work lands on the main thread.
3. Your handler writes to the DOM *and* reads geometry, at which point you've combined Lab 01
   with a 60Hz trigger.

`scroll` is also **not cancelable** — it fires after the scroll has happened. So there is no
excuse for a non-passive scroll listener, and `{ passive: true }` on wheel/touch is nearly always
correct.

## Break it

```js
window.addEventListener('scroll', () => {
  items.forEach(item => { item.style.width = window.scrollY + 'px'; });
});
```

Everything wrong at once: 10,000 style writes, a `window.scrollY` read (layout-dependent),
`width` (a layout property), and no coalescing — per scroll event.

Open `index.html`, leave it on **broken**, and scroll. Watch the HUD's FPS.

## Measure it

1. CPU 4× throttle. Performance panel → record → scroll steadily for 3 seconds → stop.
2. **Frames track**: count red/partially-presented frames. Hover to get durations.
3. Main track: you'll see one task per scroll event. Note the duration of each and note that
   they're back-to-back with no idle gaps — that's what "the main thread is saturated" looks like.
4. Bottom-Up: Layout total, Recalculate Style total, Scripting total.
5. Rendering panel → **Frame rendering stats** → confirm FPS while scrolling.

| Metric | Broken | rAF | transform | +passive/IO | Target |
|---|---|---|---|---|---|
| FPS while scrolling | | | | | ≥ 55 |
| Worst frame | | | | | < 20ms |
| Layout entries / second | | | | | ~60 |
| Scripting total (3s) | | | | | |

## Why is it slow?

Name the stages, in order of cost, and be specific about *how many times per second* each runs.
Then answer: is the bottleneck the number of elements, the number of events, or the property
being animated? Design an experiment that isolates each one — the page has controls for exactly
that (item count, strategy). Do the experiment before you read the fix list.

## Fix it yourself

Implement each strategy in `app.js`. They're deliberately ordered so you can measure the
*marginal* gain of each — do not skip ahead, and record a number after each one.

- [ ] **`rafCoalesced()`** — still writes `width`, but at most once per frame. How much did that
      alone buy you? (Fewer than you'd think, and you should be able to say why.)
- [ ] **`transformOnly()`** — write `transform: translateX()` instead of `width`. Now the marginal
      gain should be large. Which stage disappeared from the trace?
- [ ] **`visibleOnly()`** — only update items currently in the viewport. Use
      `IntersectionObserver`, not `getBoundingClientRect()` in the handler. Why is that
      distinction the whole point of this step?
- [ ] **`cssOnly()`** — delete the JS entirely. Drive the effect from a scroll-linked CSS
      animation (`animation-timeline: scroll()`) with a fallback. Zero main-thread work per
      frame. Measure and compare against `visibleOnly`.

Also do these two, which are one line each and belong in every scroll-heavy page you ever write:

- [ ] Add `{ passive: true }` to the listener and prove with a trace that it changed something
      (hint: add a `wheel` listener first — a passive vs non-passive `wheel` handler is where this
      is visible).
- [ ] Put `content-visibility: auto` on the rows and re-measure. Explain what it skipped.

<details>
<summary>Hint — why rAF alone barely helps</summary>

Because `scroll` doesn't necessarily fire more than once per frame anyway. rAF-coalescing removes
duplicate work *within* a frame, but if you were already doing one pass per frame, the pass itself
(10,000 style writes → style recalc → layout → paint on the whole list) is the cost. rAF is
necessary but not sufficient; the property choice and the element count are the real levers.
</details>

<details>
<summary>Hint — IntersectionObserver vs getBoundingClientRect</summary>

`getBoundingClientRect()` in a scroll handler forces layout, per element, per event — you'd be
building Lab 01 to solve Lab 02. `IntersectionObserver` computes intersections off the main
thread and hands you the result in a callback, so "which items are visible" costs you nothing per
frame. Keep a `Set` of visible items, updated by the observer, and iterate that.
</details>

---

## 🏗️ Build challenge: a scroll-driven reading progress UI that never drops a frame

Build the thing every documentation site has, properly:

- A top progress bar showing scroll position through the article.
- A sticky table of contents that highlights the section currently in view.
- A "back to top" button that fades in past 50% scroll.
- A parallax hero image that moves at 0.5× scroll speed.
- A sticky header that hides on scroll-down and reveals on scroll-up (this one is subtle).

Content: at least 300 sections of real text, so the document is genuinely long.

**Hard constraints:**

1. **Zero geometry reads in any scroll handler.** No `getBoundingClientRect`, `offsetTop`,
   `scrollHeight` per event. Measure once on load and on `ResizeObserver`, cache, invalidate
   properly. Your Lab 01 dev-guard should stay silent while scrolling.
2. Every visual update is `transform` or `opacity`. The progress bar uses `scaleX`, not `width`.
3. At most one rAF callback per frame across all five features — one scheduler, not five
   listeners.
4. Section highlighting uses `IntersectionObserver` with a sensible `rootMargin`, not scroll math.
5. 60fps at 4× CPU throttle while scroll-dragging, and the page must still scroll smoothly if you
   block the main thread for 500ms mid-scroll (try it: `setTimeout(() => { const t = performance.now(); while (performance.now() - t < 500); }, 1000)`).

**Then do the hard version:** implement as much of it as you can with **no JavaScript at all** —
`animation-timeline: scroll()` for the progress bar and parallax, `position: sticky` for the
header, and a CSS-only reveal. Compare the two traces. Write down what you couldn't do in CSS and
why.

**Done when:** a 5-second scroll trace at 4× throttle shows no long tasks, ≥55fps, and the
Scripting slice of the Summary donut is under 10% of the recording.

---

## Interview questions

1. Why is `{ passive: true }` pointless on a `scroll` listener but important on `touchmove`?
2. A colleague throttles their scroll handler to 16ms with `setTimeout`. What's wrong with that
   versus `requestAnimationFrame`?
3. Your scroll handler is empty, and scrolling is still janky. Name three possible causes.
4. How would you implement "highlight the section in view" with zero per-frame main-thread work?
5. What does `content-visibility: auto` actually skip, and what's the catch with scrollbar
   position?
