# Lab 01 — The cost of hydration ⭐⭐⭐⭐⭐

**Goal:** see the gap between "looks ready" and "is ready", measure what fills it, and know which
metrics show it.

**Primary metric:** hydration duration, longest task, and **clicks lost**.

> Open <http://localhost:8080/hydration-strategies/labs/01-hydration-cost/> at **4× CPU throttle**.

---

## The concept

Server HTML paints. Then the framework:

1. downloads,
2. re-creates the component tree in memory,
3. walks the DOM the server already produced,
4. attaches event handlers and reconciles state.

Steps 2–4 are **main-thread CPU, proportional to component count** — not to how much of the page is
interactive. A framework has to reconstruct the whole tree to know that nothing changed.

```
       FCP                              interactive
        │                                    │
────────●────────────────────────────────────●──────►
        │◄─── looks ready, isn't ───────────►│
```

## Measure it

300 components, 1ms each, at 4× throttle:

| strategy | components | interactive | hydration ms | longest task | clicks lost |
|---|---|---|---|---|---|
| hydrate everything | 300 | 100 | | | |
| hydrate islands only | 300 | 100 | | | |

Then open the three real sandbox pages and compare **TBT** in the corner scoreboard:

- `?repeat=10&hydrationCost=0` — 120 islands, free
- `?repeat=10&hydrationCost=2` — 120 islands, 2ms each
- `?repeat=20&hydrationCost=3` — 240 islands, 3ms each

**Try to click during load on the third one.** That experience is the entire lab.

## The three findings

**1. Cost scales with component count, not with interactivity.** Two thirds of the components in
this lab are static text. Full hydration walks them anyway.

**2. It's invisible to FCP and LCP.** The page painted *before* hydration started. It shows up in:

| Metric | Shows hydration? |
|---|---|
| FCP | ❌ — server HTML already painted |
| LCP | ❌ — usually already painted too |
| **TBT** | ✅ — this is where it lives |
| **long tasks** | ✅ |
| **INP** | ✅ — as *input delay*, if the user tries during the gap |
| TTI | ✅ — but it's a lab-only metric and easily gamed |

If your dashboard only tracks FCP/LCP, a hydration regression is invisible to you and obvious to
your users.

**3. Lost clicks are the real symptom.** Not "slow" — **wrong**. The button looked pressable, the
user pressed it, nothing happened. And the alternative isn't obviously better: frameworks that
queue and replay events turn "nothing happened" into "everything happened at once", which is how
you get double-submitted forms.

## What actually helps

| Fix | Effect | Cost |
|---|---|---|
| **Fewer components** to hydrate (islands) | linear reduction | someone must mark the islands |
| **Defer** hydration (idle/visible/interaction) | moves cost off the critical path | first interaction may pay |
| **Server components** | those components never exist on the client | framework support |
| **Resumability** | no re-execution at all | serialised state, different model |
| **Less JS per component** | smaller download *and* less parse/exec | ongoing discipline |
| Code-splitting alone | ❌ helps download, not hydration | — |

That last row matters: **splitting your bundle does not reduce hydration cost.** The same components
still hydrate; the JS just arrives in more files. People conflate these constantly.

## Think about

- Why does hydration cost scale with component count rather than with the amount of interactivity?
- Your FCP is 0.9s and users say the page "freezes for a second". Which metric do you look at?
- Would code-splitting fix this? Would lazy-loading the framework?

<details>
<summary>Answers</summary>

**Component count.** Hydration is a *reconciliation*: the framework builds its own picture of what
the tree should be, then matches it against the DOM. It can't know that a component produced
identical output without rendering it. That's why "the page is mostly static" doesn't help unless
the framework is *told* which parts are static.

**FCP fine, feels frozen.** TBT and long tasks, then INP. FCP measures the first paint; the freeze
is after it. Record a Performance profile and look for one long task after FCP — that's hydration,
and DevTools will attribute it to your framework's `hydrateRoot`.

**Code-splitting / lazy framework.** Code-splitting reduces bytes downloaded, not components
hydrated — the long task is the same length, it just starts later. Lazy-loading the framework delays
interactivity further, which is worse. The only fixes are: hydrate fewer things, hydrate them later,
or don't hydrate at all.
</details>

---

## 🏗️ Build challenge: a hydration budget in CI

Hydration regressions arrive component by component and no single PR trips a threshold. Automate it.

`hydration-budget.mjs` with Playwright + CDP:

1. Load a route at 4× CPU throttle. Record **TBT**, the **longest task**, and the FCP→TTI gap over
   5 runs; report the median.
2. Count hydrated components by instrumenting your framework's hydration entry point (React: wrap
   `hydrateRoot`; Vue: `app.mount`; or count `data-hydrated` attributes if you own the mechanism).
   Report **ms per component** — that ratio is the number that tells you whether the fix is "fewer
   components" or "cheaper components".
3. **Simulate the uncanny valley**: dispatch a click at FCP + 100ms and assert it was handled.
   Failing that assertion is a much more legible CI failure than "TBT went up 12%".
4. Budget per route (`tbt=200ms, components=150`), and fail the build on regression with a
   per-component diff against the baseline.
5. Track it over time — the interesting graph is TBT vs commit, because this metric degrades
   gradually.

**Done when:** the synthetic click test fails on the 240-island page and passes on the islands
version, and you have a TBT-per-route baseline committed to the repo.

---

## Interview questions

1. What exactly does hydration do?
2. Why doesn't hydration show up in FCP or LCP?
3. A user taps a button 400ms after first paint and nothing happens. Explain the mechanism.
4. Does code-splitting reduce hydration cost?
5. Which is worse: dropping the click, or queueing and replaying it?
6. Name three ways to reduce hydration cost, in order of how much they buy.
