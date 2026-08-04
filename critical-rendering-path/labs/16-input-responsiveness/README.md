# Lab 16 — Input responsiveness (INP) ⭐⭐⭐⭐⭐

**Goal:** understand the three parts of an interaction's latency, and learn the one reordering trick
that fixes most of them.

**Primary metric:** INP — the interaction-to-next-paint duration, in milliseconds.

---

## The concept

INP replaced FID as a Core Web Vital. It measures the **whole** interaction, from the user's input to
the frame that shows the result, and it reports roughly the worst interaction of the page visit
(technically ~p98 across interactions, with a high-interaction allowance). Good < 200ms, poor > 500ms.

It decomposes into three parts, and they have completely different fixes:

```
    ↓ user clicks                                          ↓ next frame presented
    ├───────────────┼──────────────────────┼───────────────┤
      input delay      processing time        presentation delay
      (waiting for     (your handlers,        (style, layout, paint
       the main         all of them)           for what you changed)
       thread)
```

| Part | Cause | Fix |
|---|---|---|
| **Input delay** | the main thread was already busy when the input arrived — a timer, a poll, hydration, an analytics beacon | break up *other* work; nothing about your handler will help |
| **Processing** | your `click`/`input` handlers, plus every other listener on the propagation path | yield, chunk, offload; or do less |
| **Presentation** | the DOM change you committed is expensive to style/lay out/paint | commit less — virtualize, contain, reduce the invalidated subtree |

Two things follow that surprise people:

1. **A fast handler can still produce a terrible INP.** If you commit 5,000 rows, your handler
   returns in 3ms and the frame takes 400ms. That's presentation delay, and no amount of
   `scheduler.yield()` inside the handler will touch it.
2. **A slow handler with a good total blocking time can feel worse than a slow one.** Debouncing a
   search by 500ms makes your TBT beautiful and the app feel broken, because the user's *perceived*
   latency includes the wait you added. Lab metrics and felt experience diverge here, and knowing
   where they diverge is the point of this lab.

The single most valuable pattern in this lab:

> **Paint the feedback, then do the work.** Update the DOM so the user sees a response, let the
> browser paint that frame, and only then run the expensive part. The interaction ends at the paint,
> so this reduces INP even though the total work is unchanged.

## Break it

`index.html` has four interactions, each broken in a different one of the three parts:

1. **`slowHandler`** — a button whose click handler does 300ms of synchronous work before updating
   the DOM. Pure processing time.
2. **`busyThread`** — a fast handler, but a background `setInterval` occupies the main thread in
   200ms chunks. Pure input delay.
3. **`bigCommit`** — a 2ms handler that appends 5,000 rows. Pure presentation delay.
4. **`debouncedSearch`** — a search input debounced by 500ms. Excellent TBT, awful feel.

Each one reports its own input delay / processing / presentation split, so you can see which part you
are actually paying for.

## Measure it

1. CPU 4× throttle. The page's own INP tracker uses the real API — the same one the `web-vitals`
   library uses:
   ```js
   new PerformanceObserver(list => {
     for (const e of list.getEntries()) {
       if (!e.interactionId) continue;            // not an interaction (e.g. a plain scroll event)
       const inputDelay   = e.processingStart - e.startTime;
       const processing   = e.processingEnd - e.processingStart;
       const presentation = e.startTime + e.duration - e.processingEnd;
     }
   }).observe({ type: 'event', durationThreshold: 0, buffered: true });
   ```
   Note `interactionId` — several events (`pointerdown`, `pointerup`, `click`) share one, and the
   interaction's duration is the max across that group. The page does that grouping for you.
2. **Performance panel → Interactions track.** Record, click, and look at the interaction bar.
   Hovering it gives you the same three-part breakdown, and it links to the handler.
3. **Long tasks** — for interaction 2, note that the *cause* of the input delay isn't in the
   interaction at all. This is why "my handler is fast" isn't an answer.
4. Compare against **TBT** (the page reports it). Interaction 4 will have a great TBT and a bad feel.
   Write down what that tells you about optimising for a metric.

| Interaction | INP | Input delay | Processing | Presentation | Dominant part |
|---|---|---|---|---|---|
| 1 slow handler | | | | | |
| 2 busy thread | | | | | |
| 3 big commit | | | | | |
| 4 debounced search | | | | | |
| — after your fixes — | | | | | |

Targets: INP < 200ms for all four, and < 100ms for 1 and 3.

## Why is it slow?

Answer per interaction, and be specific about *which* of the three parts:

1. For interaction 2, why does yielding inside the click handler not help at all?
2. For interaction 3, the handler takes 2ms. Where do the other 400ms go, and which DevTools entries
   would prove it?
3. For interaction 4, the handler is fast and the commit is small. So why does it feel bad, and why
   does INP partially *hide* the problem? (Careful — think about when the interaction's timer starts
   relative to your debounce.)
4. In interaction 1, you `await scheduler.yield()` halfway through. Does INP improve? Does the *user*
   experience improve? Are those the same question?

## Fix it yourself

Implement each in `app.js`, measuring after every step.

