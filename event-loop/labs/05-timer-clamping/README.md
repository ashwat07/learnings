# Lab 05 — Timer clamping & throttling ⭐⭐⭐⭐

**Goal:** stop treating `setTimeout` as a scheduling primitive with predictable timing, and know
the four separate mechanisms that slow your timers down.

**Primary metric:** measured minimum interval per primitive, and callbacks-per-second.

> Open <http://localhost:8080/event-loop/labs/05-timer-clamping/>

---

## The concept

`setTimeout(fn, n)` means: *queue a task after **at least** n milliseconds, subject to a pile of
clamps.* Four separate mechanisms, all live in every browser:

| Mechanism | Rule | Where it bites |
|---|---|---|
| **Nesting clamp** | After 5 levels of nesting, a timeout under 4ms becomes 4ms | Any `setTimeout(0)` chain: max ~250 iterations/sec |
| **Background clamp** | Hidden tab: timers clamped to ≥1000ms | Polling, analytics, "keep-alive" |
| **Intensive throttling** | Hidden >5 min (Chrome): timers run once per **minute**, aligned | Long-lived dashboards, chat apps |
| **Alignment / coalescing** | Timers are grouped to let the CPU sleep, especially on battery | Everything, on laptops and phones |

Plus: `requestAnimationFrame` **stops completely** in a hidden tab, and `setInterval` never waits
for your callback to finish.

Exceptions to background throttling (worth knowing so you don't cargo-cult a workaround): a tab
playing audio, holding a Web Lock, in an active WebRTC call, or one with a recent user gesture,
gets a reprieve. `Worker` timers are also throttled, but less aggressively — which is why
"move the poll into a worker" sometimes works and sometimes doesn't.

## Break it

Run the five demos in order. Fill these in:

| Measurement | Yours | Expected |
|---|---|---|
| `setTimeout(0)` gap, nesting level 1–4 | | ~0–1ms |
| `setTimeout(0)` gap, nesting level 6+ | | ~4ms |
| `queueMicrotask` round trips/s | | 100,000+ |
| `setTimeout(0)` round trips/s | | ~250 |
| `MessageChannel` round trips/s | | 5,000–20,000 |
| `scheduler.postTask` round trips/s | | 3,000–15,000 |
| `rAF` round trips/s | | = your refresh rate |
| `setInterval(10)` + 30ms work: idle % over 2s | | ~0% |
| recursive `setTimeout(10)` + 30ms work: idle % | | ~25% |
| `setInterval(100)` drift over 10s under load | | 300–2000ms |
| Timer gap while tab hidden | | ~1000ms |
| rAF gap while tab hidden | | none — it stops |

Demo 5 needs you to actually switch tabs for 30+ seconds. Do it — the log entries with
`[visibility: hidden]` are the proof, and they're the thing you'll remember when someone asks why
their websocket heartbeat dies on mobile.

## Measure it

The Performance panel's Main track shows timer tasks as small blocks labelled `Timer Fired`. Two
things to look at:

1. Record demo 1. Measure the gap between the first few `Timer Fired` blocks vs the later ones
   with the ruler (click-drag in the overview). The step from ~1ms to 4ms is visible.
2. Record demo 3. `setInterval(10)` produces a wall of adjacent blocks with no gaps — no frames,
   no idle. That solid wall is the visual signature of a pile-up.

## The four bugs this causes in real code

```js
// 1. A "yield" that caps your throughput at 250 items/second
for (const item of items) { await new Promise(r => setTimeout(r, 0)); process(item); }

// 2. A countdown that loses time
let left = 60;
setInterval(() => { left--; render(left); }, 1000);      // drifts, and freezes in a background tab

// 3. A poll that stampedes on tab focus
setInterval(() => fetch('/api/updates'), 5000);          // hidden: coalesced; visible: catch-up burst

// 4. A "debounce" that never fires on mobile
setTimeout(save, 30_000);                                // tab hidden → clamped, backgrounded, maybe killed
```

Fixes, in order of preference:

1. **Don't schedule with timers.** Use `MessageChannel` / `scheduler.postTask` for yielding,
   `rAF` for visual work, `visibilitychange` for lifecycle.
2. **Derive state from the clock, not from tick counts.** `remaining = target - Date.now()`.
3. **Recompute on `visibilitychange`** instead of assuming your timers kept up.
4. **Use `navigator.sendBeacon` or the `pagehide` event** for anything that must survive
   backgrounding.

## Fix it yourself

Rewrite the countdown timer so that it:

- [ ] is correct to ±1s after the tab has been hidden for 5 minutes,
- [ ] doesn't fire a burst of catch-up ticks when the tab comes back,
- [ ] updates the display exactly once per visible second (no busy rAF loop),
- [ ] and stops entirely while hidden, then re-syncs on `visibilitychange`.

Put it in `countdown.js` and test it by actually hiding the tab for 5 minutes.

<details>
<summary>Hint — the shape</summary>

```js
const target = Date.now() + 60_000;
let timer = null;

function tick() {
  const remaining = Math.max(0, target - Date.now());
  render(remaining);
  if (remaining === 0) return;
  // schedule for the next whole-second boundary, not "1000ms from now"
  timer = setTimeout(tick, remaining % 1000 || 1000);
}

document.addEventListener('visibilitychange', () => {
  clearTimeout(timer);
  if (!document.hidden) tick();          // re-sync from the clock, no catch-up loop
});
```

Two ideas doing the work: the target is an absolute timestamp, and the next tick is scheduled to
the next *boundary* so error can't accumulate.
</details>

---

## 🏗️ Build challenge: `sane-timers.js`

A drop-in replacement for the timer functions that behaves under throttling.

```js
import { every, after, clock } from './sane-timers.js';

const stop = every(1000, ({ drift, skipped }) => render(clock.now()));
after(30_000, save);                       // survives backgrounding, or tells you it didn't
```

Requirements:

1. `every(ms, fn)` never piles up: if a callback overruns, the next is scheduled after it, and
   `fn` receives how many intervals were **skipped** so it can catch up in one step instead of N.
2. Absolute scheduling: interval N fires at `start + N*ms`, so 3600 ticks of `every(1000)` take
   3,600,000ms ± one interval, not ±20 seconds.
3. Pause on `visibilitychange → hidden`, resume with a single reconciliation call on visible.
   Report the hidden duration to the callback.
4. A `mode: 'background-safe'` option that uses a `Worker` timer (workers are throttled less
   aggressively) and documents exactly what guarantee that does and does not give.
5. Measured overhead under 0.05ms per tick vs raw `setInterval`.

Then prove it: run `every(1000)` for 10 minutes with the tab hidden for 6 of them, and show the
tick count and total elapsed error against `Date.now()`, next to the same test with raw
`setInterval`. Put both numbers in your README.

**Done when:** your 10-minute test has under 1 second of accumulated error and produces no catch-up
burst, and you can explain from the log exactly when Chrome escalated to intensive throttling.

---

## Interview questions

1. Why does `setTimeout(fn, 0)` take 4ms — sometimes? What's the "sometimes"?
2. A chat app's "typing" indicator stops working when the user switches tabs. Walk through the
   three separate mechanisms that could be responsible, and how you'd tell them apart.
3. `setInterval(fn, 100)` where `fn` takes 150ms. What does the browser do? What would you rather
   it did?
4. You need to run something in 30 seconds even if the user backgrounds the tab. What are your
   actual options, and what does each guarantee?
5. Why did React's scheduler use `MessageChannel` instead of `setTimeout(0)` — give the number.
