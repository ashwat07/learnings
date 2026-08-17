# Lab 06 — The detection workflow ⭐⭐⭐⭐⭐⭐

**Goal:** find a leak you weren't told about, prove which line causes it, and build the detector
that would have caught it without you.

**Primary metric:** correctly classifying five unlabelled scenarios, then confirming each in a
heap snapshot.

> Open <http://localhost:8080/spa-memory-leaks/labs/06-detection-workflow/>
> (or `?isolate=1` for `measureUserAgentSpecificMemory()`)

---

## Part 1 — classify the five

Five scenarios, unlabelled. Four leak. Measure each, decide, *then* reveal.

| Scenario | nodes/cycle | listeners/cycle | heap/cycle | Your verdict |
|---|---|---|---|---|
| alpha | | | | |
| bravo | | | | |
| charlie | | | | |
| delta | | | | |
| echo | | | | |

## The slope, not the difference

```js
for (let i = 0; i < warmup; i++) await action();     // discard: lazy init, JIT, first-run caches
for (let i = 0; i < cycles; i++) { await action(); samples.push(measure()); }
const slope = leastSquaresSlope(samples);            // ~0 = fine, positive = leak
```

Two absolute measurements are noisy in both directions: the first cycles allocate things that
never repeat (false positive), and a GC may run at exactly the wrong moment (false negative). A
line fitted through twenty cycles is robust to both, and it gives you a *rate* — "300 nodes per
navigation" is actionable in a way "memory went up" isn't.

Also note which signal caught which scenario. **Node count and listener count are far cleaner
than heap size**, because `performance.memory` is coarse and GC timing is unpredictable. Use the
heap slope as corroboration, not as your primary detector.

## The full workflow, in order

**1. Cheapest signals first (10 seconds)**
- Performance monitor (⋮ → More tools): *DOM Nodes* and *JS heap size*, live, while you navigate.
- `getEventListeners(window)` in the console.

**2. The cycle test (2 minutes)**
- Navigate A→B→A twenty times; measure the slope. This tells you *whether* and *how fast*.

**3. Heap snapshots (10 minutes)** — this is what converts a suspect into a line of code.
- Snapshot → do the action N times → snapshot.
- Second snapshot → **Objects allocated between snapshot 1 and 2**.
- Sort by **Retained Size**. Filter by `Detached` for DOM leaks.
- Click an object → the **Retainers** pane shows the chain from a GC root. *That chain is the
  answer.* It names the variable, the closure, or the module holding it.
- Three-snapshot variant: snapshot → action → snapshot → action → snapshot, and look at what was
  allocated between 1 and 2 *and is still alive* at 3. This filters out anything that was merely
  awaiting collection.

**4. Allocation timeline** — Memory panel → *Allocation instrumentation on timeline*. Blue bars
are allocations; bars that stay blue were never freed. Click one for the **allocation stack** —
which tells you where it was created, complementing the retainer chain that tells you what holds
it. Together those two answer "who made this and who won't let go".

## Part 2 — build the detector

`detector.js` has `measureCycles`, `slopeOf` and a listener counter. Three TODOs:

**TODO 1 — `listenerReport()`.** Registration sites on `window`/`document`, sorted by count,
flagging any registered **without** an `AbortSignal`. That flag alone catches most listener leaks
before they grow.

There's a subtlety you must handle honestly: a listener removed via an abort **doesn't call
`removeEventListener`**, so a naive counter drifts. Hook the signal's `abort` event, or count
signalled registrations separately — and document the imprecision. Never ship a number you can't
explain.

**TODO 2 — `suspicionReport()`.** Components unmounted more than N ms ago whose
`FinalizationRegistry` callback hasn't fired. Write down why this is *evidence, not proof*:
callbacks are best-effort, the GC may not have run, and a false positive costs a developer an
hour. The report should state its confidence and what would confirm it.

**TODO 3 — `sampleMemory()`.**

