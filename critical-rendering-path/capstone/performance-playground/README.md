# Capstone 20 — The performance playground ⭐⭐⭐⭐⭐

**Goal:** teach it back. You don't own a concept until you can demonstrate it to someone else, live,
with a measurement.

**Primary metric:** could a competent engineer who has never thought about the rendering pipeline
learn it from your playground without you in the room?

---

## The brief

Build a single app containing 15–20 self-contained demos. Each one has a **broken** mode and a
**fixed** mode, a live measurement, and a one-paragraph explanation. Toggling between modes must
visibly and measurably change something.

This is the artefact you put in a portfolio, link in a job application, and use as your own
reference two years from now when someone asks you why their table is slow.

## Structure

```
performance-playground/
├── index.html          shell: demo list, mode toggle, measurement panel
├── playground.js        registry, router, and the measurement harness  ← provided, extend it
├── demos/
│   ├── layout-thrashing.js     ← provided as the reference implementation
│   ├── scroll-jank.js
│   ├── wrong-property.js
│   └── … one per topic
└── README.md            your write-up
```

`playground.js` gives you the harness. `demos/layout-thrashing.js` is a complete worked example —
read it, then write the rest to the same interface.

### The demo interface

```js
export default {
  id: 'layout-thrashing',
  title: 'Layout thrashing',
  stage: 'Layout',                    // Style | Layout | Paint | Composite | JS | Network | Memory
  lab: 1,
  blurb: 'One paragraph. What breaks, why, and the fix — in plain language.',
  metric: 'Layout entries per interaction',
  setup(root) { /* build DOM, return nothing */ },
  run(root, mode) { /* mode is 'broken' | 'fixed' — do the work, return a measurement */ },
  teardown(root) { /* remove listeners, timers, observers. MUST be complete. */ },
};
```

`teardown` being complete is not a formality — you're building a playground full of memory-leak
demos, and if your own harness leaks, the demos lie. Verify with Lab 09's technique that switching
between all 20 demos 50 times leaves a flat heap. That self-check is one of the best parts of this
project.

## The demos

Minimum set, one per concept (the number is the lab it came from):

| # | Demo | Broken | Fixed | Live metric |
|---|---|---|---|---|
| 1 | Layout thrashing | read/write interleave | batched reads/writes | layouts per interaction |
| 2 | Scroll jank | per-event DOM writes | rAF + transform + IO | FPS while scrolling |
| 3 | Wrong property | animate `left` | animate `transform` | FPS under main-thread block |
| 4 | Paint area | recolour ancestor | recolour self / opacity | paint area (Paint flashing) |
| 5 | Paint cost | shadow + blur on 500 | pre-rendered / promoted | paint ms per second |
| 6 | DOM size | 100k rows | virtualized | time-to-paint |
| 7 | Containment | no containment | `content-visibility` | layout ms |
| 8 | Blocking JS | sync script | chunked / worker | FCP + longest task |
| 9 | Blocking CSS | 20 stylesheets | critical + async | FCP |
| 10 | Network waterfall | 50 requests | chunked + preload | time to all-executed |
| 11 | Images | full-size eager | srcset + lazy + modern | bytes + LCP + CLS |
| 12 | Layout shift | no dimensions | reserved space | CLS |
| 13 | Memory leak | interval closure | disposable teardown | heap after 60s |
| 14 | Listener leak | per-node retained | delegated | detached nodes |
| 15 | Composite layers | promote everything | promote on demand | layer count + GPU memory |
| 16 | Framework re-render | top-level state | split + memo + virtual | components per keystroke |
| 17 | Long tasks | one 500ms task | chunked with yields | INP / click-to-paint |
| 18 | Web font | `display: block` | `swap` + metric override | text-visible time + CLS |

Add your own for anything that bit you personally. Those are the ones you'll remember.

## Requirements

**Measurement, per demo:**
- A live number that visibly changes between modes. Not a claim — a number.
- The number must be honest: `markToPaint`-style measurement where paint is the cost, worst-frame
  rather than average FPS, and a CPU-throttle reminder in the UI.
- Broken/fixed toggling must be instant and repeatable, with no page reload, and the measurement must
  reset cleanly between runs.

**Teaching:**
- Each demo states which pipeline stage it's about, and the shell groups demos by stage.
- Each demo tells the reader **what to look for in DevTools** — which panel, which entry — not just
  its own number. Your playground should make people open the Performance panel, not replace it.
- A "predict first" prompt: before revealing the fixed-mode number, ask the visitor to guess. This
  single UI detail is what turns a demo into learning, and it's what most performance demos lack.

**Engineering:**
- The shell itself must never be the bottleneck. Profile your own playground and prove the harness
  costs less than 1ms per frame. A slow performance playground is an unfunny joke.
- Complete teardown, verified with a heap test over 50 demo switches.
- Works with no build step (ESM + `<script type="module">`), and deploys as static files.
- Keyboard navigable, respects `prefers-reduced-motion` (with a note that some demos must animate,
  and an explicit opt-in for those).
- Deep-linkable: `#/layout-thrashing?mode=broken` restores exactly that state.

## Done when

- [ ] 15+ demos, each with broken/fixed, a live metric, and a blurb.
- [ ] You've handed it to someone who doesn't do performance work and watched them use it without
      help. Write down where they got confused — that's your bug list, and it will be longer than
      you expect.
- [ ] Switching between all demos 50 times leaves a flat heap and zero detached nodes.
- [ ] Your own harness costs < 1ms per frame, proven with a trace.
- [ ] Deployed somewhere with a URL.
- [ ] A README that explains the pipeline in your own words, in under 500 words, with a diagram you
      drew yourself.

## Why this is the last exercise

Labs 01–18 and the dashboard taught you to recognise and fix. This one tests whether you can
*explain* — which is what
a senior engineer is actually paid for. The fix is an afternoon; convincing three teammates and a
designer that the fix matters, with evidence, is the job.

When you can point at a trace and say "that comb pattern is forced synchronous layout, here's the
line that causes it, here's the 40ms it costs us on a mid-range Android, and here's the six-line
fix" — you're done with this folder.
