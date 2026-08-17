# Lab 03 — Long tasks & yielding (INP) ⭐⭐⭐⭐⭐

**Goal:** take a working feature with a 1-second INP and get it under 200ms without changing
what the user sees — and be able to say which of the three INP phases each change fixed.

**Primary metric:** INP (worst interaction), broken into input delay / processing / presentation.

> Open <http://localhost:8080/event-loop/labs/03-long-tasks-and-yielding/>

---

## The concept

INP is not "how long your handler took". It's three intervals, and they have three different
fixes:

```
  ┌─ input delay ──┬─ processing ──┬─ presentation ─┐
user presses    your handler    handler ends      next paint
  a key         starts running                    showing the result
```

| Phase | What it means | What fixes it |
|---|---|---|
| **Input delay** | The main thread was busy with *something else* when the event arrived. | Delete or slice up the other work: timers, polling, hydration, third-party scripts. Your handler is innocent. |
| **Processing** | Your handler ran long. | Yield inside it, chunk it, move it to a worker, or do less. |
| **Presentation** | Handler finished, but style/layout/paint of the result took ages. | Smaller DOM update, `content-visibility`, virtualization, fewer synchronous layouts. |

You cannot fix a phase you haven't measured. This lab shows all three separately, live.

`PerformanceObserver` with `type: 'event'` gives you the raw numbers — and `interactionId` is
how you tell a real user interaction from a synthetic or non-interactive event:

```js
new PerformanceObserver(list => {
  for (const e of list.getEntries()) {
    if (!e.interactionId) continue;
    const delay = e.processingStart - e.startTime;
    const proc  = e.processingEnd - e.processingStart;
    const paint = e.startTime + e.duration - e.processingEnd;
  }
}).observe({ type: 'event', durationThreshold: 16, buffered: true });
```

## Break it

1. Mode **A. naive**, 40,000 rows. Type `alpha` quickly. Watch the cards.
2. Note the split: processing should dominate.
3. Now tick **background pressure** and click the **counter** button repeatedly *without typing*.
   The counter handler does nothing but increment a number — and its INP is terrible. That's
   input delay, and no amount of optimising the click handler will touch it.
4. Turn pressure off, set rows to 200,000, and type again. Presentation delay grows too (the
   list re-renders 200 nodes plus `<mark>` elements per keystroke).

| Scenario | INP | input delay | processing | presentation |
|---|---|---|---|---|
| A naive, 40k, typing | | | | |
| A naive + background pressure, clicking counter only | | | | |
| A naive, 200k, typing | | | | |
| B debounced | | | | |
| C chunked + yield | | | | |
| D paint first | | | | |
| Target | **< 200** | < 50 | < 50 | < 100 |

Do all of these at **4× CPU throttle**. INP measured on an unthrottled M-series Mac is a number
about a computer none of your users own.

## Measure it

1. Performance panel → record → type five characters → stop.
2. The **Interactions** track shows one bar per keystroke. Long ones are flagged.
3. Click a bar: DevTools shows you the three phases in the summary. Cross-check them against
   the cards on the page — you should get the same numbers, and if you don't, work out why
   (hint: `durationThreshold`, and the fact that INP is a percentile, not a max).
4. In the Main track, find the task that overlaps the *start* of a slow interaction. If that
   task isn't yours, you have an input-delay problem, not a handler problem.

## Fix it yourself

Three fixes, deliberately in increasing order of honesty.

- [ ] **`debounced()`** — 150ms trailing debounce. Measure how much INP actually improves.
      (Less than you think. Say why in one sentence.)
- [ ] **`chunked()`** — slice `filterAll` into ~5ms chunks that yield; a new keystroke aborts
      the in-flight run. Same results as naive, no task over ~10ms.
- [ ] **`paintFirst()`** — paint the cheap feedback, then do the work after the browser has
      shown it.

Constraints: identical visible results, no dropped keystrokes, and typing 10 characters fast
must not run 10 full scans to completion.

<details>
<summary>Hint 1 — why debouncing barely moves INP</summary>