```js
const result = await performance.measureUserAgentSpecificMemory();
// { bytes, breakdown: [{ bytes, attribution: [{url, scope}], types }] }
```

Real, cross-realm (workers and iframes included), and it requires **cross-origin isolation**. It
can take seconds because it waits for a GC — so never run it during an interaction, and rate-limit
it hard.

Then decide what you'd actually send to telemetry. **Memory against session length, bucketed by
route**, is the field signature of a leak. Raw bytes per user is noise.

## What to do with a confirmed leak

1. Write the **retainer chain** into the bug report. Without it the next person starts from zero.
2. Fix the reference, not the symptom (no `isMounted` flags, no manual `delete`s that paper over a
   missing cleanup).
3. Add a **cycle test** for that interaction so it can't come back.
4. Ask what class it belongs to (labs 01–05) and whether the same pattern exists elsewhere. Leaks
   travel in families — the same developer, the same copy-pasted effect, the same missing
   primitive.

## Think about

- Why does taking a heap snapshot sometimes make a "leak" disappear?
- The detector says "leak" and a snapshot shows nothing retained. What happened?
- What would you put in production telemetry to catch leaks you never reproduce locally?

<details>
<summary>Answers</summary>

**Snapshot makes it vanish.** Snapshotting forces a full GC. If memory returns to baseline, the
objects were garbage awaiting collection — high memory, not a leak. A real leak survives a GC by
definition.

**Detector says leak, snapshot says no.** Several possibilities, all worth checking: the growth is
in something the JS heap doesn't cover (detached-but-not-JS memory, GPU/canvas backing stores,
decoded images, wasm memory, storage); the slope came from `performance.memory` noise; the
"leaked" objects are held by DevTools itself while you're inspecting; or the growth is genuinely
outside the main heap — try `measureUserAgentSpecificMemory()`, which covers workers and iframes.

**Production telemetry.** Sampled `measureUserAgentSpecificMemory()` (or `performance.memory` as a
fallback) reported with: session duration, navigation count, route, and app version. Then look at
the *slope of memory against navigation count* per route, per release. That's how you find leaks
on the routes your users use and you don't — and it's the only way to catch the ones that need a
specific device, a specific extension, or forty minutes of use.
</details>

---

## 🏗️ The final build: a leak CI gate

Combine everything from this course into something that runs on every PR.

```sh
npx leak-check --url http://localhost:3000 --flows flows.json --budget nodes=2,heap=100kb
```

Requirements:

1. Playwright + CDP: force GC (`HeapProfiler.collectGarbage`), read `Performance.getMetrics` for
   node count and heap, run the cycle test per flow.
2. Flows defined declaratively (navigate A→B→A, open/close modal, filter a list 20×), with warmup
   and a slope-based assertion.
3. On failure: capture a heap snapshot, **parse it** (the `.heapsnapshot` format is JSON — nodes,
   edges, strings), and report the top retainer paths automatically. A failing test that says only
   "memory grew" gets muted within a week; one that says "300 detached HTMLDivElements retained by
   `routeCache` in `router.js`" gets fixed.
4. Trend reporting: store per-commit numbers so a slow creep across ten PRs is visible, because no
   single PR will ever trip a threshold.
5. Under 60 seconds for the whole suite, or it won't survive contact with a real CI budget.

**Done when:** it catches the four leaky scenarios on this page, passes on the clean one, produces
a retainer path automatically, and has found at least one real leak in an app you didn't write for
this exercise.

---

## Interview questions

1. Walk me through finding a memory leak in an SPA, from "users say it gets slow" to a line of
   code.
2. Why measure a slope over cycles rather than before/after?
3. What does the Retainers pane tell you, and what does the allocation stack add?
4. What's the three-snapshot technique and what does it filter out?
5. `measureUserAgentSpecificMemory()` — what does it give you that `performance.memory` doesn't,
   and what does it cost?
6. How would you stop a fixed leak from coming back?
