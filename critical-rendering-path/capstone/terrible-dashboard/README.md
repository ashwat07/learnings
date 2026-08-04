# Capstone 19 — The terrible dashboard ⭐⭐⭐⭐⭐⭐

**Goal:** every mistake from Labs 01–18, in one realistic application, at the same time. Then fix
it to 60fps without deleting features.

**Primary metric:** 60fps during every interaction, at 4× CPU throttle, with no long task over 50ms.

---

## What you've been handed

A dashboard that looks fine in a screenshot and is unusable in practice. It has:

- collapsible sidebar, sticky navbar with a `backdrop-filter`
- 100 metric cards with large shadows
- 4 "charts" built from DOM bars, updated every animation frame
- a 5,000-row table with per-row event listeners
- a search input that filters the table synchronously on every keystroke
- a modal and a drawer, both animating `left`
- a tooltip that follows the cursor via `top`/`left` on every `mousemove`
- a notification feed that appends forever
- a settings panel that writes to `localStorage` on every keystroke
- a polling interval that re-renders everything every 2 seconds
- a resize handler that measures every card individually

Every one of those descriptions maps to a specific lab. Before you profile anything, **read the
list and write down which lab each item belongs to, and what you expect the trace to show.** Then
profile and see how good your predictions were. That prediction step is the exercise that makes
this a capstone rather than a chore.

## The deliberate sins, mapped

| # | Sin | In the code | Lab |
|---|---|---|---|
| 1 | Sidebar collapse animates `width` | `toggleSidebar()` | 03 |
| 2 | Drawer and modal animate `left` | `styles.css` transitions | 03 |
| 3 | Tooltip follows cursor via `top`/`left`, no rAF | `onMouseMove()` | 02, 03 |
| 4 | Chart bars written per frame with layout reads interleaved | `updateCharts()` | 01, 03 |
| 5 | Resize handler reads `getBoundingClientRect()` per card, then writes | `onResize()` | 01 |
| 6 | Search filters 5,000 rows synchronously, rebuilding the table with `innerHTML` | `onSearch()` | 05, 07 |
| 7 | 5,000 rows in the DOM, each with two listeners | `renderTable()` | 05, 10 |
| 8 | Listeners never removed when rows are replaced | `renderTable()` | 10 |
| 9 | Notifications appended forever, never trimmed | `pushNotification()` | 09 |
| 10 | `localStorage.setItem` on every keystroke (sync, blocking) | `onSettingsInput()` | 07 |
| 11 | Poll re-renders the whole dashboard every 2s | `startPolling()` | 05, 08 |
| 12 | `backdrop-filter` on a sticky full-width navbar | `styles.css` | 06 |
| 13 | Large `box-shadow` + `border-radius` on 100 cards | `styles.css` | 06 |
| 14 | `will-change: transform` on every card, permanently | `styles.css` | 15 |
| 15 | Theme toggle flips a class on `<html>` mid-animation | `toggleTheme()` | 04 |
| 16 | `window.addEventListener` in a component that gets re-created | `mountWidget()` | 09, 10 |

## Phase 1 — measure the disaster (do not fix anything yet)

Resist fixing. Get the baseline first; you'll want it later, and you'll want to be able to prove
which change did what.

Set up: incognito, CPU 4×, and record a separate 3-second trace for each interaction below.

| Interaction | FPS | Worst frame | Longest task | Bottleneck stage |
|---|---|---|---|---|
| idle (nothing but polling) | | | | |
| scroll the table | | | | |
| type 5 characters in search | | | | |
| move the mouse across the cards | | | | |
| collapse/expand the sidebar | | | | |
| open the drawer | | | | |
| open the modal | | | | |
| toggle the theme | | | | |
| resize the window | | | | |
| leave it running for 5 minutes | | | | |

Plus, once each:

- Heap and DOM node count at start, and after 5 minutes of use (Labs 09/10).
- Layer count and GPU memory from the Layers panel (Lab 15).
- Paint flashing on, during a mouse move (Lab 04).
- Coverage report for CSS and JS (Lab 13).
- Lighthouse, on mobile throttling.

Write it all in `MEASUREMENTS.md`. This is your before-state, and half the value of the capstone
is having it.

## Phase 2 — fix, one sin at a time

**Rules — these are what make it a real exercise:**

1. **No feature deletion.** Every feature in the list must still work and look substantially the
   same. "I made it fast by removing the charts" is not a solution.
