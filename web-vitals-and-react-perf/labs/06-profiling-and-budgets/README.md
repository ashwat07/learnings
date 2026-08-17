# Lab 06 — Profiling & budgets ⭐⭐⭐⭐

**Goal:** keep the fixes from the previous five labs fixed.

**Primary metric:** whether a regression fails CI before it reaches users.

```sh
cd react-sandbox && npm run dev     # any route; the render tally is the in-app profiler
```

---

## Profiling: four tools, four questions

| Tool | Answers | Use when |
|---|---|---|
| Performance panel | **causality** — what ran, in what order, on which thread | always start here |
| React DevTools Profiler | which components rendered and why | the flame chart says "React work" and you need the component |
| `<Profiler onRender>` | `actualDuration` vs `baseDuration` numerically | proving a memoisation earns its keep |
| `PerformanceObserver` | the metric as the browser scores it | anything you want in CI or RUM |

### Reading a Performance profile without getting lost

1. **Start at the interaction**, not the top of the trace. Find the event marker.
2. **Look at the long tasks** (the red-cornered blocks). Anything over 50ms is blocking input.
3. **Look for purple** — layout and style recalculation. A tall purple block right after your JS is
   a forced synchronous layout; the culprit is a read of `offsetHeight`/`getBoundingClientRect`
   after a write. See [critical-rendering-path lab 03](../../../critical-rendering-path/labs/14-forced-reflow-detector/).
4. **Check the bottom-up view filtered to the interaction window.** "Which function owns the most
   self time" is usually the whole answer.
5. **Throttle CPU 4×.** Same throttle before and after, or the numbers are fiction.

## Budgets: the numbers you enforce

| Budget | Value | Enforced by |
|---|---|---|
| LCP (lab, throttled) | ≤ 2.5s | Lighthouse CI on your top 3 routes |
| CLS | ≤ 0.1 | Playwright assertion using `PerformanceObserver` |
| INP proxy (TBT) | ≤ 200ms | Lighthouse CI |
| Initial JS, gzipped | a number you choose and hold | [bundle-strategy `budget.mjs`](../../../bundle-strategy/budget.mjs) |
| Long tasks during load | count, not duration | `PerformanceObserver('longtask')` |

**Pick numbers you'll actually hold.** A budget that fails on every PR gets an exemption on every
PR, and then it isn't a budget. Start at "current + 5%" and ratchet down.

### The ratchet

Store the current value as a baseline in the repo. CI fails if the new value exceeds baseline by
more than a tolerance; when a PR *improves* it, CI updates the baseline. Regressions require an
explicit, reviewable commit that raises the number — which turns "we'll fix it later" into a
conversation with a diff attached.

## Field vs lab, one more time

CI catches regressions on **your three most important routes, on one simulated device.** It cannot
tell you your Indian Android p75 got worse because a partner changed a tag. You need both:

```
CI (lab)      fast feedback, blocks merges, no attribution problem
RUM (field)   slow feedback, real users, sets priorities
CrUX          the number Search actually uses
```

## The regression sources nobody budgets for

| Source | Why it escapes CI |
|---|---|
| a third-party tag added via a tag manager | it isn't in your repo |
| a dependency's minor version growing 40KB | your budget is on total, so it hides |
| an A/B test that renders client-side | only fires for a cohort |
| a CDN config change | infrastructure, not code |
| a marketing landing page built outside the design system | it's a different route |

The first is the most common cause of a sudden field regression with no matching deploy. Track
**third-party script bytes and long tasks separately** from your own, or you'll spend a day looking
in the wrong repo.

## Think about

- Your LCP is fine in CI and bad in the field. Name three explanations.
- Why measure long-task *count* rather than total blocking time?
- Should a performance budget fail a build?

<details>
<summary>Answers</summary>

**CI good, field bad.** (1) Device and network distribution — CI runs one simulated profile; your
p75 is a mid-range Android on a congested network. (2) Third-party content that CI doesn't load, or
loads from a warm cache. (3) Route coverage — CI tests three routes; your traffic is dominated by a
fourth. Fix the measurement before the code: segment field data by route and device class first.

**Long-task count.** Total blocking time can be dominated by one 900ms task, which is a single fix.
Ten 60ms tasks have similar TBT but a completely different user experience and a completely
different fix (you can't split one thing ten teams contribute to). The count tells you whether
you're chasing one bug or a culture.

**Failing the build.** Yes for a hard ceiling that reflects a real user commitment (initial JS,
LCP on the checkout route); warn-only for everything else. The failure mode to avoid is a budget so
tight it fails constantly — teams learn to bypass it, and you've lost the signal and the credibility.
A warn that shows up as a PR comment with the delta changes behaviour more than a red X people have
learned to ignore.
</details>

---

## 🏗️ Build challenge: the full loop

1. **RUM**: `web-vitals` with attribution → your endpoint → p75 by route and device class.
2. **CI**: Lighthouse CI on your top 3 routes with a stored baseline and a ratchet.
3. **Bundle**: the size gate from [bundle-strategy lab 05](../../../bundle-strategy/labs/05-analyse-and-budget/),
   split into first-party and third-party.
4. **Interaction test**: Playwright + CDP CPU throttling, asserting your top-3 interactions stay
   under 200ms.
5. **A dashboard with one chart per metric, annotated with deploys.** The annotation is what turns
   "it got worse in March" into "it got worse on the 14th, and here's the PR."
6. **An alert on the p75, not the mean.** The mean hides exactly the users the metric exists for.

**Done when:** a PR that adds a 60KB dependency and a 300ms handler fails CI with a message naming
both.

---

## Interview questions

1. Where do you start reading a Performance profile?
2. What does a tall purple block after your JS mean?
3. How do you keep a performance budget from becoming decoration?
4. Why do you need both CI and RUM?
5. Name three regression sources that CI can't catch.
