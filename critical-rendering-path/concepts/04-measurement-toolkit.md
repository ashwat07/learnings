# 04 — Measurement toolkit

The point of every lab is the number. Here's how to get honest ones.

## Ground rules

1. **Incognito window, no extensions.** React DevTools, ad blockers, and password managers all
   inject work into your trace.
2. **Throttle the CPU.** Performance panel → gear → CPU → 4× (mid-range laptop) or 6×
   (mid-range phone). Your M-series Mac hides jank that your users will feel.
3. **Same throttle before and after.** Always.
4. **Record 3–5 seconds, not 30.** Long traces are hard to read and DevTools starts dropping
   detail.
5. **Warm up first.** The first run includes JIT warm-up, font loading, and lazy layer creation.
   Run the interaction once, then record.
6. **Compare one change at a time.** If you batch reads *and* switch to `transform` *and* add
   virtualization, you've learned nothing about which one mattered.

## DevTools panels, by question

| Question | Panel | What to look at |
|---|---|---|
| Where is the time going? | Performance | Summary donut; Bottom-Up grouped by activity |
| Which frames dropped? | Performance | Frames track — hover a frame for its duration |
| Am I forcing layout? | Performance | Red-triangle warnings, "Forced reflow" / "Layout" entries nested under a JS call |
| What's repainting? | Rendering → **Paint flashing** | green flashes = repainted region |
| Am I at 60fps? | Rendering → **Frame rendering stats** | live FPS + GPU memory |
| Which layers exist and why? | Layers panel, Rendering → Layer borders | compositing reasons, memory per layer |
| Is my animation composited? | Animations panel; Performance trace | non-composited animations get flagged |
| What's leaking? | Memory → Heap snapshot / Allocation instrumentation | Detached elements, retainer chains |
| Why is it slow to load? | Network + Performance → Timings | request waterfall, FCP/LCP markers |
| Is my selector slow? | Performance → Recalculate Style, "Selector Stats" | enable in Performance settings |

### Reading a Performance trace, fast

1. Frames track — any red/yellow frames? Note the worst duration.
2. Main track — find the longest task (grey "Task" bar with a red corner if >50ms).
3. Expand it. What's *inside*? Yellow JS calling purple Layout repeatedly = thrashing.
4. Bottom-Up tab, "Group by activity" — get totals for Recalculate Style, Layout, Paint.
5. Right-click the suspicious entry → it links to the exact source line.

## In-page instrumentation

Every lab's `index.html` loads `/shared/perf-hud.js`, which gives you a live overlay: FPS, worst
frame, long-task count, and forced-reflow count. Use it for quick iteration; use the Performance
panel for the real answer.

### Long tasks

```js
new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    console.warn(`long task ${entry.duration.toFixed(1)}ms`, entry.attribution?.[0]?.name);
  }
}).observe({ type: 'longtask', buffered: true });
```

### Layout shifts

```js
new PerformanceObserver(list => {
  for (const e of list.getEntries()) {
    if (!e.hadRecentInput) console.log('CLS +', e.value.toFixed(4), e.sources);
  }
}).observe({ type: 'layout-shift', buffered: true });
```

### LCP / FCP / paint timings

```js
new PerformanceObserver(list => {
  for (const e of list.getEntries()) console.log(e.name, e.startTime.toFixed(0), e.element);
}).observe({ type: 'largest-contentful-paint', buffered: true });

performance.getEntriesByType('paint').forEach(e => console.log(e.name, e.startTime.toFixed(0)));
// first-paint, first-contentful-paint
```

### Frame timing, honestly

```js
let last = performance.now(), worst = 0, frames = 0;
(function tick(now) {
  const dt = now - last; last = now;
  if (frames++ > 5) worst = Math.max(worst, dt);   // skip warm-up frames
  requestAnimationFrame(tick);
})(performance.now());
```

`worst` is more useful than average FPS. Average FPS hides a 300ms hitch; users don't.

### Measuring a specific operation

```js
performance.mark('render:start');
renderRows(100_000);
performance.mark('render:end');
performance.measure('render', 'render:start', 'render:end');
console.log(performance.getEntriesByName('render')[0].duration.toFixed(1), 'ms');
```

Marks and measures show up in the Performance panel's Timings track, which is how you correlate
your own code with Layout/Paint entries. Note: `renderRows` returning doesn't mean the browser
has *rendered* — style/layout/paint happen after your task yields. To measure through to the
next frame:

```js
performance.mark('a');
renderRows(100_000);
requestAnimationFrame(() => requestAnimationFrame(() => {
  performance.mark('b');
  performance.measure('render-to-paint', 'a', 'b');
}));
```

This double-rAF trick matters in Lab 05, where the JS is fast and the layout is not.

### Forced-reflow detection

There's no API for "did that read force layout". What you can do is count suspicious reads by
patching the getters in a debug build — that's exactly what Lab 14 has you build.

## Field metrics vs lab metrics

| Metric | Means | Good |
|---|---|---|
| FCP | first pixel of content | < 1.8s |
| LCP | largest element painted | < 2.5s |
| CLS | unexpected layout shift | < 0.1 |
| INP | interaction → next paint, worst-ish case | < 200ms |
| TBT | total blocking time (lab proxy for INP) | < 200ms |

The labs mostly target frame time and long tasks, because those are what the rendering pipeline
controls. But when you fix Lab 05 or 11, check LCP — that's the number a product manager cares
about.

## The trap

The most common self-deception: measuring on an unthrottled desktop, in a page with nothing else
happening, once. Real pages have a busy main thread already. If your fix only works when nothing
else is running, it isn't a fix.