2. **One fix per commit**, with the measurement in the commit message. Format:
   ```
   fix(scroll): rAF-coalesce tooltip position, transform instead of top/left

   worst frame during mousemove: 84ms → 6ms (4× CPU throttle)
   layout entries per second: 340 → 60
   ```
3. **Re-measure after each.** If a fix doesn't move a number, revert it. You will find at least one
   "obvious" fix that changes nothing — finding it is more instructive than the ones that work.
4. **Keep a running table** of interaction → FPS across commits, so you can see the curve.

Suggested order (cheapest and highest impact first — but derive your own order from your Phase 1
data and be prepared to defend it):

1. The `mousemove` tooltip (sin 3) — biggest win per line changed.
2. The chart update loop (sin 4).
3. Table virtualization (sins 6, 7, 8) — the biggest structural change.
4. Animations to `transform` (sins 1, 2).
5. The resize handler (sin 5).
6. Paint costs: navbar, shadows, layers (sins 12, 13, 14).
7. Polling and re-render (sin 11).
8. `localStorage` and the sync writes (sin 10).
9. Leaks (sins 9, 16).
10. Theme (sin 15).

## Phase 3 — the acceptance test

You're done when **all** of these hold at 4× CPU throttle:

- [ ] ≥ 55fps during: table scroll, search typing, mouse movement, sidebar toggle, drawer, modal.
- [ ] No task longer than 50ms after initial load, during any interaction.
- [ ] Typing in search: keystroke → paint under 50ms with 5,000 rows loaded.
- [ ] ≤ 300 table rows in the DOM at any scroll position.
- [ ] Every animation continues smoothly during a deliberate 1-second main-thread block.
- [ ] After 10 minutes of automated interaction, JS heap and DOM node count are flat (±10%), and
      detached node count is zero after GC.
- [ ] Total promoted layers ≤ 10, GPU memory under your stated budget.
- [ ] Lighthouse performance ≥ 90 on mobile throttling.
- [ ] `PerfHUD` reports zero geometry reads during scroll and mousemove.
- [ ] Your Lab 14 `reflow-sentinel` reports zero violations during all interactions.

Add an `automation.js` that drives the interactions programmatically (a scripted scroll, synthetic
keystrokes, a mousemove sweep, open/close cycles) so your measurements are repeatable and your
10-minute leak test doesn't require you to sit there clicking.

## Phase 4 — the write-up

Produce `FINDINGS.md`, written as if for your team:

1. Before/after table for all ten interactions.
2. For each of the 16 sins: the trace evidence, the fix, and the measured delta.
3. **"Fixes that didn't help"**, with numbers. Be honest; this section is the credibility test.
4. The two or three fixes that accounted for most of the gain. (There will be a Pareto here.
   Finding it is the skill — knowing where *not* to spend a week.)
5. Three lint rules or code-review checks that would have prevented most of this.
6. What you'd do differently if you were building it from scratch — and, separately, what you'd
   *keep* from the naive version because it was fine.

## Stretch goals

- Rebuild the dashboard in React and reproduce the same sins in React idioms (Lab 08), then fix
  those. The React versions of these bugs look completely different in a trace, which is the point.
- Add a Web Worker for the filtering and sorting, and measure whether the postMessage cost is worth
  it at 5,000 rows, 50,000, and 500,000. Find the crossover point.
- Add `view-transition` for the route/panel changes and check it doesn't reintroduce layout cost.
- Make it work on a real mid-range Android phone over USB debugging. Everything you learned at 4×
  throttle will be tested here, and some of it will turn out to be wrong.

---

## Files

| File | What it is |
|---|---|
| `index.html` | the dashboard markup |
| `styles.css` | the CSS sins — all commented with their sin number |
| `app.js` | the JS sins — all commented with their sin number |
| `automation.js` | **you write this** — scripted interactions for repeatable measurement |
| `MEASUREMENTS.md` | **you write this** — copy from `../../MEASUREMENTS.md` |
| `FINDINGS.md` | **you write this** — the Phase 4 write-up |

Every sin in the code is marked with a `// SIN n:` comment explaining what's wrong and which lab
covers it. Don't remove the comments as you fix them — turn them into `// FIXED n:` notes with the
measurement. The file becomes its own changelog, and re-reading it in six months is genuinely
useful.
