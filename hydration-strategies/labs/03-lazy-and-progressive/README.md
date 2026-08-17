# Lab 03 — Lazy & progressive hydration ⭐⭐⭐⭐

**Goal:** choose *when* each component hydrates, and know exactly what each choice moves and where
it moves it to.

**Primary metric:** blocking ms on load **and** first-interaction latency. Both, always — optimising
one alone is how lazy hydration gets a bad reputation.

> Open <http://localhost:8080/hydration-strategies/labs/03-lazy-and-progressive/> at 4× CPU.

---

## The five whens

| Strategy | Blocking on load | First interaction | Use for |
|---|---|---|---|
| `load` | all of it | instant | above-the-fold, essential controls |
| `idle` | none (spread over idle time) | usually instant | secondary controls; **needs a `timeout`** |
| `visible` | only what's on screen | instant once visible | the best default for content pages |
| `interaction` | **zero** | pays the cost | rarely-used, expensive components |
| `media` | zero below the breakpoint | instant | mobile-only or desktop-only widgets |

Fill in your own numbers:

| strategy | blocking ms on load | hydrated on load | first interaction latency |
|---|---|---|---|
| load | | | |
| idle | | | |
| visible | | | |
| interaction | | | |
| interaction + replay | | | |

## The three details that decide whether this works

**1. `idle` has no SLA.** `requestIdleCallback` can be starved indefinitely on a busy page — a
component that never hydrates is a *correctness* bug, not a performance one. Always pass a
`timeout`, and understand that when the timeout fires you get `didTimeout: true` and zero remaining
time, so *you* decide whether to do the work anyway. (Event-loop course, lab 07.)

**2. `visible` needs a `rootMargin`.** Hydrating exactly at the viewport edge is too late — the
component is on screen and dead while it hydrates. `rootMargin: '200px'` gives you a head start.
Also: `IntersectionObserver` callbacks run **inside the rendering steps**, so hydrating 50
components in one callback is a long task inside a frame. Slice it.

**3. `interaction` must listen before `click`.** Hovering precedes clicking by 100–300ms;
`pointerdown` precedes `click` by ~80ms even on touch. Listening on `pointerover`/`focusin`/
`pointerdown` usually hides the entire hydration cost. This is the same intent-based idea as
speculative preconnect in the [resource-hints course](../../../resource-hints/labs/02-preconnect/).

## Event replay — the part that makes it honest

Without replay, the click that triggers hydration is swallowed. The user clicks again. That's how
you get double submissions.

```js
// capture phase, installed before any component code exists
el.addEventListener('click', function once(e) {
  el.removeEventListener('click', once, true);
  e.stopImmediatePropagation();     // suppress the original
  hydrate(el);
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));   // replay it
}, true);
```

Rules:

- Capture phase, so you see it before anything else.
- Stop the original propagation, then re-dispatch after hydrating.
- **Don't replay non-idempotent events.** A second `pointerdown` is harmless; a second `submit` is
  a duplicate order.
- Qwik, Angular (event replay) and Astro all do this with a global capture listener installed
  before any component code exists — that's the only place it can go.

## Choosing, in practice

```
Is it above the fold AND essential (nav, search, primary CTA)?   → load
Is it above the fold but secondary (cart badge, tooltip)?        → idle (with timeout)
Is it below the fold?                                            → visible, rootMargin 200px
Is it expensive AND rarely used (chart, map, editor)?            → interaction + replay
Is it only for one viewport?                                     → media
Does it not respond to input at all?                             → don't hydrate it
```

The last line is the one that gets skipped, and it's usually the biggest win — see Lab 02.

## Think about

- `interaction` has zero load cost. Why isn't it the default for everything?
- What does `idle` do on a page that's never idle?
- You hydrate on `visible` and users report the button "doesn't work the first time". What
  happened?

<details>
<summary>Answers</summary>

**Why not always `interaction`.** Because you moved the cost to the moment the user is watching. For
a 2ms component that's free; for one that dynamically imports 90KB over a slow connection, the user
clicks and waits — a much worse experience than a slightly slower load. Use it where the component
is expensive *and* rarely used, and always pair it with hover/pointerdown triggers so the cost lands
before the click.

**`idle` on a busy page.** It may never run. That's the whole hazard: the component stays dead
indefinitely with no error and no signal. The `timeout` option converts it to "at the latest, then",
and you should treat a timed-out idle callback as a signal that your page is too busy — the
hydration isn't the problem, the other work is.

**"Doesn't work the first time" with `visible`.** The component became visible and the user
interacted with it *during* its hydration, so the click was lost. Fix: increase `rootMargin` so
hydration completes before the component is really on screen, **and** add event replay so a click
during the gap isn't dropped. The two fixes address different halves of the same failure.
</details>

---

## 🏗️ Build challenge: pick the strategy from real data

Guessing which components deserve which strategy is how teams end up hydrating everything eagerly
"to be safe". Measure instead.

Build `hydration-telemetry.js`:

1. In production (sampled), record per island: whether it was ever interacted with, how long after
   load, and whether it was ever visible. Send it with your RUM.
2. Produce a **recommendation report**: components never interacted with in 95% of sessions →
   `interaction`; components visible in 90% of sessions within 2s → `load` or `visible`; components
   never visible → don't ship them at all.
3. Detect the failure mode: interactions that occurred *before* the component hydrated (compare the
   event timestamp with your hydration mark). That count is your real "lost clicks" metric and it
   belongs on a dashboard.
4. Simulate the change: given the recorded distribution, compute expected TBT under each strategy
   assignment, so a proposed change has a predicted number before you ship it.
5. Close the loop: after shipping, compare predicted vs actual TBT and lost-click rate.

**Done when:** you can point at a component and say "94% of sessions never touch this, so it's
`interaction`, which saves 180ms of TBT and costs 30ms on the 6% of clicks that happen" — and then
show that you were right.

---

## Interview questions

1. Name the five hydration triggers and what each one costs.
2. Why does `idle` need a timeout?
3. What is event replay, and which events must you *not* replay?
4. Users say a lazily-hydrated button "doesn't work the first time". Diagnose it.
5. Why isn't `interaction` the right default for everything?
6. How would you decide, from data rather than opinion, which components hydrate lazily?
