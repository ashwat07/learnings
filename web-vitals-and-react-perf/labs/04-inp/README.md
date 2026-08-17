# Lab 04 — INP ⭐⭐⭐⭐⭐⭐

**Goal:** split an interaction into input delay / processing / presentation, and fix the phase that
actually dominates.

**Primary metric:** INP, and its phase breakdown.

> <http://localhost:8080/web-vitals-and-react-perf/labs/04-inp/>
> **Turn on 4× CPU throttling.** Untrottled desktop hides every one of these.

---

## The three phases

```
┌─ input delay ─┬── processing ──┬── presentation ──┐
│ thread busy   │ your handlers  │ style/layout/    │
│ when tapped   │                │ paint/composite  │
└───────────────┴────────────────┴──────────────────┘
                                        ↑ INP stops here (the next paint)
```

| Phase | Means | Fix |
|---|---|---|
| **input delay** | the thread was busy when the user touched the screen | break up long tasks, defer third-party scripts, hydrate less, `scheduler.yield()` |
| **processing** | your handlers ran long | do less, move compute to a worker, don't re-render a list per keystroke |
| **presentation** | style/layout/paint/composite after your handler | smaller DOM, `content-visibility`, avoid forced reflow |

**Diagnosis order: check input delay first.** If it's large, your handler is irrelevant — something
else owns the thread, and it's usually hydration or a third-party tag. This saves hours.

Run each of the three "make a phase dominate" buttons and fill in:

| button | total | input delay | processing | presentation |
|---|---|---|---|---|
| input delay | | | | |
| processing | | | | |
| presentation | | | | |

## The rule that matters most

**Paint something first, then do the work.** INP stops counting at the next paint after the
interaction:

```js
el.textContent = 'Saving…';                                    // visible response
await new Promise(r => requestAnimationFrame(() => setTimeout(r)));  // let it paint
await doTheExpensiveThing();                                   // outside the INP window
```

This isn't gaming the metric. The metric was built around the perceptual fact that a visible
acknowledgement within ~200ms is what makes an interface feel responsive; what happens after is a
separate problem with a separate budget.

The modern primitive is **`scheduler.yield()`** — it yields to the browser but keeps your
continuation at the *front* of the queue, unlike `setTimeout(0)` which puts you behind everything
that arrived meanwhile. See [event-loop lab 05](../../../event-loop/labs/03-long-tasks-and-yielding/).

## Framework notes

| Framework | The lever |
|---|---|
| React | `startTransition` marks an update interruptible — the urgent part (the input value) paints immediately; `useDeferredValue` is the same idea as a value. [Lab 05](../05-react-render-perf/) |
| Any | **a controlled input re-rendering a 500-row list on every keystroke** is the single most common INP bug in the ecosystem |

## Think about

- Your INP is 600ms but every handler profiles at under 10ms. Where's the time?
- Is `debounce` an INP fix?
- Why is INP the 98th percentile rather than the worst interaction?

<details>
<summary>Answers</summary>

**600ms with fast handlers.** Input delay or presentation. Either the thread was busy when the tap
landed (hydration, a third-party script, a timer doing bookkeeping) or your fast handler triggered
an expensive render — 5,000 nodes restyled, a forced synchronous layout, or a framework re-rendering
a whole tree. Profile the interaction in the Performance panel and look at what sits *around* the
handler, not inside it.

**Debounce.** Partly, and it's easy to get wrong. Debouncing the *expensive* work (the search
request, the filter over 5,000 rows) helps. Debouncing the *visible* response makes INP worse — the
input value must update on every keystroke or the field feels broken, and that update is what INP
measures. The correct split: render the keystroke synchronously, debounce/transition everything
downstream.

**98th percentile.** A visit can contain hundreds of interactions, and one unlucky one — a GC pause,
the browser doing something else — shouldn't define the page. Taking the worst would make the metric
mostly noise; taking the median would hide real problems. The rule ("discard roughly one interaction
per 50, take the worst of the rest") keeps it sensitive to genuine slowness while tolerating a
single outlier.
</details>

---

## 🏗️ Build challenge: fix your worst interaction

1. From RUM, find the route and `interactionTarget` with the worst p75 INP.
2. Reproduce it locally with 4× CPU throttling. Record the phase breakdown.
3. Apply the fix for the dominant phase, not the one you assumed.
4. Add the paint-first pattern to your app's slowest actions — a shared `respondThenWork()` helper
   beats each team re-inventing it.
5. Add a Playwright test that performs the interaction and asserts the `event` entry duration is
   under 200ms with CPU throttling enabled via CDP.

**Done when:** the phase breakdown for that interaction is under 200ms total at 4× throttle, and a
test holds it there.

---

## Interview questions

1. Define INP precisely, including what it stops at.
2. Name the three phases and a fix for each.
3. Which phase do you check first, and why?
4. Why does painting a "Saving…" state before doing the work improve INP?
5. `scheduler.yield()` vs `setTimeout(0)` — what's the difference?
6. When does debouncing make INP worse?
