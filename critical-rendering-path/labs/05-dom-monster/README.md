# Lab 05 — Create a DOM monster ⭐⭐⭐⭐⭐

**Goal:** learn what node count costs, where it costs it, and the four escalating ways to stop
paying.

**Primary metric:** time from "click render" to "pixels on screen" for 100,000 rows, plus scroll
FPS afterwards.

---

## The concept

Every DOM node costs memory, style recalculation, and layout. 100,000 rows is not a rendering
problem you can optimise with a faster loop — the JS that creates the nodes is often the *fast*
part. The expensive parts are:

- **Style** — 100,000 elements to match against your stylesheet.
- **Layout** — 100,000 boxes to position, with text to shape and wrap.
- **Memory** — nodes, computed styles, and layout objects, all retained.
- **Everything afterwards** — every future style change now has a bigger tree to walk.

The critical measurement trap: `performance.now()` around your render function measures only the
JS. The browser hasn't done style, layout, or paint yet when your function returns. You'll see
"80ms, that's fine!" and the page will still freeze for 3 seconds. Use the **double-`requestAnimationFrame`**
trick to measure through to paint — this lab exists partly to teach you that.

## Break it

`index.html` renders N rows in one synchronous pass, with a naive `innerHTML +=` variant available
because you should see how bad that specific mistake is.

Start at 10,000. Then 50,000. Then 100,000. Note where it stops being tolerable.

## Measure it

For each row count and each strategy, record:

| Metric | How |
|---|---|
| JS time | `performance.mark`/`measure` around the render call |
| Time to paint | double-rAF (the page does this for you — compare the two numbers!) |
| Recalculate Style total + elements affected | Bottom-Up |
| Layout total + nodes that needed layout | Bottom-Up; hover the Layout entry |
| Scroll FPS afterwards | HUD, scroll for 3s |
| DOM node count | `document.getElementsByTagName('*').length`, or DevTools → Performance monitor |
| JS heap | Performance monitor |

| Rows | Strategy | JS ms | To-paint ms | Scroll FPS | Heap |
|---|---|---|---|---|---|
| 10,000 | naive | | | | |
| 100,000 | naive | | | | |
| 100,000 | `content-visibility` | | | | |
| 100,000 | paginated | | | | |
| 100,000 | virtualized | | | | |

Open the **Performance monitor** (⌘⇧P → "Show Performance monitor") and watch DOM node count and
JS heap climb live as you render. Leave it open for the rest of this course.

## Why is it slow?

Answer these three separately, with evidence from the trace:

1. How much of the total is JS, style, layout, and paint? (Percentages.)
2. Does the cost scale linearly with row count, or worse? Measure 10k / 20k / 40k / 80k and plot
   it. If it's superlinear, find out why.
3. After the render, why is *scrolling* slow? Nothing is changing. What is the browser doing?

## Fix it yourself

Implement each, in order, and record the number after each. The ordering matters — it's cheapest
fix first, and you should know at which point you'd stop in a real project.

- [ ] **`fragment()`** — build in a `DocumentFragment`, append once. (Also implement the
      `innerHTML +=` disaster version so you can measure the difference. It's an order of
      magnitude, and you should know why: reparse + rebuild of the whole subtree, every iteration.)
- [ ] **`contentVisibility()`** — one CSS declaration:
      `content-visibility: auto; contain-intrinsic-size: auto 28px;`. Measure. This should be a
      shockingly large win for one line. Then find its downside: scrollbar jumpiness, and
      Cmd-F/find-in-page behaviour. Document both.
- [ ] **`paginated()`** — 200 rows per page. Trivially fast, and sometimes the right product
      answer. Note what it costs the user.
- [ ] **`virtualized()`** — real windowing: a spacer with the full scroll height, absolutely
      positioned rows, only the visible window plus overscan in the DOM. Do **not** use a library.
      Requirements:
      - fixed row height first, then variable height with measured offsets
      - recycle nodes instead of recreating them
      - correct scrollbar length
      - keyboard navigation and find-in-page must still work well enough to discuss
      - update on scroll via rAF-coalesced writes (Lab 02) with no forced reads (Lab 01)