Debouncing reduces how *often* the long task runs. INP reports the *worst* interaction. The
keystroke that finally triggers the scan still costs 400ms, and it is still an interaction. You
went from 10 bad interactions to 1 bad interaction, and INP is roughly unchanged.

Debouncing is still worth doing — it cuts total CPU and battery — but if a PM asks you to fix
INP and you ship a debounce, you'll be back next sprint.
</details>

<details>
<summary>Hint 2 — the chunked shape with cancellation</summary>

```js
let runToken = 0;

async function chunked(q) {
  const myToken = ++runToken;                       // newer keystroke invalidates older run
  const needle = q.toLowerCase().normalize('NFC');
  const hits = [];
  let chunkStart = performance.now();

  for (let i = 0; i < items.length; i++) {
    const s = score(items[i], needle);
    if (s >= 0) hits.push({ item: items[i], s });

    if ((i & 255) === 0 && performance.now() - chunkStart > 5) {
      await yieldToBrowser();
      if (myToken !== runToken) return;             // abandoned
      chunkStart = performance.now();
    }
  }
  hits.sort((a, b) => b.s - a.s);
  renderList(hits, q);
}
```

Two details that matter: the `(i & 255) === 0` guard keeps `performance.now()` out of the hot
path (calling it 200,000 times is itself measurable), and the token check happens *after* the
await, because that's the only place state can have changed.
</details>

<details>
<summary>Hint 3 — a yield that lets a paint through</summary>

```js
const yieldToBrowser = globalThis.scheduler?.yield
  ? () => scheduler.yield()
  : () => new Promise(r => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => { ch.port1.close(); r(); };
      ch.port2.postMessage(null);
    });
```

`scheduler.yield()` is better than `postTask`/`MessageChannel` for this: your continuation goes
to the *front* of the queue at your original priority, so a yielding loop doesn't get starved by
unrelated tasks that were queued while you worked.
</details>

<details>
<summary>Hint 4 — paint first</summary>

```js
async function paintFirst(q) {
  showPending(q);                     // cheap, meaningful feedback
  await afterPaint();                 // rAF → rAF: resolves after the browser has painted it
  await chunked(q);                   // now do the expensive part
}
```

`afterPaint` is double-rAF (the second rAF runs after the frame containing the first has been
committed). A single rAF resolves *before* paint, so the expensive work still lands in the same
frame and you've fixed nothing.
</details>

---

## 🏗️ Build challenge: an INP field harness

Lab metrics are lab metrics. Build the thing you'd actually ship, in `inp-harness.js`:

```js
initINP({
  onInteraction(entry) { /* every interaction over threshold */ },
  onReport(inp) { /* p98-ish INP for the page visit, on visibility change */ },
});
```

Requirements:

1. Group `event` entries by `interactionId` — a single click produces `pointerdown`, `pointerup`
   and `click` entries, and the interaction's latency is the **max** of the group, not the sum.
2. Report the **p98** of interaction latencies (that's what INP is), not the max — with a
   fallback to max when there are fewer than 50 interactions.
3. Attribute each slow interaction: the target element's selector, the phase that dominated, and
   (bonus) the longest `longtask` overlapping its input delay window.
4. Flush the report on `visibilitychange → hidden` using `navigator.sendBeacon`, because
   `unload` doesn't fire reliably on mobile.
5. Cost under 1ms per interaction. Verify by profiling with the harness on and off.

Then use it on a real site of yours and find one interaction over 200ms. Write down the phase
split and the fix. That's the whole exercise — the harness is a means to that sentence.

**Done when:** your harness's number matches Chrome's own INP (DevTools → Performance panel, or
the web-vitals library) within 10% on the same session.

---

## Interview questions

1. INP is 600ms. Your click handler measures 20ms with `console.time`. Where is the other 580ms,
   and how do you find out — in one step?
2. Why does adding a debounce often fail to improve INP?
3. What's the difference between yielding with `setTimeout(0)`, `scheduler.postTask()` and
   `scheduler.yield()` in terms of *what runs next*?
4. When is "paint first, work after" a genuine fix, and when is it INP score-gaming?
5. Your page's INP is fine in the lab and terrible in field data (CrUX). Give three reasons.
