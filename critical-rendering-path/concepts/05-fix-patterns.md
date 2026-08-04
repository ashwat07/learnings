# 05 — The fix toolbox

Every lab's solution is one or more of these. Learn them as named patterns so you can reach for
them by name in a code review.

## 1. Batch reads and writes (avoid forced layout)

```js
// Bad: read/write interleaved → N layouts
els.forEach(el => { el.style.height = el.offsetWidth + 'px'; });

// Good: one layout
const widths = els.map(el => el.offsetWidth);        // all reads
els.forEach((el, i) => el.style.height = widths[i] + 'px');  // all writes
```

Formalised, this is **FastDOM**: a queue with a measure phase and a mutate phase, flushed on
`requestAnimationFrame`. Lab 01's build challenge is writing one.

## 2. Do visual work in `requestAnimationFrame`

Move DOM writes into rAF so they land once per frame, right before the browser's own
style/layout pass.

```js
let queued = false, latestScrollY = 0;
addEventListener('scroll', () => {
  latestScrollY = window.scrollY;               // cheap read, once
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; paint(latestScrollY); });
}, { passive: true });
```

Note the shape: coalesce many events into one frame's work, and never do more work than one
frame can use. `{ passive: true }` lets the compositor scroll without asking the main thread.

## 3. Throttle vs debounce vs rAF

| Pattern | Fires | Use for |
|---|---|---|
| debounce | once, T ms after the last event | search input, resize *end*, autosave |
| throttle | at most once per T ms | analytics, expensive network calls |
| rAF-coalesce | once per frame | anything that writes to the DOM |

For visual updates, rAF-coalesce is almost always the right one. Debouncing an animation makes it
lag; throttling it to 100ms makes it choppy.

## 4. Animate `transform` / `opacity` only

```css
/* Bad */ .drawer { transition: left .3s; }
/* Good */ .drawer { transition: transform .3s; will-change: transform; }
```

If you need a layout-ish effect, look for a transform equivalent: `scaleY` instead of `height`,
`translate` instead of `top`, `opacity` instead of `visibility` + `display`. For genuinely
layout-changing transitions, consider the FLIP technique: measure First and Last positions,
Invert with a transform, then Play the transform back to identity — one layout, then composited
animation.

## 5. Virtualize / windowize long lists

Render only what's near the viewport, plus an overscan buffer. Keep the scrollbar honest with a
spacer of the right total height.

Cheaper approximations, in increasing order of effort:
1. `content-visibility: auto` + `contain-intrinsic-size` — the browser skips layout & paint for
   off-screen subtrees. One CSS line, huge win, no JS. Do this first.
2. Pagination / "load more".
3. Real virtualization with absolute positioning and an item recycler.

## 6. Containment

```css
.card       { contain: content; }             /* layout + paint + style containment */
.long-list  { content-visibility: auto; contain-intrinsic-size: auto 64px; }
```

`contain` is a promise to the browser that a subtree's layout/paint can't affect anything
outside. It lets the engine treat the subtree as an independent layout root, so dirtying a card
doesn't reflow the page. Nearly free to add, and it makes Lab 05's numbers move a lot.

## 7. Reduce paint area and per-pixel cost

- Invalidate less: change the small element, not its full-viewport ancestor.
- Replace `box-shadow` on many elements with a single pre-rendered shadow image, or a cheaper
  shadow (smaller blur radius).
- Avoid `filter: blur()` / `backdrop-filter` on large or numerous elements; if you must, promote
  to its own layer so its raster is cached and only composited afterwards.
- Fade with `opacity` instead of recolouring `background`.

## 8. Reduce work at the source

- Do less DOM: fewer nodes, flatter trees, no wrapper-div soup.
- Move computation off the main thread: Web Worker for parsing/sorting/diffing.
- Chunk long tasks: `await scheduler.yield()` (where available) or
  `await new Promise(r => setTimeout(r, 0))` between chunks so input can be handled.
- Cache derived values instead of recomputing per frame.

## 9. Framework-level: stop re-rendering

- Split state so a keystroke only re-renders the input's subtree.
- `React.memo` on list items + stable props (`useCallback`, `useMemo` for object/array props).
- Move state down, or lift the expensive subtree up as `children` so it doesn't re-render.
- `useDeferredValue` / `startTransition` for expensive derived UI.
- Keys that are stable and identity-preserving — index keys cause remounts.
- Measure with the React Profiler first; memoization has its own cost and "memo everything" is
  a real performance bug in its own right.

## 10. Load less, later

- `defer` on scripts (or `type="module"`, which defers by default); `async` only for
  independent scripts.
- Inline critical CSS; load the rest with `media` swap or `rel=preload`+`onload`.
- `loading="lazy"` + `decoding="async"` + `width`/`height` on images; `srcset`/`sizes`; AVIF/WebP.
- `fetchpriority="high"` on the LCP image, and never lazy-load it.
- Bundle to reasonable chunk counts; code-split by route, not by file.

## Choosing the fix

Ask what the *primary metric* is, and pick the pattern that targets that stage:

| Symptom | Look at | Likely pattern |
|---|---|---|
| Repeating Style→Layout comb inside one task | forced layout | 1, 2 |
| One long Layout entry | too many boxes | 5, 6, 8 |
| Big green Paint blocks | area or per-pixel cost | 7 |
| High GPU memory, many layers | over-promotion | concepts/03 |
| Slow first paint, fast interactions | network/blocking | 10 |
| Slow only after 10 minutes of use | leak | Labs 09/10 |