- [ ] Then the honest comparison: at 100k rows, which of these actually holds 60fps while
      scrolling *and* keeps the page interactive during render? Which would you ship?

<details>
<summary>Hint — why innerHTML += is catastrophic</summary>

`el.innerHTML += '<div>…</div>'` serialises the entire existing subtree to a string, concatenates,
then destroys and reparses the whole thing. It's O(n²) in nodes, it discards event listeners and
element identity, and it re-runs style and layout on everything. `insertAdjacentHTML('beforeend',
html)` avoids the serialise-and-reparse; a `DocumentFragment` avoids the parse entirely.
</details>

<details>
<summary>Hint — measuring to paint</summary>

```js
const t0 = performance.now();
render(100_000);
requestAnimationFrame(() => requestAnimationFrame(() => {
  console.log('to paint:', (performance.now() - t0).toFixed(1), 'ms');
}));
```
The first rAF fires before the frame's style/layout/paint; the second fires after that frame was
presented. `PerfHUD.markToPaint()` wraps this.
</details>

<details>
<summary>Hint — virtualization maths</summary>

```
scrollTop → firstVisible = floor(scrollTop / rowHeight)
            visibleCount = ceil(viewportHeight / rowHeight)
            start = max(0, firstVisible - overscan)
            end   = min(total, firstVisible + visibleCount + overscan)
spacer height = total * rowHeight
row i offset  = i * rowHeight    → transform: translateY(...)
```
Use `transform`, not `top`, for the row offsets — you're inside Lab 03 now. And keep the recycled
node pool keyed by index so you can update text without touching structure.
</details>

---

## 🏗️ Build challenge: a 1,000,000-row data grid

Not 100,000 — a million. Build a spreadsheet-grade virtualized table.

**Features (all of them, they interact in ways that make this interesting):**

- 1,000,000 rows × 20 columns of synthetic data, generated in a Web Worker.
- Vertical **and** horizontal virtualization (columns too — 20 columns × visible rows only).
- Sticky header row and sticky first column.
- Click-to-sort on any column. Sorting a million rows must not freeze the UI — do it in the
  worker, and show progress.
- A filter input that filters as you type, with the filtering also in the worker, debounced, and
  with the results streamed back.
- Variable row heights (some rows have wrapped text) with a measurement cache and an offset index
  that supports jump-to-row.
- Row selection with shift-click ranges, preserved across scrolling and sorting.
- Keyboard navigation: arrows, page up/down, Home/End, and it must scroll the focused cell into
  view without a forced-layout storm.

**Constraints:**

- ≤ 300 DOM nodes at any time, at any scroll position. Assert it in a test.
- 60fps while scroll-dragging at 4× CPU throttle.
- No long tasks over 50ms after the first paint. Not during sort, not during filter, not during
  fast scroll. Chunk or offload anything that would exceed it.
- Initial paint under 500ms with data already available.
- No virtualization library. You may look at how TanStack Virtual or react-window solve a
  specific problem, but you write the code.

**The part most people skip:** write down the failure modes you hit. Blank rows during fast
scrolling (why? what's the fix — synchronous render on scroll, or an intentional placeholder?).
Scroll position drift with variable heights. Scrollbar thumb size jitter. Browser max element
height limits (~33.5M px in some engines — at 1M rows × 40px you're at 40M and you will hit it;
you'll need segmented spacers). Each of these is a genuinely interesting problem and a great
interview story.

**Done when:** you can scroll from row 1 to row 1,000,000 smoothly, sort by any column without
dropping a frame, and explain every one of the failure modes above from memory.

---

## Interview questions

1. Why is measuring `performance.now()` around your render function misleading?
2. What does `content-visibility: auto` skip, and what does `contain-intrinsic-size` do for it?
3. Why is `innerHTML +=` in a loop so much worse than `insertAdjacentHTML`?
4. How does virtualization keep the scrollbar honest with variable row heights?
5. A user reports "the table is slow" but your render is 40ms. What do you check?
6. What breaks about accessibility and find-in-page when you virtualize, and how would you
   mitigate it?