- [ ] **`fixSlowHandler()` — feedback-first ordering.** Update the DOM to show a response (spinner,
      disabled state, optimistic value), then yield so the browser paints, then do the 300ms of work.
      Measure INP before and after. The total work is identical; explain why the number moved.
      ```js
      const yieldToPaint = () =>
        new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
      ```
      Then compare that against `scheduler.yield()` and against `setTimeout(fn, 0)` alone, and
      explain the difference. Only one of the three reliably waits for a *paint*.
- [ ] **`fixSlowHandler()` part two — chunk the work.** Slice the 300ms into 5ms pieces with a yield
      between them. Measure INP *and* total wall-clock time to completion. You'll trade one for the
      other; decide which matters here and justify it.
- [ ] **`fixBusyThread()`** — fix the *background* work, not the handler. Chunk the interval's work
      with yields, or move it to a worker. Then answer: which of those two keeps input latency lowest,
      and why isn't it always the worker?
- [ ] **`fixBigCommit()`** — reduce what you commit. Render 30 visible rows, not 5,000 (reuse Lab 05).
      Then, separately, try keeping all 5,000 but adding `content-visibility: auto` and measure. Which
      approach wins, and by how much?
- [ ] **`fixDebouncedSearch()`** — make it feel instant without doing 5,000 rows of work per
      keystroke. The input's own value must update on every keystroke with zero delay; the results may
      lag. Implement it twice — once with a rAF-coalesced render of a *capped* result set, once with
      the work in a worker — and compare felt latency, not just the metric.
- [ ] **`isInputPending()` experiment.** Rewrite one chunked loop to use
      `navigator.scheduling?.isInputPending()` to yield only when input is actually waiting. Measure
      against fixed-size chunking. Then find its failure mode (hint: it tells you about *pending*
      input, not about rendering — what starves?).
- [ ] **Audit the propagation path.** Add three `document`-level listeners that each take 20ms.
      Measure the INP of interaction 1 now. Nothing about your button changed. Write down the lesson
      about third-party scripts and analytics.

<details>
<summary>Hint — the three yields are not equivalent</summary>

| | Yields to | Waits for a paint? | Continuation priority |
|---|---|---|---|
| `setTimeout(fn, 0)` | the task queue | no | behind other tasks; ~4ms clamp when nested |
| `scheduler.yield()` | the scheduler | no | ahead of other same-priority work, but input still gets through |
| `rAF` + `setTimeout(0)` | after the next frame | **yes** | after paint |

For *feedback-first ordering* you need the third one — you specifically want the paint to happen
before the heavy work starts. For *chunking a long loop* you want `scheduler.yield()`, because you
want to finish soon while staying interruptible. Using the wrong one is the most common mistake here.
</details>

<details>
<summary>Hint — why interaction 4 partially hides its own problem</summary>

The interaction's `duration` is measured from the input event to the next paint after its handlers.
A debounce means your expensive work happens in a *later* task, unattached to that interaction — so
the event-timing entry looks small. The user, meanwhile, waited 500ms plus the work. INP is a good
metric, not a perfect one; when it disagrees with a stopwatch and your own eyes, trust the stopwatch.
</details>

---

## 🏗️ Build challenge: an interaction budget you can enforce

Build the harness that keeps INP from regressing, then use it on real code.

**Part 1 — the runtime monitor.** A small module for any app:
1. Tracks every interaction via the `event` timing entries, grouped by `interactionId`.
2. Reports the three-part breakdown, plus the `target` element (use a `WeakRef` — see Lab 10's trap)
   and the event type.
3. Computes INP the way the spec does: the ~p98 interaction, with the high-interaction allowance
   (one excluded per 50 interactions). Compare your number against the `web-vitals` library's on the
   same session and reconcile any difference — that reconciliation teaches you the metric properly.
4. When an interaction exceeds a threshold, capture attribution: the long tasks that overlapped its
   input delay, and the largest script in its processing window.
5. Costs under 0.1ms per interaction. Prove it.

**Part 2 — the CI gate.** With Playwright:
1. Scripted interactions over your app: type, click, open, scroll, submit.
2. Run each 20× at 4× CPU throttle and report p75 and max per interaction.
3. Fail on regression against a committed baseline, printing which part of the three regressed. "INP
   went up 80ms, all of it presentation delay" is an actionable failure; "INP got worse" is not.

**Part 3 — the finding.** Run the monitor on a real app — yours, or any large site — while you use it
normally for five minutes. Report the worst three interactions with their breakdowns, and fix one.
Most apps have at least one interaction dominated by presentation delay that everyone had assumed was
"slow JavaScript", and finding one of those is the point.

**Done when:** your INP matches `web-vitals`'s on the same session, the CI gate fails a deliberate
regression and names the right part of the three, and you've fixed one real interaction with a
before/after breakdown.

---

## Interview questions

1. What are the three components of INP, and what fixes each?
2. My click handler runs in 4ms and INP is 380ms. What's happening?
3. Why does yielding inside a handler not help with input delay?
4. `setTimeout(0)` vs `scheduler.yield()` vs rAF+timeout — when do you use each?
5. Explain "paint the feedback, then do the work" and why it lowers INP without reducing work.
6. Debouncing improved our TBT. Is the app faster?
7. How is INP different from FID, and why did the change matter?
8. Our INP regressed after adding an analytics script we don't control. What can you actually do?
